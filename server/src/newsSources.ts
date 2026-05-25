import { getPool } from "./db.js";

// `industry` matches Pauv's `industries.singular` (PascalCase, e.g. "Musician").
// Compared case-insensitively so the caller can pass through without normalizing.
export async function getHandlesByIndustry(industry: string): Promise<string[]> {
  const { rows } = await getPool().query<{ handle: string }>(
    "select handle from news_sources where lower(industry) = lower($1) order by handle",
    [industry],
  );
  return rows.map((r) => r.handle);
}

export async function listIndustriesWithCounts(): Promise<
  Array<{ industry: string; count: number }>
> {
  const { rows } = await getPool().query<{ industry: string; count: string }>(
    "select industry, count(*)::text as count from news_sources group by industry order by industry",
  );
  return rows.map((r) => ({ industry: r.industry, count: Number(r.count) }));
}
