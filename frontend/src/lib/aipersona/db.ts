// AI Persona's storage. Two stores, the same split the rest of the Studio uses:
//   rows  → Railway Postgres (DATABASE_PUBLIC_URL), in tables prefixed
//           `aipersona_` so they can't collide with anything already there —
//           least of all the Vids personas, which are a different thing (a
//           bundle of three clips). The tables create themselves on first use.
//   files → the Vids Supabase bucket, under `aipersona/`. Character photos and
//           scene videos go up from the browser on signed URLs; everything made
//           here (the cut clip, its first frame, what fal generates) is written
//           from the server. All of it is read back on plain public URLs, which
//           is also how fal reads its inputs.
//
// Three tables. A persona is a name and a photo. A scene is a cut clip and its
// first frame. A take is one persona's run through one scene: its character
// first frame, then its video — each a job with a status, the fal request it is
// waiting on, the file it made and the prompt it was asked with. A take whose
// scene was approved carries `saved_at`, and that is all "a video saved to a
// persona" is.
//
// Server-only. The section imports lib/aipersona/types.

import pg from 'pg';
import { publicUrl, removeObjects } from '@/lib/vids-db';
import type { JobKind } from './fal';
import { PersonaInputError } from './respond';
import type {
  JobStatus, LibraryPayload, Persona, PersonaVideo, Scene, SceneJob, SceneStage, SceneSummary,
} from './types';

// ── Connection pool (singleton, hot-reload safe) ──────────────────────────────
// Bump SCHEMA_VERSION whenever SCHEMA below changes, so a process that started
// before the change re-runs the (idempotent) DDL.
const SCHEMA_VERSION = 2;

const g = globalThis as unknown as {
  __aipersonaPool?: pg.Pool;
  __aipersonaSchema?: { version: number; ready: Promise<void> } | null;
};

function getPool(): pg.Pool {
  if (g.__aipersonaPool) return g.__aipersonaPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) throw new Error('DATABASE_PUBLIC_URL not set');
  // A small pool: this DB is shared with the Board and the rest of the Studio.
  g.__aipersonaPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 4 });
  return g.__aipersonaPool;
}

const JOB_COLUMNS = (kind: JobKind) => `
    ${kind}_status     TEXT NOT NULL DEFAULT 'idle',
    ${kind}_request    TEXT,
    ${kind}_path       TEXT,
    ${kind}_prompt     TEXT NOT NULL DEFAULT '',
    ${kind}_error      TEXT NOT NULL DEFAULT '',
    ${kind}_claimed_at TIMESTAMPTZ,`;

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS aipersona_personas (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    photo_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS aipersona_scenes (
    id           UUID PRIMARY KEY,
    name         TEXT NOT NULL,
    stage        TEXT NOT NULL DEFAULT 'frames',
    clip_path    TEXT NOT NULL,
    frame_path   TEXT NOT NULL,
    width        INTEGER NOT NULL DEFAULT 0,
    height       INTEGER NOT NULL DEFAULT 0,
    duration     REAL NOT NULL DEFAULT 0,
    frame_prompt TEXT NOT NULL DEFAULT '',
    video_prompt TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Deleting a persona or a scene takes its takes with it.
  `CREATE TABLE IF NOT EXISTS aipersona_takes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id   UUID NOT NULL REFERENCES aipersona_scenes(id) ON DELETE CASCADE,
    persona_id UUID NOT NULL REFERENCES aipersona_personas(id) ON DELETE CASCADE,
    ${JOB_COLUMNS('frame')}
    ${JOB_COLUMNS('video')}
    saved_at   TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scene_id, persona_id)
  )`,
  `CREATE INDEX IF NOT EXISTS aipersona_takes_persona ON aipersona_takes (persona_id)`,
  // A profile picture, made from the photo on request (see avatar route).
  `ALTER TABLE aipersona_personas ADD COLUMN IF NOT EXISTS avatar_path TEXT`,
];

function ensureSchema(): Promise<void> {
  if (g.__aipersonaSchema?.version === SCHEMA_VERSION) return g.__aipersonaSchema.ready;
  const ready = (async () => {
    for (const sql of SCHEMA) await getPool().query(sql);
  })().catch((e) => {
    // Don't wedge on a transient failure — retry on the next request.
    g.__aipersonaSchema = null;
    throw e;
  });
  g.__aipersonaSchema = { version: SCHEMA_VERSION, ready };
  return ready;
}

async function query<R extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<pg.QueryResult<R>> {
  await ensureSchema();
  return getPool().query<R>(sql, values);
}

// ── Where files go ────────────────────────────────────────────────────────────

const PREFIX = 'aipersona';
export const photoPath = (id: string, ext: string) => `${PREFIX}/photos/${id}.${ext}`;
export const avatarPath = (personaId: string) => `${PREFIX}/avatars/${personaId}-${Date.now()}.jpg`;
/** Where the browser asks for a photo's thumbnail (made on first ask). */
export const thumbUrl = (path: string) => `/api/ai-persona/thumb?p=${encodeURIComponent(path)}`;
export const sourcePath = (id: string, ext: string) => `${PREFIX}/sources/${id}.${ext}`;
export const sceneFile = (sceneId: string, file: string) => `${PREFIX}/scenes/${sceneId}/${file}`;

const OBJECT_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]{2,5}';
/** Paths only ever come back from our own upload route, but they pass through
 *  the browser on the way — so they are checked for shape before use. */
export const isPhotoPath = (v: unknown): v is string =>
  typeof v === 'string' && new RegExp(`^${PREFIX}/photos/${OBJECT_ID}$`).test(v);
export const isSourcePath = (v: unknown): v is string =>
  typeof v === 'string' && new RegExp(`^${PREFIX}/sources/${OBJECT_ID}$`).test(v);

// ── Records: the rows as the server works with them ───────────────────────────

export interface JobRecord {
  status: JobStatus;
  /** The fal request it is waiting on, while running. */
  request: string | null;
  path: string | null;
  prompt: string;
  error: string;
}

export interface TakeRecord {
  id: string;
  personaId: string;
  personaName: string;
  photoPath: string;
  frame: JobRecord;
  video: JobRecord;
}

export interface SceneRecord {
  id: string;
  name: string;
  stage: SceneStage;
  clipPath: string;
  framePath: string;
  width: number;
  height: number;
  duration: number;
  framePrompt: string;
  videoPrompt: string;
  createdAt: string;
  takes: TakeRecord[];
}

/** What a poll learned about a running job that isn't worth storing — its
 *  queue place, or why it couldn't be checked. Keyed `${takeId}:${kind}`. */
export type Live = Map<string, { queue: number | null; working: boolean; note?: string }>;

interface SceneDb {
  id: string; name: string; stage: SceneStage; clip_path: string; frame_path: string;
  width: number; height: number; duration: number; frame_prompt: string; video_prompt: string; created_at: Date;
}

type JobDb<K extends JobKind> = {
  [F in 'status' | 'request' | 'path' | 'prompt' | 'error' as `${K}_${F}`]:
    F extends 'status' ? JobStatus : F extends 'request' | 'path' ? string | null : string;
};
type TakeDb = { id: string; persona_id: string; persona_name: string; photo_path: string } & JobDb<'frame'> & JobDb<'video'>;

const toTake = (r: TakeDb): TakeRecord => ({
  id: r.id,
  personaId: r.persona_id,
  personaName: r.persona_name,
  photoPath: r.photo_path,
  frame: { status: r.frame_status, request: r.frame_request, path: r.frame_path, prompt: r.frame_prompt, error: r.frame_error },
  video: { status: r.video_status, request: r.video_request, path: r.video_path, prompt: r.video_prompt, error: r.video_error },
});

function toJob(take: TakeRecord, kind: JobKind, live?: Live): SceneJob {
  const job = take[kind];
  const now = job.status === 'running' ? live?.get(`${take.id}:${kind}`) : undefined;
  return {
    status: job.status,
    url: job.path ? publicUrl(job.path) : null,
    prompt: job.prompt,
    error: job.error,
    ...(now ? { queue: now.queue, working: now.working, ...(now.note ? { note: now.note } : {}) } : {}),
  };
}

/** A scene as the section sees it: paths turned into URLs, request ids left
 *  behind. */
export function toScene(rec: SceneRecord, live?: Live): Scene {
  return {
    id: rec.id,
    name: rec.name,
    stage: rec.stage,
    clipUrl: publicUrl(rec.clipPath),
    frameUrl: publicUrl(rec.framePath),
    width: rec.width,
    height: rec.height,
    duration: rec.duration,
    framePrompt: rec.framePrompt,
    videoPrompt: rec.videoPrompt,
    createdAt: rec.createdAt,
    takes: rec.takes.map((t) => ({
      id: t.id,
      personaId: t.personaId,
      personaName: t.personaName,
      photoUrl: publicUrl(t.photoPath),
      thumbUrl: thumbUrl(t.photoPath),
      frame: toJob(t, 'frame', live),
      video: toJob(t, 'video', live),
    })),
  };
}

// ── The front screen ──────────────────────────────────────────────────────────

interface PersonaDb { id: string; name: string; photo_path: string; avatar_path: string | null; created_at: Date }
const PERSONA_COLS = 'id, name, photo_path, avatar_path, created_at';

const toPersona = (r: PersonaDb, videos: PersonaVideo[] = []): Persona => ({
  id: r.id, name: r.name, photoUrl: publicUrl(r.photo_path), thumbUrl: thumbUrl(r.photo_path), avatarUrl: r.avatar_path ? publicUrl(r.avatar_path) : null,
  createdAt: r.created_at.toISOString(), videos,
});

export async function getLibrary(): Promise<LibraryPayload> {
  const [personas, videos, scenes] = await Promise.all([
    query<PersonaDb>(`SELECT ${PERSONA_COLS} FROM aipersona_personas ORDER BY created_at`),
    query<{ id: string; persona_id: string; scene_id: string; scene_name: string; video_path: string; frame_path: string | null; saved_at: Date }>(
      `SELECT t.id, t.persona_id, t.scene_id, s.name AS scene_name, t.video_path, t.frame_path, t.saved_at
         FROM aipersona_takes t JOIN aipersona_scenes s ON s.id = t.scene_id
        WHERE t.saved_at IS NOT NULL AND t.video_path IS NOT NULL
        ORDER BY t.saved_at DESC, t.id`,
    ),
    query<SceneDb & { personas: number }>(
      `SELECT s.*, (SELECT count(*) FROM aipersona_takes t WHERE t.scene_id = s.id)::int AS personas
         FROM aipersona_scenes s WHERE s.stage <> 'done' ORDER BY s.created_at DESC`,
    ),
  ]);

  const byPersona = new Map<string, PersonaVideo[]>();
  for (const v of videos.rows) {
    const list = byPersona.get(v.persona_id) ?? [];
    list.push({
      id: v.id, sceneId: v.scene_id, sceneName: v.scene_name, url: publicUrl(v.video_path),
      frameUrl: v.frame_path ? publicUrl(v.frame_path) : null, savedAt: v.saved_at.toISOString(),
    });
    byPersona.set(v.persona_id, list);
  }
  return {
    personas: personas.rows.map((p) => toPersona(p, byPersona.get(p.id))),
    scenes: scenes.rows.map((s): SceneSummary => ({
      id: s.id, name: s.name, stage: s.stage, frameUrl: publicUrl(s.frame_path),
      personas: s.personas, createdAt: s.created_at.toISOString(),
    })),
  };
}

// ── Personas ──────────────────────────────────────────────────────────────────

export async function createPersona(name: string, photo: string): Promise<Persona> {
  const r = await query<PersonaDb>(
    `INSERT INTO aipersona_personas (name, photo_path) VALUES ($1, $2) RETURNING ${PERSONA_COLS}`,
    [name, photo],
  );
  return toPersona(r.rows[0]);
}

/** Rename, or swap the character photo. The old photo is dropped from the
 *  bucket once the row points at the new one. The videos are not sent back —
 *  the section keeps the ones it has. */
export async function updatePersona(id: string, patch: { name?: string; photoPath?: string }): Promise<Persona | null> {
  const before = patch.photoPath
    ? (await query<{ photo_path: string }>('SELECT photo_path FROM aipersona_personas WHERE id = $1', [id])).rows[0]
    : undefined;
  const r = await query<PersonaDb>(
    `UPDATE aipersona_personas SET name = COALESCE($2, name), photo_path = COALESCE($3, photo_path)
      WHERE id = $1 RETURNING ${PERSONA_COLS}`,
    [id, patch.name ?? null, patch.photoPath ?? null],
  );
  if (!r.rows[0]) return null;
  if (before && before.photo_path !== r.rows[0].photo_path) await removeObjects([before.photo_path]);
  return toPersona(r.rows[0]);
}

/** Deleting a persona takes its videos, and its place in any scene still in
 *  progress, with it. */
export async function deletePersona(id: string): Promise<boolean> {
  const files = await query<{ frame_path: string | null; video_path: string | null }>(
    'SELECT frame_path, video_path FROM aipersona_takes WHERE persona_id = $1', [id],
  );
  const r = await query<{ photo_path: string; avatar_path: string | null }>('DELETE FROM aipersona_personas WHERE id = $1 RETURNING photo_path, avatar_path', [id]);
  if (!r.rows[0]) return false;
  await removeObjects([r.rows[0].photo_path, r.rows[0].avatar_path, ...files.rows.flatMap((f) => [f.frame_path, f.video_path])].filter((p): p is string => !!p));
  return true;
}

/** The stored photo of one persona, for making its profile picture. */
export async function personaPhoto(id: string): Promise<string | null> {
  const r = await query<{ photo_path: string }>('SELECT photo_path FROM aipersona_personas WHERE id = $1', [id]);
  return r.rows[0]?.photo_path ?? null;
}

/** Point a persona at a new profile picture, and drop the old one. */
export async function setAvatar(id: string, path: string): Promise<Persona | null> {
  const before = (await query<{ avatar_path: string | null }>('SELECT avatar_path FROM aipersona_personas WHERE id = $1', [id])).rows[0];
  const r = await query<PersonaDb>(`UPDATE aipersona_personas SET avatar_path = $2 WHERE id = $1 RETURNING ${PERSONA_COLS}`, [id, path]);
  if (!r.rows[0]) { await removeObjects([path]); return null; }
  if (before?.avatar_path && before.avatar_path !== path) await removeObjects([before.avatar_path]);
  return toPersona(r.rows[0]);
}

/** Every persona's name and profile picture, for the other sections that list
 *  the same people (Vids2 matches them by name). */
export async function listAvatars(): Promise<{ name: string; avatarUrl: string }[]> {
  const r = await query<{ name: string; avatar_path: string }>(
    'SELECT name, avatar_path FROM aipersona_personas WHERE avatar_path IS NOT NULL ORDER BY created_at',
  );
  return r.rows.map((x) => ({ name: x.name, avatarUrl: publicUrl(x.avatar_path) }));
}

// ── Scenes ────────────────────────────────────────────────────────────────────

const TAKE_COLS = (['frame', 'video'] as const)
  .flatMap((k) => ['status', 'request', 'path', 'prompt', 'error'].map((f) => `t.${k}_${f}`))
  .join(', ');

export async function loadScene(id: string): Promise<SceneRecord | null> {
  const [scene, takes] = await Promise.all([
    query<SceneDb>('SELECT * FROM aipersona_scenes WHERE id = $1', [id]),
    query<TakeDb>(
      `SELECT t.id, t.persona_id, p.name AS persona_name, p.photo_path, ${TAKE_COLS}
         FROM aipersona_takes t JOIN aipersona_personas p ON p.id = t.persona_id
        WHERE t.scene_id = $1 ORDER BY p.created_at, t.id`,
      [id],
    ),
  ]);
  const s = scene.rows[0];
  if (!s) return null;
  return {
    id: s.id, name: s.name, stage: s.stage, clipPath: s.clip_path, framePath: s.frame_path,
    width: s.width, height: s.height, duration: s.duration, framePrompt: s.frame_prompt, videoPrompt: s.video_prompt,
    createdAt: s.created_at.toISOString(), takes: takes.rows.map(toTake),
  };
}

/** The scene and a take for every persona named, in one go. Personas that no
 *  longer exist are passed over; none at all is an error. */
export async function createScene(scene: {
  id: string; name: string; clipPath: string; framePath: string; width: number; height: number; duration: number;
  framePrompt: string; personaIds: string[];
}): Promise<SceneRecord> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO aipersona_scenes (id, name, clip_path, frame_path, width, height, duration, frame_prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [scene.id, scene.name, scene.clipPath, scene.framePath, scene.width, scene.height, scene.duration, scene.framePrompt],
    );
    const takes = await client.query(
      `INSERT INTO aipersona_takes (scene_id, persona_id)
       SELECT $1, id FROM aipersona_personas WHERE id = ANY($2::uuid[])`,
      [scene.id, scene.personaIds],
    );
    if (!takes.rowCount) throw new PersonaInputError('None of those characters exist any more.');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return (await loadScene(scene.id))!;
}

export async function setStage(id: string, stage: SceneStage, videoPrompt?: string): Promise<void> {
  await query(
    'UPDATE aipersona_scenes SET stage = $2, video_prompt = COALESCE($3, video_prompt) WHERE id = $1',
    [id, stage, videoPrompt ?? null],
  );
}

/** Approve all: every take's video is now a video of its persona. */
export async function saveScene(id: string): Promise<void> {
  await query('UPDATE aipersona_takes SET saved_at = now() WHERE scene_id = $1 AND saved_at IS NULL', [id]);
  await setStage(id, 'done');
}

/** Drop a scene that was never approved, and every file it made. */
export async function deleteScene(rec: SceneRecord): Promise<void> {
  await query('DELETE FROM aipersona_scenes WHERE id = $1', [rec.id]);
  await removeObjects(
    [rec.clipPath, rec.framePath, ...rec.takes.flatMap((t) => [t.frame.path, t.video.path])].filter((p): p is string => !!p),
  );
}

/** Take one persona out of a scene — or, once the scene is approved, delete
 *  that persona's video of it. */
export async function deleteTake(id: string): Promise<boolean> {
  const r = await query<{ frame_path: string | null; video_path: string | null }>(
    'DELETE FROM aipersona_takes WHERE id = $1 RETURNING frame_path, video_path', [id],
  );
  if (!r.rows[0]) return false;
  await removeObjects([r.rows[0].frame_path, r.rows[0].video_path].filter((p): p is string => !!p));
  return true;
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
// `kind` picks the column set and only ever comes from code, never a request.
// Everything that lands a result is matched on the request id as well as the
// take, so a result that turns up after a redo was asked for can't overwrite
// the redo.

/** fal took the job. Whatever the last run made is no longer what this take
 *  shows, so its file is dropped. */
export async function jobQueued(take: TakeRecord, kind: JobKind, request: string, prompt: string): Promise<void> {
  await query(
    `UPDATE aipersona_takes SET ${kind}_status = 'running', ${kind}_request = $2, ${kind}_prompt = $3,
            ${kind}_error = '', ${kind}_path = NULL, ${kind}_claimed_at = NULL
      WHERE id = $1`,
    [take.id, request, prompt],
  );
  if (take[kind].path) await removeObjects([take[kind].path]);
}

/** fal would not take the job at all. */
export async function jobRefused(take: TakeRecord, kind: JobKind, error: string, prompt: string): Promise<void> {
  await query(
    `UPDATE aipersona_takes SET ${kind}_status = 'error', ${kind}_request = NULL, ${kind}_prompt = $3,
            ${kind}_error = $2, ${kind}_path = NULL, ${kind}_claimed_at = NULL
      WHERE id = $1`,
    [take.id, error, prompt],
  );
  if (take[kind].path) await removeObjects([take[kind].path]);
}

/** One poll at a time gets to fetch a finished job's result and file it. A
 *  claim that was never followed through (the request died mid-copy) lapses
 *  after two minutes, so the next poll can pick it up. */
export async function claimJob(takeId: string, kind: JobKind, request: string): Promise<boolean> {
  const r = await query(
    `UPDATE aipersona_takes SET ${kind}_claimed_at = now()
      WHERE id = $1 AND ${kind}_request = $2 AND ${kind}_status = 'running'
        AND (${kind}_claimed_at IS NULL OR ${kind}_claimed_at < now() - interval '2 minutes')`,
    [takeId, request],
  );
  return !!r.rowCount;
}

/** False if the take has moved on to another request since — the caller then
 *  owns the file it just stored, and should drop it. */
export async function jobDone(takeId: string, kind: JobKind, request: string, path: string): Promise<boolean> {
  const r = await query(
    `UPDATE aipersona_takes SET ${kind}_status = 'done', ${kind}_path = $3, ${kind}_error = ''
      WHERE id = $1 AND ${kind}_request = $2`,
    [takeId, request, path],
  );
  return !!r.rowCount;
}

export async function jobFailed(takeId: string, kind: JobKind, request: string, error: string): Promise<void> {
  await query(
    `UPDATE aipersona_takes SET ${kind}_status = 'error', ${kind}_error = $3 WHERE id = $1 AND ${kind}_request = $2`,
    [takeId, request, error],
  );
}
