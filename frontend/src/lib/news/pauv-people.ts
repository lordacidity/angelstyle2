// Pauv's roster, for the people half of a News page's side-column thumbnails:
// every listed person's name, profile photo (512px square, pauv.com's own) and
// industry. Server only; read from the MAIN price-data Supabase project like
// /api/ai/talents, paged past PostgREST's 1,000-row cap, and kept for an hour.

import { createClient } from '@supabase/supabase-js';

export interface PauvPerson {
  name: string;
  ticker: string;
  photoUrl: string;
  /** "Sports", "Music", "Film and TV", "Politics", "Business", "Influencers", "Comedy", "Media". */
  industry: string;
  /** "Basketball", "American Football", "Rap", "Politicians"… or null. */
  subcategory: string | null;
}

const PAGE = 1000;
const KEEP_MS = 60 * 60_000;
let roster: { at: number; value: Promise<PauvPerson[]> } | null = null;

async function load(): Promise<PauvPerson[]> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  type Row = { name: string | null; ticker: string | null; photo_url: string | null; industry: string | null; info_subcategory: string | null };
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('profiles')
      .select('name,ticker,photo_url,industry,info_subcategory')
      .is('delisted_at', null)
      .not('photo_url', 'is', null)
      .order('name')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows.flatMap(r => (r.name && r.ticker && r.photo_url && r.industry
    ? [{ name: r.name.trim(), ticker: r.ticker, photoUrl: r.photo_url, industry: r.industry, subcategory: r.info_subcategory }]
    : []));
}

export function pauvPeople(): Promise<PauvPerson[]> {
  if (roster && Date.now() - roster.at < KEEP_MS) return roster.value;
  const value = load();
  roster = { at: Date.now(), value };
  value.catch(() => { roster = null; });
  return value;
}
