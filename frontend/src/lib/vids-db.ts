// Vids — server side of the shared cloud video library. Two stores, following
// the split the rest of the Studio has settled on:
//   rows  → Railway Postgres (DATABASE_PUBLIC_URL, the same DB as the board);
//           the tables self-create on first use, like board-db.ts. Folders,
//           clips, personas — and recipes, a finished build written down under
//           a short code so it can be brought back exactly — and which of it
//           all is on offer to the clippers (see VidClipable in vids-types).
//   files → the dedicated Vids Supabase project's public `vids` bucket, driven
//           with its secret key (the bucket is auto-created). Browsers never
//           hold a key for it: uploads go through short-lived signed URLs
//           minted here, playback uses plain public URLs.
//
// Server-only — imported by the /api/vids/* route handlers. Never import this
// from a client component (it would leak the DB string + storage secret).

import { randomInt } from 'node:crypto';
import { CLIPPERS } from '@/lib/clipping';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  RECIPE_CODE_ALPHABET, RECIPE_CODE_LENGTH, cleanEdit, cleanMarks, cleanTheme, isClipableKind, recipeName,
} from '@/lib/vids-types';
import type {
  ClipableKind, CreateVideoInput, VidBuildSpec, VidClipableFlag, VidClipablePatch, VidContextPatch, VidEdit,
  VidFolder, VidLink, VidMark, VidPersona, VidRecipe, VidRow, VidThemePatch, VidsLibraryPayload,
} from '@/lib/vids-types';

export const VIDS_BUCKET = 'vids';

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'unexpected error');

// ── Singletons (hot-reload safe, like board-db) ───────────────────────────────
// Bump whenever ensureSchema() below gains a table or column. The promise is
// cached on globalThis so the DDL runs once per process, which also means a
// process that started before the change would otherwise never see it — a hot
// reload in dev, or a long-lived server between deploys. Comparing the version
// makes such a process re-run the (idempotent) DDL instead of trusting a
// promise that was resolved against the older schema.
const SCHEMA_VERSION = 14;

const g = globalThis as unknown as {
  __vidsPool?: pg.Pool;
  __vidsSb?: SupabaseClient;
  __vidsSchema?: Promise<void>;
  __vidsSchemaVersion?: number;
  __vidsBucket?: Promise<void>;
};

function getPool(): pg.Pool {
  if (g.__vidsPool) return g.__vidsPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) {
    throw new Error('DATABASE_PUBLIC_URL not set — paste Railway\'s Connect-panel value into the root .env');
  }
  g.__vidsPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return g.__vidsPool;
}

function getSb(): SupabaseClient {
  if (g.__vidsSb) return g.__vidsSb;
  const url = process.env.VIDS_SUPABASE_URL;
  const key = process.env.VIDS_SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('VIDS_SUPABASE_URL / VIDS_SUPABASE_SECRET_KEY not set — add the Vids Supabase project to the root .env');
  }
  g.__vidsSb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return g.__vidsSb;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function ensureBucket(): Promise<void> {
  if (g.__vidsBucket) return g.__vidsBucket;
  g.__vidsBucket = (async () => {
    const sb = getSb();
    const { error } = await sb.storage.getBucket(VIDS_BUCKET);
    if (!error) return;
    const created = await sb.storage.createBucket(VIDS_BUCKET, { public: true });
    if (created.error && !/already exists/i.test(created.error.message)) {
      throw new Error(`Could not create the "${VIDS_BUCKET}" bucket: ${created.error.message}`);
    }
  })().catch((e) => {
    // Don't wedge on a transient failure — retry on the next request.
    g.__vidsBucket = undefined;
    throw e;
  });
  return g.__vidsBucket;
}

export function publicUrl(path: string): string {
  return getSb().storage.from(VIDS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function signUpload(path: string): Promise<{ path: string; url: string }> {
  await ensureBucket();
  const { data, error } = await getSb().storage.from(VIDS_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`Could not sign the upload: ${error.message}`);
  return { path, url: data.signedUrl };
}

// Best-effort — a leftover object is harmless; a failed delete must not fail
// the request that already removed the row.
export async function removeObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await getSb().storage.from(VIDS_BUCKET).remove(paths);
  if (error) console.error('[vids] storage remove failed:', error.message);
}

// ── Schema (self-creating) ────────────────────────────────────────────────────
// Deleting a folder cascades to its sub-folders but only *detaches* the videos
// inside (they drop back to the library root), so a stray click can never wipe
// footage. Videos are only ever deleted explicitly.

function ensureSchema(): Promise<void> {
  if (g.__vidsSchema && g.__vidsSchemaVersion === SCHEMA_VERSION) return g.__vidsSchema;
  g.__vidsSchemaVersion = SCHEMA_VERSION;
  g.__vidsSchema = (async () => {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vids_folders (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id  UUID        NULL REFERENCES vids_folders(id) ON DELETE CASCADE,
        name       TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vids_videos (
        id           UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
        folder_id    UUID             NULL REFERENCES vids_folders(id) ON DELETE SET NULL,
        name         TEXT             NOT NULL,
        storage_path TEXT             NOT NULL,
        thumb_path   TEXT             NULL,
        mime_type    TEXT             NOT NULL DEFAULT 'video/mp4',
        size_bytes   BIGINT           NOT NULL DEFAULT 0,
        duration_s   DOUBLE PRECISION NULL,
        width        INTEGER          NULL,
        height       INTEGER          NULL,
        has_sfx      BOOLEAN          NOT NULL DEFAULT false,
        context      TEXT             NOT NULL DEFAULT '',
        marks        JSONB            NOT NULL DEFAULT '[]'::jsonb,
        created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now()
      );
    `);
    // Tables made before the keyboard sound existed predate has_sfx. Adding it
    // here rather than in a migration file keeps the schema self-creating, and
    // the default is right for every clip that came before: silent.
    await pool.query(
      'ALTER TABLE vids_videos ADD COLUMN IF NOT EXISTS has_sfx BOOLEAN NOT NULL DEFAULT false',
    );
    // A persona is the Start + Top A + Top B bundle. Each part points at a normal
    // vids_videos row, so personas reuse the whole upload / thumbnail / playback
    // path. ON DELETE SET NULL, not CASCADE: deleting one clip must leave the
    // persona standing with a gap you can refill, never silently drop the bundle.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vids_personas (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT        NOT NULL,
        start_id   UUID        NULL REFERENCES vids_videos(id) ON DELETE SET NULL,
        top_a_id   UUID        NULL REFERENCES vids_videos(id) ON DELETE SET NULL,
        top_b_id   UUID        NULL REFERENCES vids_videos(id) ON DELETE SET NULL,
        context    TEXT        NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Likewise for context, on both tables: everything made before simply has
    // nothing said about it yet, which is what the default means.
    for (const table of ['vids_videos', 'vids_personas'] as const) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS context TEXT NOT NULL DEFAULT ''`);
    }
    // Which way Pauv was when a Bottom B was recorded — see VidTheme. NULL is
    // "nobody has said", which is right for everything filed before it was
    // asked. A column of this name was here once and left behind; the two
    // ALTERs below take whatever shape it was in (it carried a default, and may
    // have been NOT NULL) back to a plain nullable one, and cleanTheme drops any
    // value in it that isn't light or dark.
    await pool.query('ALTER TABLE vids_videos ADD COLUMN IF NOT EXISTS theme TEXT NULL');
    await pool.query('ALTER TABLE vids_videos ALTER COLUMN theme DROP DEFAULT');
    await pool.query('ALTER TABLE vids_videos ALTER COLUMN theme DROP NOT NULL');
    // Per-stretch marks live on the clip only — a persona's context covers the
    // whole bundle, and its parts are marked up individually like any clip.
    await pool.query(
      `ALTER TABLE vids_videos ADD COLUMN IF NOT EXISTS marks JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
    // The recording a clip was edited from, and the edit its file was rendered
    // with — see VidEdit. Both null until the clip has been through Prep, which
    // is right for every clip from before: their file is their recording, and
    // the first edit keeps it rather than replacing it.
    await pool.query('ALTER TABLE vids_videos ADD COLUMN IF NOT EXISTS source_path TEXT NULL');
    await pool.query('ALTER TABLE vids_videos ADD COLUMN IF NOT EXISTS edit JSONB NULL');
    // A recipe is one finished build written down under a short code — see
    // VidBuildSpec. The build itself is one JSON document: it is only ever read
    // back whole, onto the stage, and keeping it in one piece means a new knob
    // in the builder is a new field in the document rather than a migration.
    // video_id is the library row a saved build became; a downloaded one has
    // none, and deleting the row leaves the recipe (SET NULL) — the point of
    // the code is to outlive the file.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vids_recipes (
        code       TEXT        PRIMARY KEY,
        title      TEXT        NOT NULL,
        video_id   UUID        NULL REFERENCES vids_videos(id) ON DELETE SET NULL,
        build      JSONB       NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Which Bottom B clips follow on from which Bottom A — see VidLink. A pair
    // is a row, and a clip deleted from either side takes its pairs with it
    // (CASCADE): a link to footage that is gone says nothing.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vids_links (
        bottom_a_id UUID        NOT NULL REFERENCES vids_videos(id) ON DELETE CASCADE,
        bottom_b_id UUID        NOT NULL REFERENCES vids_videos(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (bottom_a_id, bottom_b_id)
      );
    `);
    // Whether a persona or clip is on offer to the clippers — see VidClipable.
    // Off for everything made before, which is the point: nothing reaches the
    // clippers' app until someone here has said so.
    for (const table of ['vids_videos', 'vids_personas'] as const) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS clipable BOOLEAN NOT NULL DEFAULT false`);
    }
    // Whether a persona is degen — see VidPersona.degen. Every persona that
    // existed when the flag arrived is degen, so the column's first appearance
    // marks them all; from then on it is said when a persona is made. Guarded
    // on the column not being there yet, so that happens once and never again.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'vids_personas' AND column_name = 'degen'
        ) THEN
          ALTER TABLE vids_personas ADD COLUMN degen BOOLEAN NOT NULL DEFAULT false;
          UPDATE vids_personas SET degen = true;
        END IF;
      END $$;
    `);
    // The same flag for the things that live in code rather than in a row —
    // songs (public/audio) and caption looks (lib/vidsCaptions). A row here is
    // a yes; turning one off deletes it. Keyed by kind and by what names the
    // thing, so a song that leaves the library leaves a harmless stray row.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vids_clipable (
        kind       TEXT        NOT NULL,
        key        TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, key)
      );
    `);
    // What a song is called, when someone has renamed it. The audio library
    // names its tracks in code (/api/charts/list-audio), and a row here
    // stands in for that name wherever the library is listed — Vids, the
    // charts, the carousel — so a rename on the Clippers page is the name
    // everywhere. Keyed by the track's url like its clipable flag.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vids_track_names (
        url        TEXT        PRIMARY KEY,
        label      TEXT        NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Which songs are degen, marked on the Music page. A row here is a yes;
    // every other song is just a song. Keyed by url like its name.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vids_track_degen (
        url       TEXT        PRIMARY KEY,
        marked_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS vids_videos_folder_idx ON vids_videos (folder_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS vids_folders_parent_idx ON vids_folders (parent_id)');
  })().catch((e) => {
    g.__vidsSchema = undefined;
    g.__vidsSchemaVersion = undefined;
    throw e;
  });
  return g.__vidsSchema;
}

// ── Row mapping ───────────────────────────────────────────────────────────────

interface FolderDb { id: string; parent_id: string | null; name: string; created_at: Date }
interface VideoDb {
  id: string; folder_id: string | null; name: string; storage_path: string;
  thumb_path: string | null; mime_type: string; size_bytes: string | number;
  duration_s: number | null; width: number | null; height: number | null;
  has_sfx: boolean; context: string; marks: unknown; source_path: string | null; edit: unknown;
  clipable: boolean; theme: string | null; created_at: Date;
}

interface PersonaDb {
  id: string; name: string; start_id: string | null; top_a_id: string | null;
  top_b_id: string | null; context: string; clipable: boolean; degen: boolean; created_at: Date;
}

interface ClipableDb { kind: string; key: string }

interface RecipeDb {
  code: string; title: string; video_id: string | null; build: unknown; created_at: Date;
}

interface LinkDb { bottom_a_id: string; bottom_b_id: string }

const FOLDER_COLS = 'id, parent_id, name, created_at';
const LINK_COLS = 'bottom_a_id, bottom_b_id';
const CLIPABLE_COLS = 'kind, key';
const RECIPE_COLS = 'code, title, video_id, build, created_at';
const PERSONA_COLS = 'id, name, start_id, top_a_id, top_b_id, context, clipable, degen, created_at';
const VIDEO_COLS =
  'id, folder_id, name, storage_path, thumb_path, mime_type, size_bytes, duration_s, width, height, '
  + 'has_sfx, context, marks, source_path, edit, clipable, theme, created_at';

const toFolder = (r: FolderDb): VidFolder => ({
  id: r.id, parentId: r.parent_id, name: r.name, createdAt: r.created_at.toISOString(),
});

const toPersona = (r: PersonaDb): VidPersona => ({
  id: r.id,
  name: r.name,
  startId: r.start_id,
  topAId: r.top_a_id,
  topBId: r.top_b_id,
  context: r.context ?? '',
  clipable: r.clipable === true,
  degen: r.degen === true,
  createdAt: r.created_at.toISOString(),
});

const toLink = (r: LinkDb): VidLink => ({ bottomAId: r.bottom_a_id, bottomBId: r.bottom_b_id });

/** A flag row, or null for one whose kind this build no longer knows — a row
 *  written by a newer server, say. Dropped rather than passed on as a kind the
 *  client can't place. */
const toClipable = (r: ClipableDb): VidClipableFlag | null =>
  (isClipableKind(r.kind) ? { kind: r.kind, key: r.key } : null);

const toRecipe = (r: RecipeDb): VidRecipe => ({
  code: r.code,
  title: r.title,
  name: recipeName(r.title, r.code),
  videoId: r.video_id,
  build: r.build as VidBuildSpec,
  createdAt: r.created_at.toISOString(),
});

const toVideo = (r: VideoDb): VidRow => ({
  id: r.id,
  folderId: r.folder_id,
  name: r.name,
  storagePath: r.storage_path,
  thumbPath: r.thumb_path,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes) || 0,
  duration: r.duration_s,
  width: r.width,
  height: r.height,
  hasSfx: r.has_sfx,
  context: r.context ?? '',
  marks: cleanMarks(r.marks),
  sourcePath: r.source_path ?? null,
  sourceUrl: r.source_path ? publicUrl(r.source_path) : null,
  edit: cleanEdit(r.edit),
  clipable: r.clipable === true,
  theme: cleanTheme(r.theme),
  createdAt: r.created_at.toISOString(),
  url: publicUrl(r.storage_path),
  thumbUrl: r.thumb_path ? publicUrl(r.thumb_path) : null,
});

// ── Library ───────────────────────────────────────────────────────────────────

export async function listLibrary(): Promise<VidsLibraryPayload> {
  await ensureSchema();
  const pool = getPool();
  const [f, v, p, l, c] = await Promise.all([
    pool.query<FolderDb>(`SELECT ${FOLDER_COLS} FROM vids_folders ORDER BY name`),
    pool.query<VideoDb>(`SELECT ${VIDEO_COLS} FROM vids_videos ORDER BY created_at DESC`),
    pool.query<PersonaDb>(`SELECT ${PERSONA_COLS} FROM vids_personas ORDER BY name`),
    pool.query<LinkDb>(`SELECT ${LINK_COLS} FROM vids_links ORDER BY created_at`),
    pool.query<ClipableDb>(`SELECT ${CLIPABLE_COLS} FROM vids_clipable ORDER BY created_at`),
  ]);
  const all: VidsLibraryPayload = {
    folders: f.rows.map(toFolder),
    videos: v.rows.map(toVideo),
    personas: p.rows.map(toPersona),
    links: l.rows.map(toLink),
    clipable: c.rows.map(toClipable).filter((x): x is VidClipableFlag => x !== null),
  };
  return CLIPPERS ? clipableOnly(all) : all;
}

/** The library as the clipper deployment is allowed to see it: only what has
 *  been switched on for it on the Clippers page. Cut here, in the one place the
 *  library is read, rather than in the page that shows it — "off" means ours
 *  alone, and that has to be true of the API and not just of the UI.
 *
 *  A persona's own clips come with it whichever way they are flagged. Switching
 *  a persona on is switching on the three parts it *is*; leaving them behind
 *  would offer a clipper somebody whose video can't be built. Everything else —
 *  every Bottom A, Bottom B and End — is offered one clip at a time. */
function clipableOnly(lib: VidsLibraryPayload): VidsLibraryPayload {
  const personas = lib.personas.filter((p) => p.clipable);
  const parts = new Set(
    personas.flatMap((p) => [p.startId, p.topAId, p.topBId].filter((id): id is string => !!id)),
  );
  return {
    ...lib,
    personas,
    videos: lib.videos.filter((v) => v.clipable || parts.has(v.id)),
  };
}

// ── Clipable flags ────────────────────────────────────────────────────────────
// For the things that have no row of their own — songs and caption looks. A
// persona's or clip's flag is a column on it, set through updatePersona /
// updateVideo like its name.

// ── Track names ───────────────────────────────────────────────────────────────

/** Every renamed song, url → what it is called now. Read by list-audio on
 *  every listing, so it is one small query and nothing else. */
export async function listTrackNames(): Promise<Map<string, string>> {
  await ensureSchema();
  const r = await getPool().query<{ url: string; label: string }>('SELECT url, label FROM vids_track_names');
  return new Map(r.rows.map((row) => [row.url, row.label]));
}

/** Call a song something else, everywhere it is listed. */
export async function setTrackName(url: string, label: string): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO vids_track_names (url, label) VALUES ($1, $2)
     ON CONFLICT (url) DO UPDATE SET label = EXCLUDED.label, updated_at = now()`,
    [url, label],
  );
}

// ── Degen songs ───────────────────────────────────────────────────────────────

/** The urls of every song marked degen. Read by list-audio beside the names. */
export async function listDegenTracks(): Promise<Set<string>> {
  await ensureSchema();
  const r = await getPool().query<{ url: string }>('SELECT url FROM vids_track_degen');
  return new Set(r.rows.map((row) => row.url));
}

/** Mark a song degen, or back to just a song. Idempotent both ways. */
export async function setTrackDegen(url: string, degen: boolean): Promise<void> {
  await ensureSchema();
  if (degen) {
    await getPool().query('INSERT INTO vids_track_degen (url) VALUES ($1) ON CONFLICT DO NOTHING', [url]);
  } else {
    await getPool().query('DELETE FROM vids_track_degen WHERE url = $1', [url]);
  }
}

/** Turn one song or caption look on or off for the clippers. Idempotent both
 *  ways: turning on what is on, or off what is off, is nothing to do. */
export async function setClipable(kind: ClipableKind, key: string, on: boolean): Promise<void> {
  await ensureSchema();
  if (on) {
    await getPool().query(
      'INSERT INTO vids_clipable (kind, key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [kind, key],
    );
  } else {
    await getPool().query('DELETE FROM vids_clipable WHERE kind = $1 AND key = $2', [kind, key]);
  }
}

/** The keys switched on for the clippers, of one kind — song urls, or caption
 *  look ids. Read by the listings that have to narrow themselves in the clipper
 *  build (list-audio); the library itself narrows in listLibrary. */
export async function listClipableKeys(kind: ClipableKind): Promise<Set<string>> {
  await ensureSchema();
  const r = await getPool().query<{ key: string }>('SELECT key FROM vids_clipable WHERE kind = $1', [kind]);
  return new Set(r.rows.map((row) => row.key));
}

// ── Links ─────────────────────────────────────────────────────────────────────

/** Replace the set of Bottom Bs that follow on from one Bottom A. The whole
 *  set at once rather than one pair at a time, so two quick ticks on the Link
 *  page can't race each other into a state neither of them meant. Ids that
 *  aren't clips any more are dropped rather than refused — a stale tick is not
 *  a reason to lose the rest. Null when the Bottom A itself is gone. */
export async function setLinks(bottomAId: string, bottomBIds: string[]): Promise<VidLink[] | null> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const a = await client.query('SELECT 1 FROM vids_videos WHERE id = $1', [bottomAId]);
    if (!a.rows[0]) { await client.query('ROLLBACK'); return null; }
    await client.query('DELETE FROM vids_links WHERE bottom_a_id = $1', [bottomAId]);
    const wanted = Array.from(new Set(bottomBIds)).filter((id) => id !== bottomAId);
    if (wanted.length) {
      await client.query(
        `INSERT INTO vids_links (bottom_a_id, bottom_b_id)
         SELECT $1::uuid, id FROM vids_videos WHERE id = ANY($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [bottomAId, wanted],
      );
    }
    const r = await client.query<LinkDb>(
      `SELECT ${LINK_COLS} FROM vids_links WHERE bottom_a_id = $1 ORDER BY created_at`,
      [bottomAId],
    );
    await client.query('COMMIT');
    return r.rows.map(toLink);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── Folders ───────────────────────────────────────────────────────────────────

export async function createFolder(name: string, parentId: string | null): Promise<VidFolder> {
  await ensureSchema();
  const r = await getPool().query<FolderDb>(
    `INSERT INTO vids_folders (name, parent_id) VALUES ($1, $2) RETURNING ${FOLDER_COLS}`,
    [name, parentId],
  );
  return toFolder(r.rows[0]);
}

// Get-or-create a top-level folder by name, case-insensitively. Two people
// opening the Vids tab at the same moment both find the folder missing and both
// try to create it, which is how a second "Persona" appears; the advisory lock
// makes the check-then-insert atomic so only one of them wins. The lock is per
// folder name and released when the transaction ends.
export async function ensureTopFolder(name: string): Promise<VidFolder> {
  await ensureSchema();
  const key = `vids:folder:${name.trim().toLowerCase()}`;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    const found = await client.query<FolderDb>(
      `SELECT ${FOLDER_COLS} FROM vids_folders
        WHERE parent_id IS NULL AND lower(name) = lower($1)
        ORDER BY created_at LIMIT 1`,
      [name],
    );
    const row = found.rows[0] ?? (await client.query<FolderDb>(
      `INSERT INTO vids_folders (name, parent_id) VALUES ($1, NULL) RETURNING ${FOLDER_COLS}`,
      [name],
    )).rows[0];
    await client.query('COMMIT');
    return toFolder(row);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function renameFolder(id: string, name: string): Promise<VidFolder | null> {
  await ensureSchema();
  const r = await getPool().query<FolderDb>(
    `UPDATE vids_folders SET name = $1, updated_at = now() WHERE id = $2 RETURNING ${FOLDER_COLS}`,
    [name, id],
  );
  return r.rows[0] ? toFolder(r.rows[0]) : null;
}

export async function deleteFolder(id: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query('DELETE FROM vids_folders WHERE id = $1', [id]);
  return (r.rowCount ?? 0) > 0;
}

// ── Personas ──────────────────────────────────────────────────────────────────
// Deleting a persona drops only the bundle; its three clips stay in the Persona
// folder, where they show up as unassigned and can be reused or deleted by hand.
// Same rule as folders — nothing about a stray click should destroy footage.

export interface PersonaPatch extends VidContextPatch, VidClipablePatch {
  name?: string;
  startId?: string | null;
  topAId?: string | null;
  topBId?: string | null;
  degen?: boolean;
}

export async function createPersona(name: string, patch: PersonaPatch = {}): Promise<VidPersona> {
  await ensureSchema();
  const r = await getPool().query<PersonaDb>(
    `INSERT INTO vids_personas (name, start_id, top_a_id, top_b_id, degen)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${PERSONA_COLS}`,
    [name, patch.startId ?? null, patch.topAId ?? null, patch.topBId ?? null, patch.degen === true],
  );
  return toPersona(r.rows[0]);
}

export async function updatePersona(id: string, patch: PersonaPatch): Promise<VidPersona | null> {
  await ensureSchema();
  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [];
  const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.name !== undefined) put('name', patch.name);
  if (patch.startId !== undefined) put('start_id', patch.startId);
  if (patch.topAId !== undefined) put('top_a_id', patch.topAId);
  if (patch.topBId !== undefined) put('top_b_id', patch.topBId);
  if (patch.context !== undefined) put('context', patch.context);
  if (patch.clipable !== undefined) put('clipable', patch.clipable);
  if (patch.degen !== undefined) put('degen', patch.degen);
  vals.push(id);
  const r = await getPool().query<PersonaDb>(
    `UPDATE vids_personas SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING ${PERSONA_COLS}`,
    vals,
  );
  return r.rows[0] ? toPersona(r.rows[0]) : null;
}

export async function deletePersona(id: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query('DELETE FROM vids_personas WHERE id = $1', [id]);
  return (r.rowCount ?? 0) > 0;
}

// ── Videos ────────────────────────────────────────────────────────────────────

export async function createVideo(input: CreateVideoInput): Promise<VidRow> {
  await ensureSchema();
  try {
    const r = await getPool().query<VideoDb>(
      `INSERT INTO vids_videos
         (id, folder_id, name, storage_path, thumb_path, mime_type, size_bytes, duration_s, width, height,
          has_sfx, context, marks, source_path, edit, theme)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15::jsonb, $16)
       RETURNING ${VIDEO_COLS}`,
      [
        input.id, input.folderId, input.name, input.storagePath, input.thumbPath, input.mimeType,
        input.sizeBytes, input.duration, input.width, input.height,
        input.hasSfx ?? false, input.context ?? '', JSON.stringify(cleanMarks(input.marks ?? [])),
        input.sourcePath ?? null, input.edit ? JSON.stringify(input.edit) : null,
        cleanTheme(input.theme),
      ],
    );
    return toVideo(r.rows[0]);
  } catch (e) {
    // The bytes are already in the bucket — don't leave them orphaned.
    await removeObjects([
      input.storagePath,
      ...(input.thumbPath ? [input.thumbPath] : []),
      ...(input.sourcePath ? [input.sourcePath] : []),
    ]);
    throw e;
  }
}

export interface VideoPatch extends VidContextPatch, VidClipablePatch, VidThemePatch {
  name?: string;
  folderId?: string | null;
  marks?: VidMark[];
}

export async function updateVideo(id: string, patch: VideoPatch): Promise<VidRow | null> {
  await ensureSchema();
  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [];
  const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.name !== undefined) put('name', patch.name);
  if (patch.folderId !== undefined) put('folder_id', patch.folderId);
  if (patch.context !== undefined) put('context', patch.context);
  if (patch.marks !== undefined) put('marks', JSON.stringify(patch.marks));
  if (patch.clipable !== undefined) put('clipable', patch.clipable);
  if (patch.theme !== undefined) put('theme', cleanTheme(patch.theme));
  vals.push(id);
  const r = await getPool().query<VideoDb>(
    `UPDATE vids_videos SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING ${VIDEO_COLS}`,
    vals,
  );
  return r.rows[0] ? toVideo(r.rows[0]) : null;
}

/** The bytes behind a clip, swapped in when an edit is saved over the original. */
export interface VideoMedia {
  storagePath: string;
  thumbPath: string | null;
  mimeType: string;
  sizeBytes: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  /** Whether these bytes carry the keyboard sound. A property of the file, so it
   *  is replaced along with the file — re-saving without keys clears it. */
  hasSfx: boolean;
  /** The edit these bytes were rendered with, against the clip's source. Null
   *  means they are the recording as it stands. */
  edit: VidEdit | null;
}

/** Point an existing row at freshly uploaded bytes, keeping its id — so the
 *  folder it sits in, and every persona part pointing at it, survive an edit.
 *  `marks` comes along because an edit moves them: the caller re-times them
 *  against the footage it just rendered, and omitting them leaves them as they
 *  are (a save that changed no timing).
 *
 *  The recording is never lost. A row with no source yet is holding its
 *  recording as its file, so the first edit keeps that file as the source and
 *  only the render changes hands; a row with a source drops the render it used
 *  to hold (best effort: a leftover file is harmless, and the row is already
 *  correct). Later edits render from the source, so it stays put. */
export async function replaceVideoMedia(
  id: string, media: VideoMedia, name?: string, marks?: VidMark[],
): Promise<VidRow | null> {
  await ensureSchema();
  const pool = getPool();
  const before = await pool.query<Pick<VideoDb, 'storage_path' | 'thumb_path' | 'source_path'>>(
    'SELECT storage_path, thumb_path, source_path FROM vids_videos WHERE id = $1',
    [id],
  );
  if (!before.rows[0]) return null;
  const old = before.rows[0];
  // First edit: the file being replaced is the recording — keep it.
  const source = old.source_path ?? old.storage_path;

  const r = await pool.query<VideoDb>(
    `UPDATE vids_videos
        SET storage_path = $1, thumb_path = $2, mime_type = $3, size_bytes = $4,
            duration_s = $5, width = $6, height = $7, has_sfx = $8,
            name = COALESCE($9, name), marks = COALESCE($10::jsonb, marks),
            source_path = $11, edit = $12::jsonb, updated_at = now()
      WHERE id = $13
      RETURNING ${VIDEO_COLS}`,
    [
      media.storagePath, media.thumbPath, media.mimeType, media.sizeBytes,
      media.duration, media.width, media.height, media.hasSfx, name ?? null,
      marks === undefined ? null : JSON.stringify(marks),
      source, media.edit ? JSON.stringify(media.edit) : null, id,
    ],
  );
  if (!r.rows[0]) return null;

  const stale = [old.storage_path, ...(old.thumb_path ? [old.thumb_path] : [])]
    .filter((p) => p !== media.storagePath && p !== media.thumbPath && p !== source);
  await removeObjects(stale);
  return toVideo(r.rows[0]);
}

export async function deleteVideo(id: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query<Pick<VideoDb, 'storage_path' | 'thumb_path' | 'source_path'>>(
    'DELETE FROM vids_videos WHERE id = $1 RETURNING storage_path, thumb_path, source_path',
    [id],
  );
  const row = r.rows[0];
  if (!row) return false;
  await removeObjects([
    row.storage_path,
    ...(row.thumb_path ? [row.thumb_path] : []),
    ...(row.source_path ? [row.source_path] : []),
  ]);
  return true;
}

// ── Recipes ───────────────────────────────────────────────────────────────────

/** A fresh code. Random rather than sequential so two builds made a minute
 *  apart don't read as neighbours, and drawn from the confusable-free alphabet
 *  the client checks against. */
function newRecipeCode(): string {
  let out = '';
  for (let i = 0; i < RECIPE_CODE_LENGTH; i++) out += RECIPE_CODE_ALPHABET[randomInt(RECIPE_CODE_ALPHABET.length)];
  return out;
}

/** Write a build down under a new code. The code is minted here, and a clash
 *  with one already taken simply tries again — the insert is the check. */
export async function createRecipe(title: string, build: VidBuildSpec): Promise<VidRecipe> {
  await ensureSchema();
  const pool = getPool();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newRecipeCode();
    const r = await pool.query<RecipeDb>(
      `INSERT INTO vids_recipes (code, title, build) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING RETURNING ${RECIPE_COLS}`,
      [code, title, JSON.stringify(build)],
    );
    if (r.rows[0]) return toRecipe(r.rows[0]);
  }
  throw new Error('Could not find a free code for this build — try the export again');
}

export async function getRecipe(code: string): Promise<VidRecipe | null> {
  await ensureSchema();
  const r = await getPool().query<RecipeDb>(`SELECT ${RECIPE_COLS} FROM vids_recipes WHERE code = $1`, [code]);
  return r.rows[0] ? toRecipe(r.rows[0]) : null;
}

/** Note which library row a saved build became. */
export async function linkRecipeVideo(code: string, videoId: string | null): Promise<VidRecipe | null> {
  await ensureSchema();
  const r = await getPool().query<RecipeDb>(
    `UPDATE vids_recipes SET video_id = $1 WHERE code = $2 RETURNING ${RECIPE_COLS}`,
    [videoId, code],
  );
  return r.rows[0] ? toRecipe(r.rows[0]) : null;
}

/** Only ever for a build that never became a file — an export cancelled or
 *  failed after its code was minted. A code that has been on a video stays. */
export async function deleteRecipe(code: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query('DELETE FROM vids_recipes WHERE code = $1', [code]);
  return (r.rowCount ?? 0) > 0;
}
