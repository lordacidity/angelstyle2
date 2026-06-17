// Persistent cache for Google Trends / SerpAPI interest-over-time pulls. The
// upstream is rate-limited (free scrape) and paid (SerpAPI fallback), so once
// we've fetched a term's series we store it here and serve it back instead of
// re-pulling. Keyed by term (lowercased) — which is the profile/market name, so
// this is effectively a per-profile cache.
//
// Lives in the same Railway Postgres as the board tables (DATABASE_PUBLIC_URL),
// NOT the read-only Pauv price-data Supabase — there's no way to touch live
// market data here. The table is prefixed `trends_` so it can't collide with
// the board_* / NPSI tables already in that DB.
//
// We store the RAW upstream points (pre-densify). The seeded "wiggle"
// densification is a presentation transform applied on read by the route, so
// tuning it never requires busting this cache.
//
// Server-only — imported by Next.js route handlers. Never import from a client
// component; it would leak the DB connection string.

import pg from 'pg';

export type TrendPoint = { timestamp: number; value: number };

// ── Connection pool (singleton, hot-reload safe) ──────────────────────────────
// Next.js dev re-evaluates modules on edit; caching on globalThis stops us from
// leaking a new pool every reload until Railway refuses connections.
const g = globalThis as unknown as { __trendsPool?: pg.Pool };

function getPool(): pg.Pool {
  if (g.__trendsPool) return g.__trendsPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) {
    throw new Error('DATABASE_PUBLIC_URL not set — paste Railway\'s Connect-panel value into frontend/.env');
  }
  g.__trendsPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return g.__trendsPool;
}

// ── Schema (self-creating, like board-db.ts) ──────────────────────────────────
let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS trends_cache (
        term       TEXT        PRIMARY KEY,
        points     JSONB       NOT NULL,
        source     TEXT        NOT NULL DEFAULT '',
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  })().catch((e) => {
    // Reset so a transient Railway hiccup doesn't permanently wedge the cache.
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

// Return the stored RAW points if a row exists that's newer than ttlMs, else
// null (miss / stale). pg parses JSONB into a JS value, so `points` comes back
// as the array directly.
export async function getCachedTrends(term: string, ttlMs: number): Promise<TrendPoint[] | null> {
  await ensureSchema();
  const cutoff = new Date(Date.now() - ttlMs);
  const r = await getPool().query<{ points: TrendPoint[] }>(
    `SELECT points FROM trends_cache WHERE term = $1 AND fetched_at > $2`,
    [term, cutoff],
  );
  const points = r.rows[0]?.points;
  return Array.isArray(points) && points.length ? points : null;
}

// Upsert RAW points for a term (overwrites the row + bumps fetched_at).
export async function saveTrends(term: string, points: TrendPoint[], source: string): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO trends_cache (term, points, source, fetched_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (term) DO UPDATE
       SET points = EXCLUDED.points, source = EXCLUDED.source, fetched_at = now()`,
    [term, JSON.stringify(points), source],
  );
}
