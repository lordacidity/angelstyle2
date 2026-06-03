// Curator Twitter handles stored in Railway Postgres news_sources table.
// Soft-fails — callers should catch and proceed without curator tweets.

import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_PUBLIC_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

export async function getHandlesByIndustry(industry: string): Promise<string[]> {
  const { rows } = await getPool().query<{ handle: string }>(
    'select handle from news_sources where lower(industry) = lower($1) order by handle',
    [industry],
  );
  return rows.map(r => r.handle);
}
