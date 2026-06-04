// One-off migration runner. Reads the repo-root .env, connects to Railway via DATABASE_PUBLIC_URL,
// and runs the SQL file passed as arg 1 (or 001_news_sources.sql by default).
//
// Run with: npx tsx scripts/runMigration.ts [path/to/file.sql]

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// server/scripts -> server -> repo root (.env). Run via `tsx scripts/runMigration.ts`.
const ENV_PATH = path.resolve(HERE, "..", "..", ".env");
dotenv.config({ path: ENV_PATH });

const sqlArg = process.argv[2] ?? path.resolve(HERE, "..", "migrations", "001_news_sources.sql");
const sqlPath = path.resolve(sqlArg);
const sql = fs.readFileSync(sqlPath, "utf8");

const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? "";
if (!url || url.includes("${")) {
  console.error("DATABASE_PUBLIC_URL not resolved. Got:", url || "(empty)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`[migrate] connected to ${url.replace(/:[^@]+@/, ":***@")}`);
console.log(`[migrate] running ${path.basename(sqlPath)}…`);
await client.query(sql);
const { rows } = await client.query<{ industry: string; count: string }>(
  "select industry, count(*)::text as count from news_sources group by industry order by industry",
);
console.log("[migrate] done. Seed summary:");
for (const r of rows) console.log(`  ${r.industry.padEnd(14)} ${r.count}`);
await client.end();
