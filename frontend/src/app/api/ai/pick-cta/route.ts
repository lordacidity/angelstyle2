// Auto-pick the CTA talent(s) for a post. Instead of the user manually searching
// the Market selector, DeepSeek reads the on-card caption + the generated
// long-form caption, figures out who the post is actually about, and chooses
// TWO Pauv talents to feature in the buy-CTA — the CTA card rotates between them.
// For EACH person independently the match is either:
//   - 'listed':   the person appears in / is a subject of the post AND is on Pauv.
//   - 'industry': the biggest same-industry talent on Pauv.
// person1 is the strongest pick (the actual subject if listed, else the biggest
// same-industry talent) and shows first; person2 is the next best. It also
// rewrites the caption's closing CTA paragraph so the words name the PRIMARY
// talent the Market widget shows — text + widget stay in sync.

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
      'You choose which TWO Pauv talents should be featured in the buy-CTA of a social post — the CTA ' +
      'card rotates between them — and you rewrite the post\'s closing CTA paragraph to name the primary one.\n\n' +
      'Pauv is a marketplace for trading on public sentiment — every athlete, artist, creator, ' +
      'and cultural figure has a "ticker" that moves with how people feel about them. The CTA tells ' +
      'viewers to take a position on someone.\n\n' +
      brandLine +
      'You are given: the post\'s on-card caption, the generated long-form caption, the posting brand ' +
      'account, the list of INDUSTRIES on Pauv, and ROSTER_BY_INDUSTRY — the talents listed on Pauv ' +
      'grouped under each industry (ticker, name, subcategory).\n\n' +
      'Steps — follow them in order and do NOT skip the industry step:\n' +
      '1. Identify the main person/subject the post is about (subjectName). Also note any OTHER notable ' +
      'people who actually appear in or are central to the post.\n' +
      '2. Determine the subject\'s field/industry and map it to the CLOSEST matching entry in the ' +
      'INDUSTRIES list (subjectIndustry). A basketball player → the sports/athlete industry, a rapper → ' +
      'the music industry, a streamer → the creator industry, etc. Pick the single best-fitting industry ' +
      'bucket that actually exists in the list.\n' +
      '3. Choose TWO DISTINCT talents from ROSTER_BY_INDUSTRY — person1 and person2. For EACH one ' +
      'independently the match is either:\n' +
      '   - "listed": the person actually appears in / is a subject of the post AND is on the roster ' +
      '(match by name, case-insensitive, allow minor spelling variants), or\n' +
      '   - "industry": the most prominent / most famous talent in the subjectIndustry bucket (use your ' +
      'own knowledge of who is biggest). You MUST pick from that industry\'s bucket — never cross into a ' +
      'different industry. ONLY if the subjectIndustry bucket cannot supply enough people may you use the ' +
      'closest related industry, and you must say so in "reason".\n' +
      '4. person1 is the BEST, most relevant pick — the actual subject if they are listed, otherwise the ' +
      'single biggest talent in the subjectIndustry bucket. person2 is the next best — another person ' +
      'from the post if one is listed, otherwise the next most prominent talent in the subjectIndustry ' +
      'bucket. person1 and person2 MUST be different tickers.\n' +
      '5. Rewrite ONLY the final CTA paragraph so it bridges naturally from the post to taking a ' +
      'position on person1 (the PRIMARY talent) BY NAME, ending with a concrete step like "link in bio ' +
      'to trade on <Name>". ~50-80 words. Conversational, no hashtags, no emojis, plain text. Do NOT ' +
      'return the first two paragraphs — only the rewritten final paragraph.\n\n' +
      'Every ticker you return MUST be one of the exact ticker strings from ROSTER_BY_INDUSTRY.\n' +
      'Return JSON: { "subjectName": string, "subjectIndustry": string, "ticker": string, "ticker2": string, ' +
      '"matchType": "listed" | "industry", "matchType2": "listed" | "industry", "reason": string, ' +
      '"ctaParagraph": string }.';

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
      ticker?: string; ticker2?: string;
      matchType?: string; matchType2?: string;
      reason?: string; ctaParagraph?: string;
    }>(rawAi);
    const pickedTicker = (result.ticker ?? '').trim();
    if (!pickedTicker) return NextResponse.json({ error: 'no ticker returned' }, { status: 502 });

    // Resolve a ticker against the roster. Be forgiving — exact, then
    // case-insensitive — so a capitalization slip from the model still lands.
    const resolveTicker = (tk: string | undefined) => {
      const s = (tk ?? '').trim();
      if (!s) return null;
      return talents.find(t => t.ticker === s)
        ?? talents.find(t => t.ticker.toLowerCase() === s.toLowerCase())
        ?? null;
    };
    // Most prominent talent in `industry`, excluding ids already taken — holders,
    // then lifetime volume, then price as the proxy for "who's biggest".
    const byProminence = (a: typeof talents[number], b: typeof talents[number]) =>
      (b.price.holders ?? 0) - (a.price.holders ?? 0) ||
      (b.price.volumeLifetimeUsd ?? 0) - (a.price.volumeLifetimeUsd ?? 0) ||
      (b.price.usd ?? 0) - (a.price.usd ?? 0);
    const biggestInIndustry = (industry: string, exclude: Set<string>) =>
      talents.filter(t => norm(t.industry) === norm(industry) && !exclude.has(t.id)).sort(byProminence)[0] ?? null;

    let talent = resolveTicker(pickedTicker);
    if (!talent) return NextResponse.json({ error: `picked ticker "${pickedTicker}" not in roster` }, { status: 502 });

    const matchType = result.matchType === 'listed' ? 'listed' : 'industry';
    let reason = result.reason ?? '';

    // Guard against cross-industry blunders (the "basketball player → Bad Bunny"
    // bug): when this is an industry match and the model named a subjectIndustry
    // that exists on the roster, the pick MUST come from that bucket. If it
    // didn't but real same-industry candidates exist, override to the most
    // prominent of them.
    const subjectIndustry = (result.subjectIndustry ?? '').trim();
    if (matchType === 'industry' && subjectIndustry) {
      const sameIndustry = talents.filter(t => norm(t.industry) === norm(subjectIndustry));
      if (sameIndustry.length > 0 && norm(talent.industry) !== norm(subjectIndustry)) {
        const biggest = [...sameIndustry].sort(byProminence)[0]!;
        reason = `Overrode cross-industry pick (${talent.name}, ${talent.industry ?? 'Unknown'}) — ` +
          `subject's industry is "${subjectIndustry}", so selected ${biggest.name}. ${reason}`.trim();
        talent = biggest;
      }
    }

    // ── Second (rotating) talent ───────────────────────────────────────────────
    // Always feature two people. Resolve the model's ticker2, then fix it up:
    // it must be DISTINCT from the primary and (for an industry match) live in the
    // subject's bucket. If the model fumbled it, fall back to the next most
    // prominent same-industry talent, then to the biggest talent of any industry.
    const matchType2 = result.matchType2 === 'listed' ? 'listed' : 'industry';
    let talent2 = resolveTicker(result.ticker2);
    const exclude = new Set([talent.id]);
    if (talent2 && talent2.id === talent.id) talent2 = null;        // duplicate of primary
    if (talent2 && matchType2 === 'industry' && subjectIndustry
        && talents.some(t => norm(t.industry) === norm(subjectIndustry))
        && norm(talent2.industry) !== norm(subjectIndustry)) {
      talent2 = null;                                               // cross-industry industry-pick
    }
    if (!talent2) {
      talent2 =
        (subjectIndustry ? biggestInIndustry(subjectIndustry, exclude) : null) ??
        biggestInIndustry(talent.industry ?? '', exclude) ??
        talents.filter(t => t.id !== talent.id).sort(byProminence)[0] ??
        null;                                                       // null only if roster has 1 talent
    }

    return NextResponse.json({
      talent,
      talent2,
      matchType,
      matchType2,
      subjectName: result.subjectName ?? '',
      subjectIndustry,
      reason,
      ctaParagraph: (result.ctaParagraph ?? '').trim(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
