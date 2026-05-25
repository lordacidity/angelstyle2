// Card templates live in Railway Postgres (PauvDistribution's own data DB).
// A template is just a `doc` JSON blob describing layers; we don't try to
// model layer shapes in SQL because they evolve with the editor.

import { getPool } from "./db.js";

export interface TemplateDoc {
  width: number;
  height: number;
  background: string;
  layers: unknown[];
}

export interface TemplateRow {
  id: string;
  name: string;
  doc: TemplateDoc;
  createdAt: string;
  updatedAt: string;
}

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        doc JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  })().catch((e) => {
    // Reset so the next call retries — otherwise a transient Railway hiccup
    // permanently breaks template endpoints until the server restarts.
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

interface DbRow {
  id: string;
  name: string;
  doc: TemplateDoc;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: DbRow): TemplateRow {
  return {
    id: r.id,
    name: r.name,
    doc: r.doc,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listTemplates(): Promise<TemplateRow[]> {
  await ensureSchema();
  const r = await getPool().query<DbRow>(
    "SELECT id, name, doc, created_at, updated_at FROM templates ORDER BY updated_at DESC",
  );
  return r.rows.map(toRow);
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  await ensureSchema();
  const r = await getPool().query<DbRow>(
    "SELECT id, name, doc, created_at, updated_at FROM templates WHERE id = $1",
    [id],
  );
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

export async function createTemplate(name: string, doc: TemplateDoc): Promise<TemplateRow> {
  await ensureSchema();
  const r = await getPool().query<DbRow>(
    "INSERT INTO templates (name, doc) VALUES ($1, $2) RETURNING id, name, doc, created_at, updated_at",
    [name, doc],
  );
  return toRow(r.rows[0]);
}

export async function updateTemplate(
  id: string,
  patch: { name?: string; doc?: TemplateDoc },
): Promise<TemplateRow | null> {
  await ensureSchema();
  // Build the SET clause dynamically so a partial patch only touches the
  // columns the caller asked to change. updated_at always bumps.
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    vals.push(patch.name);
    sets.push(`name = $${vals.length}`);
  }
  if (patch.doc !== undefined) {
    vals.push(patch.doc);
    sets.push(`doc = $${vals.length}`);
  }
  vals.push(id);
  const r = await getPool().query<DbRow>(
    `UPDATE templates SET ${sets.join(", ")} WHERE id = $${vals.length}
     RETURNING id, name, doc, created_at, updated_at`,
    vals,
  );
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query("DELETE FROM templates WHERE id = $1", [id]);
  return (r.rowCount ?? 0) > 0;
}
