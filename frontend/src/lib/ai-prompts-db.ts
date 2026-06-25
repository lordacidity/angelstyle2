// "AI Prompts" — 15 fixed topic slots that live in Railway Postgres
// (PauvDistribution's own data DB, DATABASE_PUBLIC_URL), completely separate from
// the read-only Pauv price-data Supabase. Each slot holds a short topic the user
// types (e.g. "basketball") plus the latest generated 3-sentence trending-news
// overview for it.
//
// The physical table is `ai_prompts`; it's self-creating and self-seeding (15
// rows, positions 1..15) on first request, the same way board-db / templates do.
//
// Server-only — imported by Next.js route handlers. Never import from a client
// component or it would leak the DB connection string.

import pg from 'pg';

// Fixed number of topic slots shown in the AI Prompts section.
export const PROMPT_COUNT = 15;

// Each topic is tagged as either an athlete or an artist.
export const PROMPT_CATEGORIES = ['athlete', 'artist', 'gamer'] as const;
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export function isPromptCategory(v: unknown): v is PromptCategory {
  return typeof v === 'string' && (PROMPT_CATEGORIES as readonly string[]).includes(v);
}

export interface AiPromptRow {
  id: string;
  position: number;
  topic: string;
  category: PromptCategory;
  overview: string;
  overviewUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Connection pool (singleton, hot-reload safe) ──────────────────────────────
// Cached on globalThis so Next.js dev re-evaluating the module on edit doesn't
// leak a fresh pool each reload (same pattern as board-db.ts).
const g = globalThis as unknown as { __aiPromptsPool?: pg.Pool };

function getPool(): pg.Pool {
  if (g.__aiPromptsPool) return g.__aiPromptsPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) {
    throw new Error('DATABASE_PUBLIC_URL not set — paste Railway\'s Connect-panel value into frontend/.env');
  }
  g.__aiPromptsPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return g.__aiPromptsPool;
}

// ── Schema (self-creating + self-seeding) ─────────────────────────────────────
let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_prompts (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        position            INTEGER     NOT NULL UNIQUE,
        topic               TEXT        NOT NULL DEFAULT '',
        category            TEXT        NOT NULL DEFAULT 'athlete',
        overview            TEXT        NOT NULL DEFAULT '',
        overview_updated_at TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Backfill the column on tables created before `category` existed.
    await pool.query(
      `ALTER TABLE ai_prompts ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'athlete'`,
    );
    // Seed the 15 fixed slots once. ON CONFLICT keeps this idempotent, so a
    // restart never duplicates rows or clobbers topics the user has typed.
    await pool.query(
      `INSERT INTO ai_prompts (position)
       SELECT generate_series(1, $1)
       ON CONFLICT (position) DO NOTHING`,
      [PROMPT_COUNT],
    );
  })().catch((e) => {
    // Reset so a transient Railway hiccup doesn't permanently wedge the section.
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

interface DbRow {
  id: string;
  position: number;
  topic: string;
  category: string;
  overview: string;
  overview_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: DbRow): AiPromptRow {
  return {
    id: r.id,
    position: r.position,
    topic: r.topic,
    // Anything unexpected in the column falls back to 'athlete' so the UI toggle
    // always has a valid value to highlight.
    category: isPromptCategory(r.category) ? r.category : 'athlete',
    overview: r.overview,
    overviewUpdatedAt: r.overview_updated_at ? r.overview_updated_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const SELECT_COLS =
  'id, position, topic, category, overview, overview_updated_at, created_at, updated_at';

// ── Reads / writes ────────────────────────────────────────────────────────────
export async function listPrompts(): Promise<AiPromptRow[]> {
  await ensureSchema();
  const r = await getPool().query<DbRow>(
    `SELECT ${SELECT_COLS} FROM ai_prompts ORDER BY position ASC`,
  );
  return r.rows.map(toRow);
}

export async function getPrompt(id: string): Promise<AiPromptRow | null> {
  await ensureSchema();
  const r = await getPool().query<DbRow>(
    `SELECT ${SELECT_COLS} FROM ai_prompts WHERE id = $1`,
    [id],
  );
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

// Update the editable fields of a slot — the typed topic and/or its category.
// Builds the SET clause from whichever fields are supplied; with neither it just
// returns the row unchanged.
export async function updatePrompt(
  id: string,
  patch: { topic?: string; category?: PromptCategory },
): Promise<AiPromptRow | null> {
  await ensureSchema();

  const sets = ['updated_at = now()'];
  const vals: unknown[] = [];
  if (patch.topic !== undefined) {
    vals.push(String(patch.topic));
    sets.push(`topic = $${vals.length}`);
  }
  if (patch.category !== undefined) {
    vals.push(patch.category);
    sets.push(`category = $${vals.length}`);
  }
  if (vals.length === 0) return getPrompt(id);

  vals.push(id);
  const r = await getPool().query<DbRow>(
    `UPDATE ai_prompts SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING ${SELECT_COLS}`,
    vals,
  );
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

// Save a freshly generated overview (and stamp when it was generated).
export async function saveOverview(id: string, overview: string): Promise<AiPromptRow | null> {
  await ensureSchema();
  const r = await getPool().query<DbRow>(
    `UPDATE ai_prompts
        SET overview = $1, overview_updated_at = now(), updated_at = now()
      WHERE id = $2
      RETURNING ${SELECT_COLS}`,
    [overview, id],
  );
  return r.rows[0] ? toRow(r.rows[0]) : null;
}
