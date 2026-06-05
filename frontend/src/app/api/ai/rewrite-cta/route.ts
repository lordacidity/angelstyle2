// Rewrite ONLY the closing CTA paragraph of an already-generated caption so it
// names a specific, user-chosen talent. This is the manual counterpart to
// /api/ai/pick-cta: pick-cta both CHOOSES the talent and rewrites the CTA, but
// when the user overrides the person via the Change-person picker we already
// know who to feature — we just need the closing paragraph rewritten to name
// them. Keeps the caption text in sync with the Market widget after a manual swap.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat } from '@/lib/deepseek';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      generatedCaption: z.string().min(1),       // the full caption (all paragraphs)
      talentName:       z.string().min(1),        // who the CTA must now feature
      talentIndustry:   z.string().optional(),    // their field, for natural phrasing
      brand: z.object({ displayName: z.string().optional(), handle: z.string().optional() }).optional(),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { generatedCaption, talentName, talentIndustry, brand } = parsed.data;

    const brandLine = brand?.displayName || brand?.handle
      ? `This CTA is posted by the brand account "${brand?.displayName ?? ''}" ${brand?.handle ?? ''}`.trim() + '. '
      : '';

    const sys =
      'You rewrite ONLY the closing CTA paragraph of a social post so it features a SPECIFIC talent the editor has chosen.\n\n' +
      'Pauv is a marketplace for trading on public sentiment — every athlete, artist, creator, and cultural ' +
      'figure has a "ticker" that moves with how people feel about them. The CTA tells viewers to take a ' +
      'position on someone.\n\n' +
      brandLine +
      'You are given the full caption and the exact talent name to feature. Rewrite ONLY the final CTA ' +
      'paragraph so it bridges naturally from the post to taking a position on the chosen talent BY NAME, ' +
      'ending with a concrete step like "link in bio to trade on <Name>". ~50-80 words. Conversational, ' +
      'no hashtags, no emojis, plain text.\n\n' +
      'HARD BANS (no exceptions):\n' +
      '- NEVER use the words "stock", "invest", "investing", "investor", or "investment". Use "trade", ' +
      '"trading", "take a position", "ticker", "sentiment", "cultural value", "conviction", or "marketplace".\n' +
      '- NEVER use em-dashes (the "—" character). Use a comma, a period, or "and" instead.\n\n' +
      'Return ONLY the rewritten final paragraph — no preamble, no quotes, no labels, do NOT return the rest of the caption.';

    const user = JSON.stringify({
      fullCaption: generatedCaption,
      featureTalent: { name: talentName, industry: talentIndustry ?? '' },
      brandAccount: { displayName: brand?.displayName ?? '', handle: brand?.handle ?? '' },
    });

    const raw = await deepseekChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { temperature: 0.6 },
    );

    const ctaParagraph = (raw ?? '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\s*—\s*/g, ', ')
      .replace(/, ,/g, ',')
      .trim();
    if (!ctaParagraph) return NextResponse.json({ error: 'empty response' }, { status: 502 });

    return NextResponse.json({ ctaParagraph });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
