// POST /api/vids/post-caption — the long-form caption under a finished build
// on Instagram: the copy-paste one, three paragraphs and about 1900
// characters, the shape Media's Post caption card writes. What it says is
// fixed by the video: WHO is being traded, WHICH WAY, and the case for it —
// up, why they are so great; down, why they should come down, without being
// mean — and then crypto, in every caption. Nothing from the AI-Prompts pool,
// no news brief: the person and the position are the whole brief.
//
// Who and which way are read off the screen recordings — their context and
// moments, as written on Edit & file ("pauv.com looking up and trading up on
// ronaldo") — by a quick first call, unless the caller already knows them (a
// Regenerate with the name corrected or the position flipped sends them
// outright). The persona is never sent: he is the one trading, not the one
// traded on. A recording that names no one is a 422 asking for a context that
// does; one that names no direction is taken as UP, the usual trade, and the
// builder shows the toggle to flip it.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { geminiGenerate } from '@/lib/gemini';
import { BANNED_WORDS, PAUV_BRIEF } from '@/lib/vids-brief';
import { LONG_CAPTION_MAX, LONG_CAPTION_MIN, LONG_CAPTION_PARAGRAPHS, writeInBand } from '@/lib/long-caption';
import { readTrade } from '@/lib/vids-read-trade';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The fast path Media's card runs on: a draft lands in about two seconds at
 *  the floor thinking level, and the band is held by the retry loop rather
 *  than by thinking. */
const MODEL = 'gemini-3.5-flash-lite';

type Position = 'up' | 'down';

const Schema = z.object({
  /** What the screen recordings and the ending show — the clips' own context
   *  and moments, without the persona. Read for the person and the position
   *  when those aren't given. */
  brief: z.string().max(4000).default(''),
  /** The person being traded, when the caller already knows. */
  person: z.string().max(120).default(''),
  position: z.enum(['up', 'down']).nullable().default(null),
});

/** A banned word in a draft, as an issue to nudge on. Whole words, any of the
 *  single-word forms on the list ("stock market" is caught by "stock"). The
 *  prompt forbids them; this is what catches the one that got through. */
const BANNED_RE = new RegExp(`\\b(${BANNED_WORDS.filter((w) => !w.includes(' ')).join('|')})s?\\b`, 'i');
const bannedIssue = (text: string): string[] => {
  const m = text.match(BANNED_RE);
  return m ? [`it uses "${m[0]}", a banned word that may not appear in any form; say it another way`] : [];
};

const SYSTEM = `You write the long-form caption that gets copy-pasted under a short vertical video on Instagram and TikTok.

${PAUV_BRIEF}

THE VIDEO
Someone looks a person up online, trades UP or DOWN on that person on Pauv, and shows what the trade made him. The caption is about the person he traded on. It is NOT about him, and not about the video's format.

THE CAPTION, in this order, one paragraph each:
1. THE TRADE. Open on the person: who they are, what they are known for right now, and say plainly that the video trades UP (or DOWN) on them on Pauv and why that is the call. Hook the reader on the person.
2. THE CASE. UP: why they are so great, the case that they are getting bigger, more popular, more culturally relevant: the run they are on, the moments, the numbers people already know, the pull they have. DOWN: why they should come down, the case that the noise has moved on, the run has cooled, the hype is ahead of them. Argue the TRAJECTORY, never the person: nothing mean, no insults, no mocking, nothing about looks, family, health or private life, nothing you would not say to their face. Sound like a fan who follows the space and has a take, not a brand account.
3. CRYPTO. Every caption brings crypto in, and this is the paragraph that does it: trading how people feel about a person is the same game as trading crypto, momentum, conviction, buying the dip, holding through the noise, and the crowd that watches Bitcoin and the memecoins is the crowd that gets it. Keep it to what is always true of crypto and its culture: no prices, no dates, no specific coin calls.

CONTENT
- Use what the person is genuinely known for. Do not invent facts, statistics, quotes, results or dates. When unsure, stay general.
- Pauv is named where the trade needs a place, and the position is said as trading up or trading down on them. No hard sell, no "link in bio", no call to action.

HARD RULES (these override everything else):
- EXACTLY ${LONG_CAPTION_PARAGRAPHS} paragraphs, each separated by a single blank line.
- LENGTH: the entire caption must be between ${LONG_CAPTION_MIN} and ${LONG_CAPTION_MAX} characters. Aim for about 1900. Reach it with depth on the person and the case, never with filler.
- NEVER use an em dash ("—") or en dash ("–"). Use a comma, a period, or "and" instead.
- The banned words above never appear, in any form.
- No hashtags, no emojis, no markdown, no labels, no preamble. Plain text only. Return ONLY the caption text.`;

const userPrompt = (person: string, position: Position) => [
  `Person being traded: ${person}`,
  `Position: ${position.toUpperCase()}. ${position === 'up'
    ? 'The case is that they are getting bigger.'
    : 'The case is that they should come down, argued kindly.'}`,
  '',
  `Write the caption now: the trade, the case for ${position.toUpperCase()}, then crypto. EXACTLY ${LONG_CAPTION_PARAGRAPHS} paragraphs, between ${LONG_CAPTION_MIN} and ${LONG_CAPTION_MAX} characters, no em dashes, none of the banned words.`,
].join('\n');

export async function POST(req: NextRequest) {
  try {
    const input = Schema.parse(await req.json());
    let person = input.person.trim();
    let position: Position = input.position ?? 'up';
    if (!person) {
      if (!input.brief.trim()) {
        return NextResponse.json(
          { error: 'Nothing to read the trade off — give the screen recordings a context on Edit & file first.' },
          { status: 400 },
        );
      }
      const read = await readTrade(input.brief);
      if (!read.person) {
        return NextResponse.json(
          { error: 'Couldn\'t tell who is being traded. Say who in the screen recording\'s context on Edit & file, like "trading up on ronaldo on pauv.com", or type the name here and press Enter.' },
          { status: 422 },
        );
      }
      person = read.person;
      position = input.position ?? read.position ?? 'up';
    }

    const caption = await writeInBand({
      system: SYSTEM,
      user: userPrompt(person, position),
      remind: `Keep it about ${person}: the trade, the case for ${position.toUpperCase()}, then crypto, and use NO em dashes.`,
      check: bannedIssue,
      // maxOutputTokens covers thinking as well as the caption, so it sits well
      // above what the reply itself needs (see Media's route for the figures).
      generate: (prompt) => geminiGenerate([{ text: prompt }], {
        model: MODEL,
        thinkingLevel: 'minimal',
        temperature: 0.7,
        maxOutputTokens: 6000,
        timeoutMs: 60_000,
      }),
    });
    if (!caption) return NextResponse.json({ error: 'empty response' }, { status: 502 });
    return NextResponse.json({ caption, person, position });
  } catch (err) {
    console.error('[vids post-caption POST]', err);
    const msg = err instanceof Error ? err.message : 'unexpected error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
