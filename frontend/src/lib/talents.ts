// Pauv's roster with prices — everyone listed, as /api/ai/talents hands it
// out, read once and kept for everybody (lib/kept).
//
// The read is three paged queries and an RPC against the MAIN price-data
// Supabase project: a second or two, and the same for every page that opens
// on the roster — the Vids 2 search box among them, which every clipper opens
// first. Nothing about it is personal, so one read serves everyone: kept for
// ten minutes, handed over stale for up to a day with a refresh behind the
// reply, then read afresh (the rule is lib/kept's).
//
// Server only. Built lazily inside the read — constructing the client at
// module scope makes Next's build-time page-data collection evaluate it
// without the Supabase env vars present, which throws and fails the build.

import { createClient } from '@supabase/supabase-js';
import { kept } from '@/lib/kept';

const MIN = 60_000;
const POLICY = { freshMs: 10 * MIN, staleMaxMs: 24 * 60 * MIN };
const KEY = 'pauv|talents';

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// PostgREST caps every response at 1,000 rows. Pauv lists more people than
// that, so a single name-ordered query silently dropped everyone after about
// "Tom H" (Zendaya among them). Page through until a short page comes back.
const PAGE = 1000;

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

type ProfileRow = { id: string; ticker: string; name: string; bio: string | null; photo_url: string | null; industry: string | null; info_subcategory: string | null; info_location: string | null; claim_status: string | null; created_at: string | null };
type OverviewRow = { profile_id: string; change_1h: number | null; change_1d: number | null; change_1w: number | null; change_1m: number | null; change_lifetime?: number | null };
type MarketRow = { profile_id: string; latest_price_cents: number | null; p0: number | null; holders_count: number | null; total_volume_lifetime_cents: number | null; latest_tick_at: string | null; frozen: boolean | null };

/** One person as the route sends them — see readTalents. */
export interface Talent {
  id: string;
  ticker: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  location: string | null;
  claimStatus: string | null;
  /** When the profile went live — the "newly listed" ordering and dateline. */
  listedAt: string | null;
  price: {
    usd: number | null;
    /** The listing price. Unlike latest_price_cents, p0 is stored in dollars. */
    startUsd: number | null;
    lifetimeChangePct: number | null;
    holders: number | null;
    volumeLifetimeUsd: number | null;
    latestTickAt: string | null;
    frozen: boolean;
    /** The changes as pauv.com shows them (market_overview(), in percent);
     *  null when the RPC gave nothing for this market. */
    change1hPct: number | null;
    change1dPct: number | null;
    change1wPct: number | null;
    change1mPct: number | null;
    changeLifetimePct: number | null;
  };
}

/** The roster, read off Supabase now. */
async function readTalents(): Promise<Talent[]> {
  const sb = getClient();
  // Each query needs a unique ordering, or rows can shift between pages.
  const [profiles, markets, overview] = await Promise.all([
    fetchAll<ProfileRow>((from, to) => sb.from('profiles')
      .select('id,ticker,name,bio,photo_url,industry,info_subcategory,info_location,claim_status,created_at')
      .is('delisted_at', null)
      .order('name')
      .order('id')
      .range(from, to)),
    fetchAll<MarketRow>((from, to) => sb.from('markets')
      .select('profile_id,latest_price_cents,p0,holders_count,total_volume_lifetime_cents,latest_tick_at,frozen')
      .order('profile_id')
      .range(from, to)),
    // The site's own change figures — the `market_overview()` RPC the
    // homepage cards and /trade read — keyed by profile. The roster stands
    // without them if the RPC is missing or slow.
    fetchAll<OverviewRow>((from, to) => sb.rpc('market_overview').order('profile_id').range(from, to)).catch(() => [] as OverviewRow[]),
  ]);

  const byProfile = new Map<string, MarketRow>(markets.map((m) => [m.profile_id, m]));
  const overviewByProfile = new Map<string, OverviewRow>(overview.map((o) => [o.profile_id, o]));

  return profiles.map((p): Talent => {
    const m = byProfile.get(p.id) ?? null;
    const o = overviewByProfile.get(p.id) ?? null;
    const cents = m?.latest_price_cents ?? null;
    const p0 = m?.p0 ?? null;
    return {
      id: p.id,
      ticker: p.ticker,
      name: p.name,
      bio: p.bio,
      photo_url: p.photo_url,
      industry: p.industry,
      subcategory: p.info_subcategory,
      location: p.info_location,
      claimStatus: p.claim_status,
      listedAt: p.created_at,
      price: {
        usd: cents != null ? cents / 100 : null,
        startUsd: p0,
        lifetimeChangePct: cents != null && p0 != null && p0 > 0 ? ((cents - p0) / p0) * 100 : null,
        holders: m?.holders_count ?? null,
        volumeLifetimeUsd: m?.total_volume_lifetime_cents != null ? m.total_volume_lifetime_cents / 100 : null,
        latestTickAt: m?.latest_tick_at ?? null,
        frozen: m?.frozen ?? false,
        change1hPct: o?.change_1h ?? null,
        change1dPct: o?.change_1d ?? null,
        change1wPct: o?.change_1w ?? null,
        change1mPct: o?.change_1m ?? null,
        changeLifetimePct: o?.change_lifetime ?? null,
      },
    };
  });
}

/** The roster, kept: see the header. `refresh` is owed when it was handed
 *  over stale — the route runs it behind the reply. */
export function getTalents(fresh = false) {
  return kept<Talent[]>(KEY, readTalents, POLICY, fresh);
}

/** What the Vids 2 search box needs of a person and nothing else — the full
 *  roster is two megabytes of bios, which is a lot to hand a phone for a list
 *  of names. Kept in step with RosterRow in lib/vids2/vids2Build. */
export const slimTalent = (t: Talent) => ({
  id: t.id,
  name: t.name,
  ticker: t.ticker,
  price: { change1dPct: t.price.change1dPct, change1wPct: t.price.change1wPct, holders: t.price.holders },
});
