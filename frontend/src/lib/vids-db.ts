// Vids — server side of the shared cloud video library. Two stores, following
// the split the rest of the Studio has settled on:
//   rows  → Railway Postgres (DATABASE_PUBLIC_URL, the same DB as the board);
//           the tables self-create on first use, like board-db.ts. Folders,
//           clips, personas — and recipes, a finished build written down under
//           a short code so it can be brought back exactly.
//   files → the dedicated Vids Supabase project's public `vids` bucket, driven
//           with its secret key (the bucket is auto-created). Browsers never
//           hold a key for it: uploads go through short-lived signed URLs
//           minted here, playback uses plain public URLs.
//
// Server-only — imported by the /api/vids/* route handlers. Never import this
// from a client component (it would leak the DB string + storage secret).

import { randomInt } from 'node:crypto';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RECIPE_CODE_ALPHABET, RECIPE_CODE_LENGTH, cleanMarks, recipeName } from '@/lib/vids-types';
import type {
  CreateVideoInput, VidBuildSpec, VidContextPatch, VidFolder, VidMark, VidPersona, VidRecipe, VidRow,
  VidsLibraryPayload,
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
const SCHEMA_VERSION = 6;

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
    // nothing said about it yet, which is what the default means. (A `theme`
    // column may still be there from when a clip said whether it was shot light
    // or dark — nothing reads or writes it any more, and it defaults itself.)
    for (const table of ['vids_videos', 'vids_personas'] as const) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS context TEXT NOT NULL DEFAULT ''`);
    }
    // Per-stretch marks live on the clip only — a persona's context covers the
    // whole bundle, and its parts are marked up individually like any clip.
    await pool.query(
      `ALTER TABLE vids_videos ADD COLUMN IF NOT EXISTS marks JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
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
  has_sfx: boolean; context: string; marks: unknown; created_at: Date;
}

interface PersonaDb {
  id: string; name: string; start_id: string | null; top_a_id: string | null;
  top_b_id: string | null; context: string; created_at: Date;
}

interface RecipeDb {
  code: string; title: string; video_id: string | null; build: unknown; created_at: Date;
}

const FOLDER_COLS = 'id, parent_id, name, created_at';
const RECIPE_COLS = 'code, title, video_id, build, created_at';
const PERSONA_COLS = 'id, name, start_id, top_a_id, top_b_id, context, created_at';
const VIDEO_COLS =
  'id, folder_id, name, storage_path, thumb_path, mime_type, size_bytes, duration_s, width, height, '
  + 'has_sfx, context, marks, created_at';

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
  createdAt: r.created_at.toISOString(),
});

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
  createdAt: r.created_at.toISOString(),
  url: publicUrl(r.storage_path),
  thumbUrl: r.thumb_path ? publicUrl(r.thumb_path) : null,
});

// ── Library ───────────────────────────────────────────────────────────────────

export async function listLibrary(): Promise<VidsLibraryPayload> {
  await ensureSchema();
  const pool = getPool();
  const [f, v, p] = await Promise.all([
    pool.query<FolderDb>(`SELECT ${FOLDER_COLS} FROM vids_folders ORDER BY name`),
    pool.query<VideoDb>(`SELECT ${VIDEO_COLS} FROM vids_videos ORDER BY created_at DESC`),
    pool.query<PersonaDb>(`SELECT ${PERSONA_COLS} FROM vids_personas ORDER BY name`),
  ]);
  return { folders: f.rows.map(toFolder), videos: v.rows.map(toVideo), personas: p.rows.map(toPersona) };
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

export interface PersonaPatch extends VidContextPatch {
  name?: string;
  startId?: string | null;
  topAId?: string | null;
  topBId?: string | null;
}

export async function createPersona(name: string, patch: PersonaPatch = {}): Promise<VidPersona> {
  await ensureSchema();
  const r = await getPool().query<PersonaDb>(
    `INSERT INTO vids_personas (name, start_id, top_a_id, top_b_id)
     VALUES ($1, $2, $3, $4) RETURNING ${PERSONA_COLS}`,
    [name, patch.startId ?? null, patch.topAId ?? null, patch.topBId ?? null],
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
         (id, folder_id, name, storage_path, thumb_path, mime_type, size_bytes, duration_s, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${VIDEO_COLS}`,
      [
        input.id, input.folderId, input.name, input.storagePath, input.thumbPath, input.mimeType,
        input.sizeBytes, input.duration, input.width, input.height,
      ],
    );
    return toVideo(r.rows[0]);
  } catch (e) {
    // The bytes are already in the bucket — don't leave them orphaned.
    await removeObjects([input.storagePath, ...(input.thumbPath ? [input.thumbPath] : [])]);
    throw e;
  }
}

export interface VideoPatch extends VidContextPatch {
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
}

/** Point an existing row at freshly uploaded bytes, keeping its id — so the
 *  folder it sits in, and every persona part pointing at it, survive an edit.
 *  `marks` comes along because an edit moves them: the caller re-times them
 *  against the footage it just rendered, and omitting them leaves them as they
 *  are (a save that changed no timing).
 *  The objects it used to hold are dropped afterwards (best effort: a leftover
 *  file is harmless, and the row is already correct). */
export async function replaceVideoMedia(
  id: string, media: VideoMedia, name?: string, marks?: VidMark[],
): Promise<VidRow | null> {
  await ensureSchema();
  const pool = getPool();
  const before = await pool.query<Pick<VideoDb, 'storage_path' | 'thumb_path'>>(
    'SELECT storage_path, thumb_path FROM vids_videos WHERE id = $1',
    [id],
  );
  if (!before.rows[0]) return null;

  const r = await pool.query<VideoDb>(
    `UPDATE vids_videos
        SET storage_path = $1, thumb_path = $2, mime_type = $3, size_bytes = $4,
            duration_s = $5, width = $6, height = $7, has_sfx = $8,
            name = COALESCE($9, name), marks = COALESCE($10::jsonb, marks), updated_at = now()
      WHERE id = $11
      RETURNING ${VIDEO_COLS}`,
    [
      media.storagePath, media.thumbPath, media.mimeType, media.sizeBytes,
      media.duration, media.width, media.height, media.hasSfx, name ?? null,
      marks === undefined ? null : JSON.stringify(marks), id,
    ],
  );
  if (!r.rows[0]) return null;

  const old = before.rows[0];
  const stale = [old.storage_path, ...(old.thumb_path ? [old.thumb_path] : [])]
    .filter((p) => p !== media.storagePath && p !== media.thumbPath);
  await removeObjects(stale);
  return toVideo(r.rows[0]);
}

export async function deleteVideo(id: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query<Pick<VideoDb, 'storage_path' | 'thumb_path'>>(
    'DELETE FROM vids_videos WHERE id = $1 RETURNING storage_path, thumb_path',
    [id],
  );
  const row = r.rows[0];
  if (!row) return false;
  await removeObjects([row.storage_path, ...(row.thumb_path ? [row.thumb_path] : [])]);
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
