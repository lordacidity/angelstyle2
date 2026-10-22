// One way to open a pool on the Railway Postgres every Studio feature shares
// (DATABASE_PUBLIC_URL): the board, the Vids library, the pricer, Aiden, all of
// them. Each feature still keeps its own pool; this only decides how a pool
// behaves when Railway does not.
//
// Three things a bare `new pg.Pool()` gets wrong against Railway:
//
// - No 'error' listener. When Railway restarts, redeploys or drops an idle
//   connection, pg emits 'error' on the pool, and with nobody listening Node
//   treats it as an uncaught exception: the server process dies, and every
//   request on it fails until a fresh one starts. With a listener pg just
//   discards the dead client and the next query opens a new one.
// - No connect timeout. If Railway's proxy is slow or down, a query waits for
//   a connection forever (until the platform kills the function), so the page
//   sits on "Loading…" instead of showing an error.
// - pg's default of 10 connections per pool. There are a dozen pools, in every
//   serverless instance, all on one database; at that size a busy afternoon
//   reaches Railway's connection limit and every query starts failing with
//   "too many clients already". Each instance serves a request or two at a
//   time, so a few connections per pool is plenty.

import pg from 'pg';

export function railwayPool(connectionString: string, opts: { max?: number; name?: string } = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: opts.max ?? 3,
    connectionTimeoutMillis: 10_000,
    // Let go of idle connections well before Railway's proxy would cut them.
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  });
  pool.on('error', (err) => {
    console.error(`[railway${opts.name ? ` ${opts.name}` : ''}] dropped an idle connection:`, err.message);
  });
  return pool;
}

/** Errors that mean the connection went away under the query, not that the
 *  query was wrong: worth one more try on a fresh connection. A connect that
 *  timed out is not one of them: trying again would only wait as long again. */
export function isConnectionDrop(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (/connection timeout|timeout exceeded/i.test(e.message ?? '')) return false;
  if (e.code && ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', '57P01', '57P03', '53300'].includes(e.code)) return true;
  return /Connection terminated|too many clients/i.test(e.message ?? '');
}

/** Run a read, and run it once more if Railway dropped the connection under
 *  it. Reads only: a write that died mid-flight may already have landed. */
export async function readWithRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isConnectionDrop(err)) throw err;
    await new Promise((r) => setTimeout(r, 500));
    return run();
  }
}
