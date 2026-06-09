// Auto-pick the CTA talent(s) for a post — the AI "person generator" for the
// buy-CTA card, which rotates between up to two people.
//
// Flow (per Angel's spec):
//   1. Read ONLY the user-written on-card caption + the editor's context. NEVER
//      the AI-generated long-form caption (it name-drops other big figures and
//      would skew the pick away from the video's true subject).
//   2. Determine the main subject. If that person is directly on Pauv, pull them
//      as person1 (matchType "listed").
//   3. Otherwise (and always, to find the 2nd person) determine the subject's
//      industry + the single best-fitting info_subcategory, mapped to values that
//      actually exist on the roster.
//   4. Choose up to TWO DISTINCT people from that info_subcategory, MOST RELEVANT
//      FIRST. person1 = the listed subject if any, else the most relevant person
//      in the subcategory; person2 = the next most relevant in the SAME
//      subcategory. A single-person CTA (talent2 = null) is fine when the
//      subcategory has no second person.
//
// DISPLAY NOTE: only name, industry, price, and photo are real on the CTA card.
// The change %, sparkline, holders, and volume are fabricated client-side, so
// this route just needs to return the real identity + price fields.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { deepseekChat, parseJson } from '@/lib/deepseek';

export const runtime = 'nodejs';

// Built lazily — see /api/ai/talents for why module-scope construction breaks the
// build. Uses the MAIN read-only price-data project.
function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

interface ProfileRow {
  id: string; ticker: string; name: string; bio: string | null;
  photo_url: string | null; industry: string | null;
  info_subcategory: string | null; info_location: string | null;
  claim_status: string | null; view_count: number | null;
}
interface MarketRow {
  profile_id: string; latest_price_cents: number | null; p0: number | null;
  holders_count: number | null; total_volume_lifetime_cents: number | null;
  latest_tick_at: string | null; frozen: boolean | null;
}

// Same shape /api/ai/talents returns so the client drops a pick straight into the
// Market widget with no remapping.
function buildTalents(profiles: ProfileRow[], markets: MarketRow[]) {
  const byProfile = new Map(markets.map((m) => [m.profile_id, m]));
  return profiles.map((p) => {
    const m = byProfile.get(p.id) ?? null;
    const cents = m?.latest_price_cents ?? null;
    const p0 = m?.p0 ?? null;
    return {
      id: p.id, ticker: p.ticker, name: p.name, bio: p.bio, photo_url: p.photo_url,
      industry: p.industry, subcategory: p.info_subcategory, location: p.info_location,
      claimStatus: p.claim_status, viewCount: p.view_count ?? 0,
      price: {
        usd: cents != null ? cents / 100 : null,
        // p0 is in dollars, latest_price_cents in cents — normalise both to
        // dollars before comparing. (Not shown on the CTA: the card fabricates the
        // % — this is here only for completeness / other consumers.)
        lifetimeChangePct: cents != null && p0 != null && p0 > 0 ? ((cents / 100 - p0) / p0) * 100 : null,
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
      caption: z.string().optional(),  // user-written on-card caption
      context: z.string().optional(),  // editor's context notes
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { caption, context } = parsed.data;

    if (!caption?.trim() && !context?.trim()) {
      return NextResponse.json({ error: 'need a caption or context to pick from' }, { status: 400 });
    }

    // ── Load the active Pauv roster ─────────────────────────────────────────────
    const sb = getClient();
    const [{ data: profiles, error: pErr }, { data: markets, error: mErr }] = await Promise.all([
      sb.from('profiles')
        .select('id,ticker,name,bio,photo_url,industry,info_subcategory,info_location,claim_status,view_count')
        .is('delisted_at', null)
        .order('name'),
      sb.from('markets')
        .select('profile_id,latest_price_cents,p0,holders_count,total_volume_lifetime_cents,latest_tick_at,frozen'),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (mErr) throw new Error(mErr.message);

    const talents = buildTalents((profiles ?? []) as ProfileRow[], (markets ?? []) as MarketRow[]);
    if (talents.length === 0) return NextResponse.json({ error: 'no talents available' }, { status: 502 });

    const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();

    // Roster grouped industry → subcategory → [{ ticker, name }] so the model can
    // see the candidate pool for each field at a glance and never crosses fields.
    const byIndustry = new Map<string, Map<string, { ticker: string; name: string }[]>>();
    for (const t of talents) {
      const ind = t.industry?.trim() || 'Unknown';
      const sub = t.subcategory?.trim() || 'Unknown';
      if (!byIndustry.has(ind)) byIndustry.set(ind, new Map());
      const subMap = byIndustry.get(ind)!;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push({ ticker: t.ticker, name: t.name });
    }
    const rosterByIndustry: Record<string, Record<string, { ticker: string; name: string }[]>> = {};
    for (const [ind, subMap] of [...byIndustry.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      rosterByIndustry[ind] = Object.fromEntries(
        [...subMap.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      );
    }
    const industries = [...byIndustry.keys()].sort();

    const sys =
      'You choose which Pauv talents to feature in the buy-CTA of a social post. The CTA card rotates between up to two people.\n\n' +
      'Pauv is a marketplace for trading on public sentiment — every athlete, artist, creator, and cultural figure has a "ticker" that moves with how people feel about them.\n\n' +
      'You are given ONLY the post\'s user-written on-card caption and the editor\'s context notes. There is NO AI-generated caption; judge who the post is about purely from those two inputs. You are also given INDUSTRIES and ROSTER_BY_INDUSTRY: the Pauv talents grouped by industry and then by info_subcategory (each entry is { ticker, name }).\n\n' +
      'Follow these steps IN ORDER:\n' +
      '1. Identify the single main subject the post is about (subjectName).\n' +
      '2. Decide whether subjectName is ON the roster — match by name, case-insensitive, allowing minor spelling variants. If yes, that person is person1 and matchType is "listed".\n' +
      '3. Determine the subject\'s industry (subjectIndustry) and the single best-fitting info_subcategory (subjectSubcategory). BOTH must map to entries that ACTUALLY EXIST in ROSTER_BY_INDUSTRY (e.g. a soccer player → industry "Athlete", subcategory "Soccer"; a rapper → industry "Artist", subcategory "Rap"). Pick the closest existing buckets.\n' +
      '4. Choose up to TWO DISTINCT people, MOST RELEVANT FIRST:\n' +
      '   - person1: the listed subject from step 2 if there is one; otherwise the MOST relevant / most prominent person in subjectSubcategory (use your own knowledge of who is biggest).\n' +
      '   - person2: the NEXT most relevant person in subjectSubcategory, excluding person1.\n' +
      '   - BOTH people MUST come from subjectSubcategory. NEVER cross into a different subcategory. If subjectSubcategory has only one person, set ticker2 to null; a single-person CTA is fine.\n' +
      '5. matchType / matchType2 are "listed" if that exact person is directly referenced in the post, otherwise "subcategory".\n\n' +
      'Every ticker you return MUST be an exact ticker string from ROSTER_BY_INDUSTRY, and person1 and person2 must be different tickers.\n' +
      'Return JSON: { "subjectName": string, "subjectIndustry": string, "subjectSubcategory": string, "ticker": string, "ticker2": string | null, "matchType": "listed" | "subcategory", "matchType2": "listed" | "subcategory" | null, "reason": string }.';

    const user = JSON.stringify({
      onCardCaption: caption ?? '',
      context: context ?? '',
      industries,
      rosterByIndustry,
    });

    const rawAi = await deepseekChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { json: true, temperature: 0.3 },
    );

    const result = parseJson<{
      subjectName?: string; subjectIndustry?: string; subjectSubcategory?: string;
      ticker?: string; ticker2?: string | null;
      matchType?: string; matchType2?: string | null; reason?: string;
    }>(rawAi);

    // Resolve a ticker against the roster — exact, then case-insensitive — so a
    // capitalization slip from the model still lands.
    const resolveTicker = (tk: string | null | undefined) => {
      const s = (tk ?? '').trim();
      if (!s) return null;
      return talents.find((t) => t.ticker === s)
        ?? talents.find((t) => t.ticker.toLowerCase() === s.toLowerCase())
        ?? null;
    };
    // Best-effort "most relevant" fallback when the model fumbles a ticker. Real
    // prominence data is near-zero this early, so this is just a deterministic
    // tiebreak: holders → lifetime volume → price → views → name.
    const byProminence = (a: typeof talents[number], b: typeof talents[number]) =>
      (b.price.holders ?? 0) - (a.price.holders ?? 0) ||
      (b.price.volumeLifetimeUsd ?? 0) - (a.price.volumeLifetimeUsd ?? 0) ||
      (b.price.usd ?? 0) - (a.price.usd ?? 0) ||
      (b.viewCount ?? 0) - (a.viewCount ?? 0) ||
      a.name.localeCompare(b.name);
    const inSubcategory = (sub: string, exclude: Set<string>) =>
      talents.filter((t) => norm(t.subcategory) === norm(sub) && !exclude.has(t.id)).sort(byProminence);

    const subjectSubcategory = (result.subjectSubcategory ?? '').trim();
    const subjectIndustry = (result.subjectIndustry ?? '').trim();
    const subcatExists = !!subjectSubcategory && talents.some((t) => norm(t.subcategory) === norm(subjectSubcategory));

    // ── person1 ──────────────────────────────────────────────────────────────────
    let talent = resolveTicker(result.ticker);
    let matchType = result.matchType === 'listed' ? 'listed' : 'subcategory';
    let reason = result.reason ?? '';

    // Guard: a subcategory pick MUST live in the subject's subcategory. If the
    // model strayed and that subcategory exists, override to its most prominent.
    if (talent && matchType === 'subcategory' && subcatExists && norm(talent.subcategory) !== norm(subjectSubcategory)) {
      const fix = inSubcategory(subjectSubcategory, new Set())[0] ?? null;
      if (fix) {
        reason = `Overrode cross-subcategory pick (${talent.name}, ${talent.subcategory ?? 'Unknown'}) -> ${fix.name} in "${subjectSubcategory}". ${reason}`.trim();
        talent = fix;
      }
    }
    // Last resort if the model returned an unresolvable ticker.
    if (!talent && subcatExists) { talent = inSubcategory(subjectSubcategory, new Set())[0] ?? null; matchType = 'subcategory'; }
    if (!talent) return NextResponse.json({ error: `could not resolve a primary talent (ticker "${result.ticker ?? ''}")` }, { status: 502 });

    // ── person2 (optional) ────────────────────────────────────────────────────────
    const exclude = new Set([talent.id]);
    let matchType2: 'listed' | 'subcategory' | null =
      result.matchType2 === 'listed' ? 'listed' : result.matchType2 === 'subcategory' ? 'subcategory' : null;
    let talent2 = resolveTicker(result.ticker2 ?? null);
    if (talent2 && talent2.id === talent.id) talent2 = null;                                              // duplicate of person1
    if (talent2 && subcatExists && norm(talent2.subcategory) !== norm(subjectSubcategory)) talent2 = null; // crossed subcategory
    if (!talent2 && subcatExists) talent2 = inSubcategory(subjectSubcategory, exclude)[0] ?? null;         // fill from same subcategory
    matchType2 = talent2 ? (matchType2 ?? 'subcategory') : null;

    return NextResponse.json({
      talent,
      talent2,
      matchType,
      matchType2,
      subjectName: result.subjectName ?? '',
      subjectIndustry,
      subjectSubcategory,
      reason,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
