// Curator Twitter handles stored in Railway Postgres news_sources table.
// Soft-fails — callers should catch and proceed without curator tweets.

import type { Pool } from 'pg';
import { railwayPool } from '@/lib/railway-pool';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = railwayPool(process.env.DATABASE_PUBLIC_URL ?? '', { max: 2, name: 'news-sources' });
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
