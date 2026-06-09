// Per-emoji user preferences — the custom "@" alias you type to reach a glyph
// and whether it's pinned to the front of the picker. Lives in Railway Postgres
// (PauvDistribution's own data DB, DATABASE_PUBLIC_URL), the same store the AI
// Prompts / Board tables use — NOT the read-only Pauv price Supabase.
//
// The physical table is `emoji_prefs`; it's self-creating and self-seeding on
// first request (the three historic pins + their aliases), the same way
// ai-prompts-db / board-db do. Rows are sparse: only emoji the user has actually
// pinned or aliased get a row — everything else falls back to its built-in
// name/keyword search.
//
// Server-only — imported by Next.js route handlers. Never import from a client
// component or it would leak the DB connection string.

import pg from 'pg';

export interface EmojiPref {
  /** Lowercase hex codepoint(s) — matches an EMOJIS entry + its PNG filename. */
  unified: string;
  /** Custom word typed after "@" to insert this emoji (lowercase, no spaces). */
  alias: string;
  /** Pinned emoji sort to the front of the "@" picker. */
  pinned: boolean;
  /** Ordering among pinned emoji (ascending). */
  pinOrder: number;
  updatedAt: string;
}

// Historic defaults from the old hand-tuned curated set, seeded once so behaviour
// is preserved on a fresh DB: 😂 🔥 🤣 pinned, 🤣 reachable via "@cry", and the
// speaking head via "@yap". ON CONFLICT keeps this idempotent.
const SEED: { unified: string; alias: string; pinned: boolean; pinOrder: number }[] = [
  { unified: '1f602', alias: '', pinned: true, pinOrder: 1 },
  { unified: '1f525', alias: '', pinned: true, pinOrder: 2 },
  { unified: '1f923', alias: 'cry', pinned: true, pinOrder: 3 },
  { unified: '1f5e3-fe0f', alias: 'yap', pinned: false, pinOrder: 0 },
];

// ── Connection pool (singleton, hot-reload safe) ──────────────────────────────
const g = globalThis as unknown as { __emojiPrefsPool?: pg.Pool };

function getPool(): pg.Pool {
  if (g.__emojiPrefsPool) return g.__emojiPrefsPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) {
    throw new Error('DATABASE_PUBLIC_URL not set — paste Railway\'s Connect-panel value into frontend/.env');
  }
  g.__emojiPrefsPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return g.__emojiPrefsPool;
}

// ── Schema (self-creating + self-seeding) ─────────────────────────────────────
let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS emoji_prefs (
        unified    TEXT        PRIMARY KEY,
        alias      TEXT        NOT NULL DEFAULT '',
        pinned     BOOLEAN     NOT NULL DEFAULT false,
        pin_order  INTEGER     NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    for (const s of SEED) {
      await pool.query(
        `INSERT INTO emoji_prefs (unified, alias, pinned, pin_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (unified) DO NOTHING`,
        [s.unified, s.alias, s.pinned, s.pinOrder],
      );
    }
  })().catch((e) => {
    // Reset so a transient Railway hiccup doesn't permanently wedge the feature.
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

interface DbRow {
  unified: string;
  alias: string;
  pinned: boolean;
  pin_order: number;
  updated_at: Date;
}

function toPref(r: DbRow): EmojiPref {
  return {
    unified: r.unified,
    alias: r.alias,
    pinned: r.pinned,
    pinOrder: r.pin_order,
    updatedAt: r.updated_at.toISOString(),
  };
}

const SELECT_COLS = 'unified, alias, pinned, pin_order, updated_at';

// A unified key is one or more lowercase hex codepoints joined by dashes
// (e.g. "1f602", "1f1e7-1f1f7", "1f5e3-fe0f"). Reject anything else so the table
// can't accumulate garbage rows from a malformed request.
export function isUnified(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]+(-[0-9a-f]+)*$/.test(v);
}

// Normalise a typed alias to a single lowercase token with no "@" or whitespace,
// so "@Cry " and "cry" both store as "cry" and match the picker's lookup.
export function normalizeAlias(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/[@\s]+/g, '').slice(0, 32);
}

// ── Reads / writes ────────────────────────────────────────────────────────────
export async function listEmojiPrefs(): Promise<EmojiPref[]> {
  await ensureSchema();
  const r = await getPool().query<DbRow>(
    `SELECT ${SELECT_COLS} FROM emoji_prefs ORDER BY pin_order ASC, updated_at DESC`,
  );
  return r.rows.map(toPref);
}

// Upsert the alias and/or pinned state for one emoji. Pinning assigns the next
// pin_order (so freshly pinned emoji land at the end of the pinned strip);
// unpinning resets it to 0. Returns the resulting row.
export async function upsertEmojiPref(
  unified: string,
  patch: { alias?: string; pinned?: boolean },
): Promise<EmojiPref> {
  await ensureSchema();
  const pool = getPool();

  // Resolve the new pin_order when the pinned flag is changing.
  let pinOrder: number | undefined;
  if (patch.pinned === true) {
    const m = await pool.query<{ max: number | null }>(
      `SELECT MAX(pin_order) AS max FROM emoji_prefs WHERE pinned = true`,
    );
    pinOrder = (m.rows[0]?.max ?? 0) + 1;
  } else if (patch.pinned === false) {
    pinOrder = 0;
  }

  // Build the SET / INSERT columns from whatever was supplied. The row is created
  // if it doesn't exist yet, so the first pin or alias on an emoji just works.
  const cols: string[] = ['unified'];
  const vals: unknown[] = [unified];
  const ins: string[] = ['$1'];
  const ups: string[] = ['updated_at = now()'];

  const add = (col: string, val: unknown) => {
    vals.push(val);
    cols.push(col);
    ins.push(`$${vals.length}`);
    ups.push(`${col} = $${vals.length}`);
  };

  if (patch.alias !== undefined) add('alias', patch.alias);
  if (patch.pinned !== undefined) add('pinned', patch.pinned);
  if (pinOrder !== undefined) add('pin_order', pinOrder);

  const r = await pool.query<DbRow>(
    `INSERT INTO emoji_prefs (${cols.join(', ')})
     VALUES (${ins.join(', ')})
     ON CONFLICT (unified) DO UPDATE SET ${ups.join(', ')}
     RETURNING ${SELECT_COLS}`,
    vals,
  );
  return toPref(r.rows[0]);
}
