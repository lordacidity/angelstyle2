// Pricer storage — the peer standing lines and the pricing log, in Railway Postgres (DATABASE_PUBLIC_URL, the
// same DB as the Board and Vids). The standalone kept both in CSVs beside server.mjs; here the tables self-create
// and pipeline.js loads those CSVs into them once (ensureStore there), so the standalone's lines and test history
// carry over, and later pricings are shared between machines and survive Vercel's read-only disk.
//
// This module knows nothing about pricing: it stores and returns rows. Physical tables are prefixed `pricer_` so
// they cannot collide with anything else in that DB. Server-only (imported by pipeline.js and the /api/pricer/*
// route handlers) — never import it from a client component, it would leak the connection string.

import pg from 'pg';

// The pricing log's columns, in CSV order: one row per completed pricing — the bio, each analyst's price,
// confidence, evidence and rationale, and the judge's verdict. pricedRow() in pipeline.js fills them and the
// /api/pricer/log download writes them out in this order. All text, exactly as they were in the CSV.
export const PRICED_COLUMNS = [
  'priced_at', 'name', 'hint', 'canonical_name', 'industry', 'subindustry', 'one_line', 'bio',
  'social_price', 'social_confidence', 'social_searched', 'social_accounts',
  'news_price', 'news_confidence', 'news_searched', 'news_stories',
  'industry_price', 'industry_confidence', 'industry_peers',
  'judge_price', 'online_celebrity', 'final_price', 'final_tier', 'final_confidence', 'weights', 'anchors', 'one_band_rule',
  'models', 'social_rationale', 'news_rationale', 'industry_rationale', 'judge_rationale',
] as const;
export type PricedColumn = (typeof PRICED_COLUMNS)[number];
// A log row as read back: every column a string.
export type PricedRow = Record<PricedColumn, string>;
// A log row to write: the columns (any value; stored as text the way the CSV did) plus the two match keys the
// pipeline computes with its own norm(), so "priced before" finds earlier runs of the same name.
export type PricedInsert = Partial<Record<PricedColumn, unknown>> & { name_norm: string; canonical_norm: string };

export interface PeerLine {
  key: string;          // pipeline.js's peerKey(): slug(name)__slug(industry)
  name: string;
  industry: string;
  subindustry: string;
  identified: boolean;
  line: string;
  model: string;
  written_at: string;
}

export interface PricedBefore { priced_at: string; canonical_name: string; final_price: number; times: number }

// ── Pool + schema (hot-reload safe, like vids-db) ────────────────────────────
// Bump whenever ensureSchema() gains a table or column: a process that resolved the cached promise against an
// older schema then re-runs the (idempotent) DDL instead of trusting it.
const SCHEMA_VERSION = 1;

const g = globalThis as unknown as {
  __pricerPool?: pg.Pool;
  __pricerSchema?: Promise<void>;
  __pricerSchemaVersion?: number;
};

function getPool(): pg.Pool {
  if (g.__pricerPool) return g.__pricerPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) {
    throw new Error('DATABASE_PUBLIC_URL not set — the pricer keeps its peer lines and log in Railway Postgres (root .env)');
  }
  g.__pricerPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return g.__pricerPool;
}

export function ensureSchema(): Promise<void> {
  if (g.__pricerSchema && g.__pricerSchemaVersion === SCHEMA_VERSION) return g.__pricerSchema;
  g.__pricerSchemaVersion = SCHEMA_VERSION;
  g.__pricerSchema = (async () => {
    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS pricer_peer_lines (
      key text PRIMARY KEY,
      name text NOT NULL,
      industry text NOT NULL DEFAULT '',
      subindustry text NOT NULL DEFAULT '',
      identified boolean NOT NULL DEFAULT false,
      line text NOT NULL DEFAULT '',
      model text NOT NULL DEFAULT '',
      written_at text NOT NULL DEFAULT ''
    )`);
    // Column names come from the hard-coded PRICED_COLUMNS list above, never from input.
    await pool.query(`CREATE TABLE IF NOT EXISTS pricer_priced (
      id bigserial PRIMARY KEY,
      name_norm text NOT NULL DEFAULT '',
      canonical_norm text NOT NULL DEFAULT '',
      ${PRICED_COLUMNS.map(c => `${c} text NOT NULL DEFAULT ''`).join(',\n      ')}
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS pricer_priced_name_norm ON pricer_priced (name_norm)');
    await pool.query('CREATE INDEX IF NOT EXISTS pricer_priced_canonical_norm ON pricer_priced (canonical_norm)');
  })().catch(e => { g.__pricerSchema = undefined; throw e; });
  return g.__pricerSchema;
}

const asText = (v: unknown): string => String(v ?? '');
const count = async (table: 'pricer_peer_lines' | 'pricer_priced'): Promise<number> => {
  const { rows } = await getPool().query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
};

// ── Peer standing lines ─────────────────────────────────────────────────────
export const countPeerLines = () => count('pricer_peer_lines');

export async function listPeerLines(): Promise<PeerLine[]> {
  const { rows } = await getPool().query<PeerLine>(
    'SELECT key, name, industry, subindustry, identified, line, model, written_at FROM pricer_peer_lines',
  );
  return rows;
}

const PEER_FIELDS = ['key', 'name', 'industry', 'subindustry', 'identified', 'line', 'model', 'written_at'] as const;

// Insert or replace, by key. Chunked so a full seed (a thousand rows) is a handful of statements.
export async function upsertPeerLines(rows: PeerLine[]): Promise<void> {
  // One statement cannot touch the same key twice, so a later row for the same person wins here first — the same
  // "last one counts" the appended CSV had.
  const byKey = new Map<string, PeerLine>();
  for (const r of rows) byKey.set(r.key, r);
  const list = [...byKey.values()];
  const pool = getPool();
  const width = PEER_FIELDS.length;
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const values: unknown[] = [];
    const tuples = chunk.map((r, j) => {
      values.push(r.key, r.name, r.industry, r.subindustry, Boolean(r.identified), r.line, r.model, r.written_at);
      return `(${PEER_FIELDS.map((_, k) => `$${j * width + k + 1}`).join(',')})`;
    });
    await pool.query(
      `INSERT INTO pricer_peer_lines (${PEER_FIELDS.join(',')}) VALUES ${tuples.join(',')}
       ON CONFLICT (key) DO UPDATE SET ${PEER_FIELDS.filter(f => f !== 'key').map(f => `${f} = EXCLUDED.${f}`).join(', ')}`,
      values,
    );
  }
}

// ── The pricing log ─────────────────────────────────────────────────────────
export const countPriced = () => count('pricer_priced');

// Append rows, in order. Values are stored as text the way the CSV held them (numbers and booleans included).
export async function insertPriced(rows: PricedInsert[]): Promise<void> {
  const cols = ['name_norm', 'canonical_norm', ...PRICED_COLUMNS] as const;
  const pool = getPool();
  const width = cols.length;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const values: unknown[] = [];
    const tuples = chunk.map((r, j) => {
      for (const c of cols) values.push(asText((r as Record<string, unknown>)[c]));
      return `(${cols.map((_, k) => `$${j * width + k + 1}`).join(',')})`;
    });
    await pool.query(`INSERT INTO pricer_priced (${cols.join(',')}) VALUES ${tuples.join(',')}`, values);
  }
}

// The most recent earlier pricing whose typed or canonical name normalises to `nameNorm`, plus how many there were.
export async function pricedBefore(nameNorm: string): Promise<PricedBefore | null> {
  const { rows } = await getPool().query<{ priced_at: string; canonical_name: string; final_price: string; times: string }>(
    `SELECT priced_at, canonical_name, final_price, count(*) OVER () AS times
       FROM pricer_priced WHERE name_norm = $1 OR canonical_norm = $1
       ORDER BY id DESC LIMIT 1`,
    [nameNorm],
  );
  const last = rows[0];
  if (!last) return null;
  return { priced_at: last.priced_at, canonical_name: last.canonical_name, final_price: Number(last.final_price), times: Number(last.times) };
}

// Every row, oldest first — the CSV download.
export async function listPriced(): Promise<PricedRow[]> {
  const { rows } = await getPool().query<PricedRow>(`SELECT ${PRICED_COLUMNS.join(',')} FROM pricer_priced ORDER BY id`);
  return rows;
}
