import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { geminiWithSearch, extractGeminiJson } from '@/lib/gemini';

// Writes the text for the 4-card carousel module (both the "From a name" and
// "Trending" flows) — Gemini with Google Search grounding, so the copy carries
// REAL numbers and specifics instead of generic filler. Card 4 is the market's
// bare chart (no text), so only THREE pages of copy come back:
//   page 1 (main)         — the hook
//   page 2 (supporting_1) — the meat: what actually happened, with real stats
//   page 3 (supporting_1) — the turn from the story to their Pauv market
// It also returns the three Google-Images search phrases the wizard uses
// (person / story context / circle logo), grounded in the real story details.
export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      personName: z.string().min(1),
      ticker: z.string().optional().default(''),
      category: z.string().optional(),
      story: z.object({
        headline: z.string().min(1),
        rawText: z.string().optional().default(''),
        sourceName: z.string().optional().default(''),
        url: z.string().optional(),
      }),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'personName and story required' }, { status: 400 });
    const { personName, ticker, category, story } = parsed.data;

    const prompt = [
      `You are a social-media copywriter for Pauv (pauv.com) — a platform where people TRADE on the sentiment/attention around public figures in real time, before traditional markets catch up.`,
      ``,
      `THE STORY (use Google Search to verify it and dig up the CONCRETE specifics — dates, numbers, records, venues, names):`,
      `Person: ${personName}${ticker ? ` (Pauv ticker: ${ticker})` : ''}`,
      `Category: ${category ?? 'people'}`,
      `Headline: "${story.headline}"${story.sourceName ? ` (${story.sourceName})` : ''}`,
      story.rawText ? `Details:\n${story.rawText.slice(0, 4000)}` : '',
      ``,
      `Write an Instagram carousel about this story. It has 4 cards but card 4 is the person's live price chart with NO text — so return EXACTLY 3 pages of copy. The three pages must build one narrative arc: the hook → the full story with hard facts → the market turn. Write like a sharp news desk, not like AI filler.`,
      ``,
      `PAGE 1 — slideType "main": the hook.`,
      `  - headline: the single most surprising, CONCRETE angle of the story, <= 70 chars (e.g. "MEET THE GOALKEEPER WHO GOT 13M FOLLOWERS IN 3 DAYS" — specific, not vague).`,
      `  - subheadline: one hard supporting fact, <= 60 chars (renders small).`,
      ``,
      `PAGE 2 — slideType "supporting_1": what ACTUALLY happened — the meat.`,
      `  - headline: 2 TIGHT sentences with the concrete specifics — who/what/where/when plus AT LEAST one real number or verifiable detail from your search (attendance, streams, followers gained, chart position, price, notable names). <= 200 chars total — punchy, no padding. This card has no subtext, so it must carry the story alone.`,
      `  - subheadline: MUST be "".`,
      ``,
      `PAGE 3 — slideType "supporting_1": the turn — why this exact moment moves ${personName}'s Pauv market.`,
      `  - NO numbers on this page. Name the MECHANISM that converts this story into attention (the rewatches, the headlines, the debate, the search spike) — do not write boilerplate like "all eyes are on them".`,
      `  - headline: ONE sentence making the turn, <= 90 chars.`,
      `  - subheadline: REQUIRED — one sentence that paraphrases the same idea from a different angle (a restatement, not a copy; it renders as its own equal-weight line). <= 90 chars.`,
      ``,
      `Copy rules:`,
      `- Base every fact on Google Search or the provided story. NEVER invent numbers.`,
      `- Punchy, declarative, present tense, ALL-CAPS feel. No emojis, no hashtags, no quotation marks around lines.`,
      `- BANNED phrases: "star-studded", "frenzy", "all eyes on", "taking the internet by storm", "breaking the internet", "the world is watching".`,
      ``,
      `ALSO return three Google-Images search phrases, grounded in the real story:`,
      `- personQuery: the best image search for the people AT THE CENTER of this story — include BOTH names when the story is about two people (e.g. a wedding story → "taylor swift travis kelce", not just one name).`,
      `- contextQuery: a SPECIFIC real place or scene from the story — the actual venue, stadium, arena, city (use search to find where it happened; e.g. wedding at Madison Square Garden → "madison square garden aerial"). NEVER generic like "celebrity wedding" or "wedding rings".`,
      `- circleQuery: a logo or symbol tying the person to the story (club crest, league logo, label logo, event mark) — NOT the person.`,
      ``,
      `Output ONLY strict minified JSON, no prose, no code fences:`,
      `{"pages":[{"slideType":"main","headline":"...","subheadline":"..."},{"slideType":"supporting_1","headline":"...","subheadline":""},{"slideType":"supporting_1","headline":"...","subheadline":"..."}],"personQuery":"...","contextQuery":"...","circleQuery":"..."}`,
    ].filter(l => l !== undefined).join('\n');

    const raw = await geminiWithSearch(prompt, { temperature: 0.8, maxOutputTokens: 2048 });

    let result: {
      pages?: Array<{ slideType?: string; headline?: string; subheadline?: string }>;
      personQuery?: string; contextQuery?: string; circleQuery?: string;
    };
    try {
      result = JSON.parse(extractGeminiJson(raw));
    } catch (e) {
      return NextResponse.json({ error: `Could not parse AI output: ${String(e)}`, raw: raw.slice(0, 500) }, { status: 502 });
    }

    const clean = (s: unknown) => String(s ?? '').replace(/^["']|["']$/g, '').trim();
    const pages = (result.pages ?? [])
      .map((p, i) => ({
        slideType: (i === 0 ? 'main' : 'supporting_1') as 'main' | 'supporting_1',
        headline: clean(p.headline),
        subheadline: clean(p.subheadline),
      }))
      .filter(p => p.headline)
      .slice(0, 3);
    if (pages.length < 3) {
      return NextResponse.json({ error: `Gemini returned ${pages.length} usable pages (need 3)`, raw: raw.slice(0, 400) }, { status: 502 });
    }
    pages[1].subheadline = ''; // card 2 is all headline — never a subtext

    return NextResponse.json({
      pages,
      personQuery: clean(result.personQuery),
      contextQuery: clean(result.contextQuery),
      circleQuery: clean(result.circleQuery),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
