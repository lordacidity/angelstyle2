// Something read once and kept for everybody — the trending news, the Pauv
// roster: anything slow to read, the same for every reader, and fine a few
// minutes old.
//
// A reader asks for a key and says how to read it afresh. What comes back is
// the kept value with its age on it, at once, and the rule is:
//
//   younger than FRESH        handed over as it is
//   older, within STALE_MAX   handed over as it is, and read again behind the
//                             reply so the next reader gets a fresh one — the
//                             route runs the refresh with next/server's
//                             after(), which keeps the function alive past
//                             the response
//   older than STALE_MAX      the reader waits for a fresh read
//   `fresh` asked for         a fresh read, unless one landed a minute ago
//
// Kept in the same Postgres the rest of the app uses (DATABASE_PUBLIC_URL),
// which is what makes it shared: Vercel runs many copies of a route, and a
// copy's memory is its own. One refresh at a time per key — `refreshing_at`
// is the lock, and a refresh that dies leaves it to expire — and the cache is
// never a reason to fail: with no database, or one that won't answer, every
// read goes straight to the source and says so once in the log. A read that
// fails with something kept, however old, hands the kept thing over instead.

import pg from 'pg';

const MIN = 60_000;
/** A refresh started this long ago and not finished is taken to have died. */
const REFRESH_LOCK_MS = 3 * MIN;
/** A fresh read asked for within this of the last one is the last one. */
const FRESH_DEDUPE_MS = MIN;

export interface KeptPolicy {
  /** Handed over without a refresh while younger than this. */
  freshMs: number;
  /** Handed over stale, with a refresh behind it, while younger than this. */
  staleMaxMs: number;
}

/** What a reader gets. */
export interface Kept<T> {
  value: T;
  /** When it was read (ISO). */
  asOf: string;
  /** True when it was handed over past FRESH — a refresh is owed (below), or
   *  is already running for somebody else. */
  stale: boolean;
  /** The refresh to run once the reply is on its way; null when none is owed. */
  refresh: (() => Promise<void>) | null;
}

// ── The table ────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __keptPool?: pg.Pool; __keptSchema?: Promise<boolean> };

function getPool(): pg.Pool | null {
  if (g.__keptPool) return g.__keptPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) return null;
  g.__keptPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });
  return g.__keptPool;
}

/** The table, made once per process. False when there is no database to
 *  make it in, or it could not be reached — the cache then stands aside. */
function ready(): Promise<boolean> {
  if (!g.__keptSchema) {
    g.__keptSchema = (async () => {
      const pool = getPool();
      if (!pool) { console.warn('[kept] off — DATABASE_PUBLIC_URL not set'); return false; }
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS kept (
            key           text PRIMARY KEY,
            payload       jsonb NOT NULL,
            fetched_at    timestamptz NOT NULL,
            refreshing_at timestamptz
          )
        `);
        return true;
      } catch (err) {
        console.warn('[kept] off —', err instanceof Error ? err.message : err);
        return false;
      }
    })();
  }
  return g.__keptSchema;
}

interface Row<T> { payload: T; fetched_at: string; refreshing_at: string | null }

async function load<T>(key: string): Promise<Row<T> | null> {
  if (!(await ready())) return null;
  try {
    const r = await getPool()!.query<Row<T>>('SELECT payload, fetched_at, refreshing_at FROM kept WHERE key = $1', [key]);
    return r.rows[0] ?? null;
  } catch (err) {
    console.warn(`[kept] read of ${key} failed —`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function store<T>(key: string, payload: T, fetchedAt: Date): Promise<void> {
  if (!(await ready())) return;
  try {
    await getPool()!.query(
      `INSERT INTO kept (key, payload, fetched_at, refreshing_at) VALUES ($1, $2, $3, NULL)
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at, refreshing_at = NULL`,
      [key, JSON.stringify(payload), fetchedAt.toISOString()],
    );
  } catch (err) {
    console.warn(`[kept] write of ${key} failed —`, err instanceof Error ? err.message : err);
  }
}

/** Take the refresh lock. False when somebody else holds it and it is not
 *  yet old enough to have died. */
async function lock(key: string): Promise<boolean> {
  if (!(await ready())) return false;
  try {
    const r = await getPool()!.query(
      `UPDATE kept SET refreshing_at = now()
       WHERE key = $1 AND (refreshing_at IS NULL OR refreshing_at < now() - ($2::int * interval '1 millisecond'))`,
      [key, REFRESH_LOCK_MS],
    );
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

async function unlock(key: string): Promise<void> {
  if (!(await ready())) return;
  await getPool()!.query('UPDATE kept SET refreshing_at = NULL WHERE key = $1', [key]).catch(() => undefined);
}

// ── The read ─────────────────────────────────────────────────────────────────

/** Read afresh and keep. */
async function readAndStore<T>(key: string, read: () => Promise<T>): Promise<Kept<T>> {
  const at = new Date();
  const value = await read();
  await store(key, value, at);
  return { value, asOf: at.toISOString(), stale: false, refresh: null };
}

/** The kept value under `key`, by the rule in the header. `read` is how it
 *  is read afresh; `fresh` asks for that outright. */
export async function kept<T>(key: string, read: () => Promise<T>, policy: KeptPolicy, fresh = false): Promise<Kept<T>> {
  const row = await load<T>(key);
  const age = row ? Date.now() - Date.parse(row.fetched_at) : Infinity;

  // A fresh read asked for — unless one landed a moment ago, which is it.
  if (fresh && row && age < FRESH_DEDUPE_MS) return { value: row.payload, asOf: row.fetched_at, stale: false, refresh: null };

  // Young enough: handed over as it is.
  if (!fresh && row && age < policy.freshMs) return { value: row.payload, asOf: row.fetched_at, stale: false, refresh: null };

  // Stale but within bounds: handed over now, and read again behind the
  // reply — unless somebody is already reading it.
  if (!fresh && row && age < policy.staleMaxMs) {
    return {
      value: row.payload,
      asOf: row.fetched_at,
      stale: true,
      refresh: async () => {
        if (!(await lock(key))) return;
        try {
          await readAndStore(key, read);
        } catch (err) {
          console.warn(`[kept] refresh of ${key} failed —`, err instanceof Error ? err.message : err);
          await unlock(key);
        }
      },
    };
  }

  // Nothing kept, too old to hand over, or a fresh read asked for: read now.
  try {
    return await readAndStore(key, read);
  } catch (err) {
    if (row) {
      console.warn(`[kept] read of ${key} failed; the kept one stands —`, err instanceof Error ? err.message : err);
      return { value: row.payload, asOf: row.fetched_at, stale: true, refresh: null };
    }
    throw err;
  }
}
