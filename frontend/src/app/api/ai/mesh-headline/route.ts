import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat, parseJson } from '@/lib/deepseek';

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({ headline: z.string().min(1), category: z.string().optional(), personName: z.string().optional() });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'headline required' }, { status: 400 });
    const { headline, category, personName } = parsed.data;

    const raw = await deepseekChat(
      [
        {
          role: 'system',
          content:
            'You are a social media card copywriter for Pauv, a talent-backed stock market platform. ' +
            'Rewrite the given news headline into two parts for a branded card:\n' +
            '1. headline: punchy, attention-grabbing (max 55 chars, bold statement, present tense)\n' +
            '2. subheadline: brief context that gives the "so what" (max 90 chars, factual)\n' +
            'Return JSON: {"headline": "...", "subheadline": "..."}. No hashtags, no emoji.',
        },
        {
          role: 'user',
          content: `Category: ${category ?? 'general'}\n${personName ? `Person: ${personName}\n` : ''}News headline: "${headline}"`,
        },
      ],
      { json: true, temperature: 0.6 },
    );

    const parsed = parseJson<{ headline?: string; subheadline?: string }>(raw);
    return NextResponse.json({
      headline: parsed.headline ?? headline,
      subheadline: parsed.subheadline ?? '',
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
