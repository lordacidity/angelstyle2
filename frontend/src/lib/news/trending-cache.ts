// The trending list, kept — so that once anybody has read the news, everybody
// after them gets it at once.
//
// A read (lib/news/trending) is twenty-odd feed fetches, up to eight Gemini
// calls side by side and a round of link resolving: half a minute on a good
// day, and the same half minute for every clipper who opens the tab. Nothing
// about it is personal, so one read serves everyone. This keeps each list —
// one per window (1h, 6h, 24h, 7d), one per widened category — in the same
// Postgres the rest of the app uses (DATABASE_PUBLIC_URL), and hands it back
// to the next reader with how old it is.
//
// How old is too old is the window's business. A list is FRESH for a share of
// its window; past that it is still handed over at once, and a new read is
// started behind the reply so the next person gets a fresh one (the route runs
// it with next/server's after(), which keeps the function alive past the
// response). Past the window itself — a "past hour" list from five hours ago
// says nothing about this hour — the reader waits for a new read instead. The
// form's ↻ asks for a fresh read outright, and gets one.
//
// One refresh at a time: a stale list read by ten people in the same minute
// would otherwise start ten reads. `refreshing_at` is the lock; a refresh that
// dies leaves it to expire.
//
// The cache is an optimisation and never a reason to fail: with no database,
// or a database that won't answer, every read goes straight to the news the
// way it always did, and says so once in the log.

import pg from 'pg';
import { trendingNews } from './trending';
import type { TrendingResponse, TrendWindow } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** How long a list is handed over without a refresh being started. */
const FRESH_MS: Record<TrendWindow, number> = { '1h': 10 * MIN, '6h': 20 * MIN, '24h': 40 * MIN, '7d': 2 * HOUR };
/** How long a stale list is still handed over (with a refresh behind it)
 *  before the reader waits for a new one: the window itself, a day at most.
 *  A list older than its own window is about a different window. */
const STALE_MAX_MS: Record<TrendWindow, number> = { '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR, '7d': 24 * HOUR };
/** A widened read (a category typed, Search wider) looks back a week whatever
 *  the window, so it keeps longer. */
const TOPIC_FRESH_MS = 3 * HOUR;
const TOPIC_STALE_MAX_MS = 24 * HOUR;
/** A refresh started this long ago and not finished is taken to have died. */
const REFRESH_LOCK_MS = 3 * MIN;

// ── The table ────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __newsTrendingPool?: pg.Pool; __newsTrendingSchema?: Promise<boolean> };

function getPool(): pg.Pool | null {
  if (g.__newsTrendingPool) return g.__newsTrendingPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) return null;
  g.__newsTrendingPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });
  return g.__newsTrendingPool;
}

/** The table, made once per process. False when there is no database to
 *  make it in, or it could not be reached — the cache then stands aside. */
function ready(): Promise<boolean> {
  if (!g.__newsTrendingSchema) {
    g.__newsTrendingSchema = (async () => {
      const pool = getPool();
      if (!pool) { console.warn('[news] trending cache off — DATABASE_PUBLIC_URL not set'); return false; }
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS news_trending_cache (
            key           text PRIMARY KEY,
            payload       jsonb NOT NULL,
            fetched_at    timestamptz NOT NULL,
            refreshing_at timestamptz
          )
        `);
        return true;
      } catch (err) {
        console.warn('[news] trending cache off —', err instanceof Error ? err.message : err);
        return false;
      }
    })();
  }
  return g.__newsTrendingSchema;
}

interface Row { payload: TrendingResponse; fetched_at: string; refreshing_at: string | null }

/** One list per window, and one per widened category — a category is read
 *  for a week whatever window the form is on, so the window is not in its key. */
const keyOf = (window: TrendWindow, topic: string) => {
  const t = topic.trim().toLowerCase().replace(/\s+/g, ' ');
  return t ? `topic|${t}` : `window|${window}`;
};

async function load(key: string): Promise<Row | null> {
  if (!(await ready())) return null;
  try {
    const r = await getPool()!.query<Row>(
      'SELECT payload, fetched_at, refreshing_at FROM news_trending_cache WHERE key = $1', [key],
    );
    return r.rows[0] ?? null;
  } catch (err) {
    console.warn('[news] trending cache read failed —', err instanceof Error ? err.message : err);
    return null;
  }
}

async function store(key: string, payload: TrendingResponse, fetchedAt: Date): Promise<void> {
  if (!(await ready())) return;
  try {
    await getPool()!.query(
      `INSERT INTO news_trending_cache (key, payload, fetched_at, refreshing_at) VALUES ($1, $2, $3, NULL)
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at, refreshing_at = NULL`,
      [key, JSON.stringify(payload), fetchedAt.toISOString()],
    );
  } catch (err) {
    console.warn('[news] trending cache write failed —', err instanceof Error ? err.message : err);
  }
}

/** Take the refresh lock. False when somebody else holds it and it is not
 *  yet old enough to have died. */
async function lock(key: string): Promise<boolean> {
  if (!(await ready())) return false;
  try {
    const r = await getPool()!.query(
      `UPDATE news_trending_cache SET refreshing_at = now()
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
  await getPool()!.query('UPDATE news_trending_cache SET refreshing_at = NULL WHERE key = $1', [key]).catch(() => undefined);
}

// ── The read ─────────────────────────────────────────────────────────────────

/** A list with when it was read on it. */
const stamp = (payload: TrendingResponse, at: string): TrendingResponse => ({ ...payload, asOf: at });

/** The news read now and kept. */
async function readAndStore(window: TrendWindow, topic: string, key: string): Promise<TrendingResponse> {
  const at = new Date();
  const fresh = await trendingNews(window, topic);
  await store(key, fresh, at);
  return stamp(fresh, at.toISOString());
}

/** What a reader gets: the list, and — when it was handed over stale — the
 *  refresh to run once the reply is on its way (the route puts it through
 *  after()). Null refresh means nothing is owed. */
export interface TrendingHandout {
  response: TrendingResponse;
  refresh: (() => Promise<void>) | null;
}

/** The trending list for a window (or a widened category): from the cache
 *  when there is one young enough, read afresh otherwise — and read afresh
 *  outright when `fresh` asks for it (the form's ↻). See the header. */
export async function getTrending(window: TrendWindow, topic = '', fresh = false): Promise<TrendingHandout> {
  const key = keyOf(window, topic);
  const forTopic = !!topic.trim();
  const freshMs = forTopic ? TOPIC_FRESH_MS : FRESH_MS[window];
  const staleMax = forTopic ? TOPIC_STALE_MAX_MS : STALE_MAX_MS[window];
  const cached = fresh ? null : await load(key);
  const age = cached ? Date.now() - Date.parse(cached.fetched_at) : Infinity;

  // Young enough: handed over as it is.
  if (cached && age < freshMs) return { response: stamp(cached.payload, cached.fetched_at), refresh: null };

  // Stale but not past its window: handed over now, and read again behind
  // the reply — unless somebody is already reading it.
  if (cached && age < staleMax) {
    return {
      response: stamp(cached.payload, cached.fetched_at),
      refresh: async () => {
        if (!(await lock(key))) return;
        try {
          await readAndStore(window, topic, key);
        } catch (err) {
          console.warn('[news] trending refresh failed —', err instanceof Error ? err.message : err);
          await unlock(key);
        }
      },
    };
  }

  // Nothing kept, too old to hand over, or a fresh read asked for: read now.
  // Should the read fail with something kept, however old, that is still a
  // better answer than an error — the form prints its age beside it.
  try {
    return { response: await readAndStore(window, topic, key), refresh: null };
  } catch (err) {
    const fallback = cached ?? (fresh ? await load(key) : null);
    if (fallback) {
      console.warn('[news] trending read failed; the kept list stands —', err instanceof Error ? err.message : err);
      return { response: stamp(fallback.payload, fallback.fetched_at), refresh: null };
    }
    throw err;
  }
}
