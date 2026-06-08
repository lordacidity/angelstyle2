import fs from 'node:fs';
import pg from 'pg';
import { SETTINGS_FILE } from './paths.js';

// Durable home for the Aier admin settings blob (the same JSON that used to live in
// settings.json). On Vercel the filesystem is ephemeral + per-invocation isolated, so a
// file write from the admin PUT is invisible to the next lambda and wiped on cold start —
// which is why the pro/standard toggle "didn't stick". We persist it as a single JSONB row
// in the app's Railway Postgres (same DB as board-db.ts). When no DATABASE_URL is configured
// (pure local dev), we transparently fall back to the legacy file so nothing changes locally.

const SETTINGS_ID = 'aier-global'; // single-row key — there is one global settings blob

// Pool + schema cached on globalThis: Next dev re-evaluates modules on edit, and Vercel
// reuses warm lambdas — without this we'd leak a new pool per reload until Railway refused us.
const g = globalThis;

function connectionString() {
  return process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
}

function getPool() {
  if (g.__aierSettingsPool) return g.__aierSettingsPool;
  const cs = connectionString();
  if (!cs) return null; // no DB configured → caller uses the file fallback
  g.__aierSettingsPool = new pg.Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  return g.__aierSettingsPool;
}

function ensureSchema(pool) {
  if (g.__aierSettingsSchema) return g.__aierSettingsSchema;
  g.__aierSettingsSchema = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aier_settings (
        id         TEXT        PRIMARY KEY,
        data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // One-time migration: if the row doesn't exist yet, seed it from the legacy settings.json
    // (present in local dev / on a mounted volume) so existing tuned settings carry over.
    const existing = await pool.query('SELECT 1 FROM aier_settings WHERE id = $1', [SETTINGS_ID]);
    if (existing.rowCount === 0) {
      let seed = {};
      try { seed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { /* no file — empty seed */ }
      await pool.query(
        'INSERT INTO aier_settings (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [SETTINGS_ID, JSON.stringify(seed)],
      );
    }
  })().catch((e) => {
    // Reset so a transient Railway hiccup doesn't permanently wedge settings reads.
    g.__aierSettingsSchema = null;
    throw e;
  });
  return g.__aierSettingsSchema;
}

/** Read the saved settings blob (the partial that overrides DEFAULT_SETTINGS). */
export async function loadStoredSettings() {
  const pool = getPool();
  if (!pool) {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
  }
  await ensureSchema(pool);
  const { rows } = await pool.query('SELECT data FROM aier_settings WHERE id = $1', [SETTINGS_ID]);
  return rows[0]?.data ?? {};
}

/** Persist the full settings blob durably. Returns what was written. */
export async function saveStoredSettings(full) {
  const pool = getPool();
  if (!pool) {
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(full, null, 2)); } catch { /* read-only FS */ }
    return full;
  }
  await ensureSchema(pool);
  await pool.query(
    `INSERT INTO aier_settings (id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [SETTINGS_ID, JSON.stringify(full)],
  );
  return full;
}
