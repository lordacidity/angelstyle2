import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Built lazily inside the handler — constructing it at module scope makes
// Next's build-time page-data collection evaluate it without the Supabase env
// vars present, which throws "supabaseUrl is required" and fails the build.
// Uses the MAIN read-only price-data project, same as every other /api/ai/* and
// markets route (see frontend/src/lib/supabase.ts). The old PAUV_SUPABASE_* names
// don't exist in .env, so createClient(undefined, undefined) threw and the
// "Change person" roster never loaded.
function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET() {
  try {
    const sb = getClient();
    const [{ data: profiles, error: pErr }, { data: markets, error: mErr }] = await Promise.all([
      sb.from('profiles')
        .select('id,ticker,name,bio,photo_url,industry,info_subcategory,info_location,claim_status')
        .is('delisted_at', null)
        .order('name'),
      sb.from('markets')
        .select('profile_id,latest_price_cents,p0,holders_count,total_volume_lifetime_cents,latest_tick_at,frozen'),
    ]);

    if (pErr) throw new Error(pErr.message);
    if (mErr) throw new Error(mErr.message);

    type ProfileRow = { id: string; ticker: string; name: string; bio: string | null; photo_url: string | null; industry: string | null; info_subcategory: string | null; info_location: string | null; claim_status: string | null };
    type MarketRow = { profile_id: string; latest_price_cents: number | null; p0: number | null; holders_count: number | null; total_volume_lifetime_cents: number | null; latest_tick_at: string | null; frozen: boolean | null };

    const byProfile = new Map<string, MarketRow>(
      ((markets ?? []) as MarketRow[]).map((m) => [m.profile_id, m]),
    );

    const talents = ((profiles ?? []) as ProfileRow[]).map((p) => {
      const m = byProfile.get(p.id) ?? null;
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
        price: {
          usd: cents != null ? cents / 100 : null,
          lifetimeChangePct: cents != null && p0 != null && p0 > 0 ? ((cents - p0) / p0) * 100 : null,
          holders: m?.holders_count ?? null,
          volumeLifetimeUsd: m?.total_volume_lifetime_cents != null ? m.total_volume_lifetime_cents / 100 : null,
          latestTickAt: m?.latest_tick_at ?? null,
          frozen: m?.frozen ?? false,
        },
      };
    });

    return NextResponse.json(talents);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
