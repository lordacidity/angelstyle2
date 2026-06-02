// Auto-pick the CTA talent for a post. Instead of the user manually searching
// the Market selector, DeepSeek reads the on-card caption + the generated
// long-form caption, figures out who the post is actually about, and chooses
// the Pauv talent to feature in the buy-CTA:
//   - If the post's main person IS a Pauv talent → use them   (matchType 'listed').
//   - Otherwise → the biggest same-industry talent on Pauv     (matchType 'industry').
// It also rewrites the caption's closing CTA paragraph so the words name the
// exact talent the Market widget shows — text + widget stay in sync.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { deepseekChat, parseJson } from '@/lib/deepseek';

export const runtime = 'nodejs';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

interface ProfileRow {
  id: string; ticker: string; name: string; bio: string | null;
  photo_url: string | null; industry: string | null;
  info_subcategory: string | null; info_location: string | null; claim_status: string | null;
}
interface MarketRow {
  profile_id: string; latest_price_cents: number | null; p0: number | null;
  holders_count: number | null; total_volume_lifetime_cents: number | null;
  latest_tick_at: string | null; frozen: boolean | null;
}

// Same shape the /api/ai/talents endpoint returns, so the client can drop the
// chosen talent straight into the Market widget with no remapping.
function buildTalents(profiles: ProfileRow[], markets: MarketRow[]) {
  const byProfile = new Map(markets.map(m => [m.profile_id, m]));
  return profiles.map(p => {
    const m = byProfile.get(p.id) ?? null;
    const cents = m?.latest_price_cents ?? null;
    const p0 = m?.p0 ?? null;
    return {
      id: p.id, ticker: p.ticker, name: p.name, bio: p.bio, photo_url: p.photo_url,
      industry: p.industry, subcategory: p.info_subcategory, location: p.info_location,
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
}

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      caption:          z.string().optional(),  // on-card caption
      generatedCaption: z.string().optional(),  // the long-form caption we just wrote
      videoTitle:       z.string().optional(),
      author:           z.string().optional(),
      context:          z.string().optional(),
      // The posting brand account (e.g. "Pauv" / "@Pauv"). Gives the
      // model context for who is publishing the CTA and the audience vertical.
      brand:            z.object({ displayName: z.string().optional(), handle: z.string().optional() }).optional(),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { caption, generatedCaption, videoTitle, author, context, brand } = parsed.data;

    if (!caption?.trim() && !generatedCaption?.trim() && !videoTitle?.trim()) {
      return NextResponse.json({ error: 'need caption, generatedCaption, or videoTitle' }, { status: 400 });
    }

    // ── Load the Pauv roster ───────────────────────────────────────────────────
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

    const talents = buildTalents((profiles ?? []) as ProfileRow[], (markets ?? []) as MarketRow[]);
    if (talents.length === 0) return NextResponse.json({ error: 'no talents available' }, { status: 502 });

    // Compact roster for the prompt — the model picks by ticker. We lean on the
    // model's own knowledge of public prominence for "who's big" because the
    // platform's holders/volume are still near-zero early on. The roster is
    // GROUPED BY INDUSTRY so the model can see the candidate pool for each field
    // at a glance and is far less likely to cross industries (e.g. pick a
    // musician for a basketball post).
    const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();
    const byIndustry = new Map<string, { ticker: string; name: string; subcategory: string | null }[]>();
    for (const t of talents) {
      const ind = t.industry?.trim() || 'Unknown';
      if (!byIndustry.has(ind)) byIndustry.set(ind, []);
      byIndustry.get(ind)!.push({ ticker: t.ticker, name: t.name, subcategory: t.subcategory ?? null });
    }
    const rosterByIndustry = Object.fromEntries([...byIndustry.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    const industries = [...byIndustry.keys()].sort();

    const brandLine = brand?.displayName || brand?.handle
      ? `This CTA is being posted by the brand account "${brand?.displayName ?? ''}" ${brand?.handle ?? ''}`.trim() + '. '
      : '';

    const sys =
      'You choose which Pauv talent should be featured in the buy-CTA of a social post, ' +
      'and you rewrite the post\'s closing CTA paragraph to name that talent.\n\n' +
      'Pauv is a marketplace for trading on public sentiment — every athlete, artist, creator, ' +
      'and cultural figure has a "ticker" that moves with how people feel about them. The CTA tells ' +
      'viewers to take a position on someone.\n\n' +
      brandLine +
      'You are given: the post\'s on-card caption, the generated long-form caption, the posting brand ' +
      'account, the list of INDUSTRIES on Pauv, and ROSTER_BY_INDUSTRY — the talents listed on Pauv ' +
      'grouped under each industry (ticker, name, subcategory).\n\n' +
      'Steps — follow them in order and do NOT skip the industry step:\n' +
      '1. Identify the single main person/subject the post is about (subjectName).\n' +
      '2. Determine that subject\'s field/industry and map it to the CLOSEST matching entry in the ' +
      'INDUSTRIES list (subjectIndustry). A basketball player → the sports/athlete industry, a rapper → ' +
      'the music industry, a streamer → the creator industry, etc. Pick the single best-fitting industry ' +
      'bucket that actually exists in the list.\n' +
      '3. If the subject themselves is in ROSTER_BY_INDUSTRY (match by name, case-insensitive, allow ' +
      'minor spelling variants), pick THEIR ticker and set matchType="listed".\n' +
      '4. Otherwise, choose the SINGLE most prominent / most famous talent FROM THE subjectIndustry ' +
      'BUCKET ONLY (use your own knowledge of who is biggest). Set matchType="industry". You MUST pick ' +
      'from that industry\'s bucket — never cross into a different industry. ONLY if the subjectIndustry ' +
      'bucket is empty or has no defensible match may you pick from the closest related industry, and you ' +
      'must say so in "reason".\n' +
      '5. Rewrite ONLY the final CTA paragraph so it bridges naturally from the post to taking a ' +
      'position on the chosen talent BY NAME, ending with a concrete step like "link in bio to trade ' +
      'on <Name>". ~50-80 words. Conversational, no hashtags, no emojis, plain text. Do NOT return the ' +
      'first two paragraphs — only the rewritten final paragraph.\n\n' +
      'The ticker you return MUST be one of the exact ticker strings from ROSTER_BY_INDUSTRY.\n' +
      'Return JSON: { "subjectName": string, "subjectIndustry": string, "ticker": string, ' +
      '"matchType": "listed" | "industry", "reason": string, "ctaParagraph": string }.';

    const user = JSON.stringify({
      onCardCaption: caption ?? '',
      generatedCaption: generatedCaption ?? '',
      videoTitle: videoTitle ?? '',
      author: author ?? '',
      context: context ?? '',
      brandAccount: { displayName: brand?.displayName ?? '', handle: brand?.handle ?? '' },
      industries,
      rosterByIndustry,
    });

    const rawAi = await deepseekChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { json: true, temperature: 0.3 },
    );

    const result = parseJson<{
      subjectName?: string; subjectIndustry?: string;
      ticker?: string; matchType?: string; reason?: string; ctaParagraph?: string;
    }>(rawAi);
    const pickedTicker = (result.ticker ?? '').trim();
    if (!pickedTicker) return NextResponse.json({ error: 'no ticker returned' }, { status: 502 });

    // Resolve the chosen ticker against the roster. Be forgiving — exact, then
    // case-insensitive — so a capitalization slip from the model still lands.
    let talent =
      talents.find(t => t.ticker === pickedTicker) ??
      talents.find(t => t.ticker.toLowerCase() === pickedTicker.toLowerCase()) ??
      null;
    if (!talent) return NextResponse.json({ error: `picked ticker "${pickedTicker}" not in roster` }, { status: 502 });

    const matchType = result.matchType === 'listed' ? 'listed' : 'industry';
    let reason = result.reason ?? '';

    // Guard against cross-industry blunders (the "basketball player → Bad Bunny"
    // bug): when this is an industry match and the model named a subjectIndustry
    // that exists on the roster, the pick MUST come from that bucket. If it
    // didn't but real same-industry candidates exist, override to the most
    // prominent of them — holders, then lifetime volume, then price as the proxy.
    const subjectIndustry = (result.subjectIndustry ?? '').trim();
    if (matchType === 'industry' && subjectIndustry) {
      const sameIndustry = talents.filter(t => norm(t.industry) === norm(subjectIndustry));
      if (sameIndustry.length > 0 && norm(talent.industry) !== norm(subjectIndustry)) {
        const biggest = [...sameIndustry].sort((a, b) =>
          (b.price.holders ?? 0) - (a.price.holders ?? 0) ||
          (b.price.volumeLifetimeUsd ?? 0) - (a.price.volumeLifetimeUsd ?? 0) ||
          (b.price.usd ?? 0) - (a.price.usd ?? 0),
        )[0]!;
        reason = `Overrode cross-industry pick (${talent.name}, ${talent.industry ?? 'Unknown'}) — ` +
          `subject's industry is "${subjectIndustry}", so selected ${biggest.name}. ${reason}`.trim();
        talent = biggest;
      }
    }

    return NextResponse.json({
      talent,
      matchType,
      subjectName: result.subjectName ?? '',
      subjectIndustry,
      reason,
      ctaParagraph: (result.ctaParagraph ?? '').trim(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
