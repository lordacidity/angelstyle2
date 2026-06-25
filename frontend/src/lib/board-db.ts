// Shared "board" — three Excel-like tables (markets / athletes / artists) that
// anyone can add links + info to. Lives in Railway Postgres (PauvDistribution's
// own data DB, DATABASE_PUBLIC_URL) — completely separate from the read-only
// Pauv price-data Supabase, so there's no way to touch live market data here.
//
// Physical tables are prefixed `board_` so they can't collide with the existing
// markets-history / NPSI tables already in that DB. The schema is identical for
// all three: posted (checkbox) + url + vid_caption + context + notes.
//
// This module is server-only (imported by Next.js route handlers). Never import
// it from a client component — it would leak the DB connection string.

import pg from 'pg';

// ── Allowlisted tables ────────────────────────────────────────────────────────
// Table identifiers can't be parameterized in SQL, so callers pass one of these
// keys and we map it to a hard-coded physical name. This is the injection guard.
export const BOARD_TABLES = ['markets', 'athletes', 'artists'] as const;
export type BoardTable = (typeof BOARD_TABLES)[number];

const PHYSICAL: Record<BoardTable, string> = {
  markets: 'board_markets',
  athletes: 'board_athletes',
  artists: 'board_artists',
};

// Retention: rows are permanently deleted once they're older than this many days
// (anchored on created_at — when the row was added). The board is a short-lived
// working queue, so old links age out automatically to keep it small and fast.
export const BOARD_RETENTION_DAYS = 5;

// Hard cap on rows returned per table — a safety net so a runaway table can never
// balloon the payload / render cost even if the purge hasn't run yet.
const BOARD_ROW_CAP = 500;

// Running a DELETE on every single GET would add write latency to every load, so
// the purge is throttled: at most once per this interval per table per process.
// Cached on globalThis so a dev hot-reload doesn't reset the clock and re-purge
// on every edit.
const PURGE_INTERVAL_MS = 10 * 60 * 1000;
const gpurge = globalThis as unknown as { __boardLastPurge?: Record<string, number> };

export function isBoardTable(v: string): v is BoardTable {
  return (BOARD_TABLES as readonly string[]).includes(v);
}

// Pull only the known editable fields off a request body — ignore anything else
// so a client can't smuggle in arbitrary column names. Shared by the create
// (POST) and update (PATCH) routes.
export function pickBoardFields(body: unknown): BoardPatch {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: BoardPatch = {};
  if (typeof b.posted === 'boolean') patch.posted = b.posted;
  if (typeof b.unusable === 'boolean') patch.unusable = b.unusable;
  if (typeof b.url === 'string') patch.url = b.url;
  if (typeof b.vidCaption === 'string') patch.vidCaption = b.vidCaption;
  if (typeof b.context === 'string') patch.context = b.context;
  if (typeof b.notes === 'string') patch.notes = b.notes;
  return patch;
}

// ── Editable columns ──────────────────────────────────────────────────────────
const TEXT_COLS = ['url', 'vid_caption', 'context', 'notes'] as const;
type TextCol = (typeof TEXT_COLS)[number];

export interface BoardRow {
  id: string;
  posted: boolean;
  unusable: boolean;
  url: string;
  vidCaption: string;
  context: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardPatch {
  posted?: boolean;
  unusable?: boolean;
  url?: string;
  vidCaption?: string;
  context?: string;
  notes?: string;
}

// ── Connection pool (singleton, hot-reload safe) ──────────────────────────────
// Next.js dev re-evaluates modules on edit; without caching on globalThis we'd
// leak a new pool every reload until Railway refused connections.
const g = globalThis as unknown as { __boardPool?: pg.Pool };

function getPool(): pg.Pool {
  if (g.__boardPool) return g.__boardPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) {
    throw new Error('DATABASE_PUBLIC_URL not set — paste Railway\'s Connect-panel value into frontend/.env');
  }
  g.__boardPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return g.__boardPool;
}

// ── Schema (self-creating, like templates.ts) ─────────────────────────────────
let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const pool = getPool();
    for (const physical of Object.values(PHYSICAL)) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${physical} (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          posted      BOOLEAN     NOT NULL DEFAULT false,
          unusable    BOOLEAN     NOT NULL DEFAULT false,
          url         TEXT        NOT NULL DEFAULT '',
          vid_caption TEXT        NOT NULL DEFAULT '',
          context     TEXT        NOT NULL DEFAULT '',
          notes       TEXT        NOT NULL DEFAULT '',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      // Backfill the column on tables created before `unusable` existed.
      await pool.query(
        `ALTER TABLE ${physical} ADD COLUMN IF NOT EXISTS unusable BOOLEAN NOT NULL DEFAULT false`,
      );
      // Index created_at — the board both sorts (ORDER BY created_at DESC) and
      // purges (WHERE created_at < cutoff) on it, so an index keeps both cheap.
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${physical}_created_at_idx ON ${physical} (created_at DESC)`,
      );
    }
  })().catch((e) => {
    // Reset so a transient Railway hiccup doesn't permanently wedge the board.
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

interface DbRow {
  id: string;
  posted: boolean;
  unusable: boolean;
  url: string;
  vid_caption: string;
  context: string;
  notes: string;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: DbRow): BoardRow {
  return {
    id: r.id,
    posted: r.posted,
    unusable: r.unusable,
    url: r.url,
    vidCaption: r.vid_caption,
    context: r.context,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const SELECT_COLS =
  'id, posted, unusable, url, vid_caption, context, notes, created_at, updated_at';

// Permanently delete rows older than BOARD_RETENTION_DAYS. Throttled to once per
// PURGE_INTERVAL_MS per table so it doesn't add a write to every load. Best-effort:
// a failed purge never blocks the list (the rows just linger until the next pass).
async function purgeExpired(table: BoardTable): Promise<void> {
  const now = Date.now();
  const last = gpurge.__boardLastPurge?.[table] ?? 0;
  if (now - last < PURGE_INTERVAL_MS) return;
  gpurge.__boardLastPurge = { ...(gpurge.__boardLastPurge ?? {}), [table]: now };
  try {
    await getPool().query(
      `DELETE FROM ${PHYSICAL[table]} WHERE created_at < now() - make_interval(days => $1)`,
      [BOARD_RETENTION_DAYS],
    );
  } catch (e) {
    // Don't wedge the board on a transient purge failure — let it retry next pass.
    gpurge.__boardLastPurge = { ...(gpurge.__boardLastPurge ?? {}), [table]: last };
    console.error('[board purge]', e);
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function listRows(table: BoardTable): Promise<BoardRow[]> {
  await ensureSchema();
  // Age out expired rows first (throttled), so the board shrinks on its own.
  await purgeExpired(table);
  const r = await getPool().query<DbRow>(
    // Newest first — the board reads top-to-bottom with the most recent rows up
    // top, and freshly-added rows land at the top of the list. Capped so the
    // payload can never run away.
    `SELECT ${SELECT_COLS} FROM ${PHYSICAL[table]} ORDER BY created_at DESC LIMIT ${BOARD_ROW_CAP}`,
  );
  return r.rows.map(toRow);
}

export async function createRow(
  table: BoardTable,
  initial?: BoardPatch,
): Promise<BoardRow> {
  await ensureSchema();

  // Build an INSERT from whatever whitelisted fields were supplied; columns not
  // given fall back to their schema defaults (posted=false, text=''). With no
  // fields at all this is a plain blank row.
  const cols: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, val: unknown) => {
    vals.push(val);
    cols.push(col);
  };
  if (initial?.posted !== undefined) add('posted', Boolean(initial.posted));
  if (initial?.unusable !== undefined) add('unusable', Boolean(initial.unusable));
  if (initial?.url !== undefined) add('url', String(initial.url));
  if (initial?.vidCaption !== undefined) add('vid_caption', String(initial.vidCaption));
  if (initial?.context !== undefined) add('context', String(initial.context));
  if (initial?.notes !== undefined) add('notes', String(initial.notes));

  const sql =
    cols.length === 0
      ? `INSERT INTO ${PHYSICAL[table]} DEFAULT VALUES RETURNING ${SELECT_COLS}`
      : `INSERT INTO ${PHYSICAL[table]} (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING ${SELECT_COLS}`;

  const r = await getPool().query<DbRow>(sql, cols.length ? vals : undefined);
  return toRow(r.rows[0]);
}

export async function updateRow(
  table: BoardTable,
  id: string,
  patch: BoardPatch,
): Promise<BoardRow | null> {
  await ensureSchema();

  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [];

  if (patch.posted !== undefined) {
    vals.push(Boolean(patch.posted));
    sets.push(`posted = $${vals.length}`);
  }
  if (patch.unusable !== undefined) {
    vals.push(Boolean(patch.unusable));
    sets.push(`unusable = $${vals.length}`);
  }
  const textPatch: Record<TextCol, string | undefined> = {
    url: patch.url,
    vid_caption: patch.vidCaption,
    context: patch.context,
    notes: patch.notes,
  };
  for (const col of TEXT_COLS) {
    if (textPatch[col] !== undefined) {
      vals.push(String(textPatch[col]));
      sets.push(`${col} = $${vals.length}`);
    }
  }

  vals.push(id);
  const r = await getPool().query<DbRow>(
    `UPDATE ${PHYSICAL[table]} SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING ${SELECT_COLS}`,
    vals,
  );
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

export async function deleteRow(table: BoardTable, id: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query(`DELETE FROM ${PHYSICAL[table]} WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}
