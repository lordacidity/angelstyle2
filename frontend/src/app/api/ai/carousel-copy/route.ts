import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { geminiWithSearch, geminiGenerate, extractGeminiJson } from '@/lib/gemini';

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
      `  - headline: TWO SHORT sentences (~10-14 words each) with the concrete specifics — who/what/where plus AT LEAST one real number or verifiable detail from your search (attendance, streams, followers gained, chart position, notable names). HARD LIMIT 160 chars total — cut every filler word.`,
      `  - subheadline: MUST be "".`,
      ``,
      `PAGE 3 — slideType "supporting_1": the turn — why this exact moment moves ${personName}'s Pauv market.`,
      `  - NO numbers on this page. Name the MECHANISM that converts this story into attention (the rewatches, the headlines, the debate, the search spike) — do not write boilerplate like "all eyes are on them".`,
      `  - headline: ONE SHORT sentence making the turn, <= 65 chars (e.g. "THAT PHOTO IS EVERYWHERE RIGHT NOW").`,
      `  - subheadline: REQUIRED — one SHORT sentence, same idea from a different angle, <= 65 chars.`,
      ``,
      `Copy rules:`,
      `- Base every fact on Google Search or the provided story. NEVER invent numbers.`,
      `- Punchy, declarative, present tense, ALL-CAPS feel. Write like a sharp caption, not a press release. No emojis, no hashtags, no quotation marks around lines.`,
      `- BANNED phrases: "star-studded", "frenzy", "all eyes on", "taking the internet by storm", "breaking the internet", "the world is watching", "significant", "generates attention", "fueling conversations", "across social platforms".`,
      `- Character limits are HARD limits — count them.`,
      ``,
      `ALSO return three Google-Images search phrases, grounded in the real story:`,
      `- personQuery: the best image search for the people AT THE CENTER of this story — include BOTH names when the story is about two people (e.g. a wedding story → "taylor swift travis kelce", not just one name).`,
      `- contextQuery: a SPECIFIC real place or scene from the story — the actual venue, stadium, arena, city (use search to find where it happened; e.g. wedding at Madison Square Garden → "madison square garden aerial"). NEVER generic like "celebrity wedding" or "wedding rings".`,
      `- circleQuery: a logo or symbol tying the person to the story (club crest, league logo, label logo, event mark) — NOT the person.`,
      ``,
      `Output ONLY strict minified JSON, no prose, no code fences. NEVER use the " character inside a string value (use nothing or ' instead):`,
      `{"pages":[{"slideType":"main","headline":"...","subheadline":"..."},{"slideType":"supporting_1","headline":"...","subheadline":""},{"slideType":"supporting_1","headline":"...","subheadline":"..."}],"personQuery":"...","contextQuery":"...","circleQuery":"..."}`,
    ].filter(l => l !== undefined).join('\n');

    const clean = (s: unknown) => String(s ?? '').replace(/^["']|["']$/g, '').trim();
    type Page = { slideType: 'main' | 'supporting_1'; headline: string; subheadline: string };
    const sanitizePages = (rawPages: Array<{ headline?: string; subheadline?: string }> | undefined): Page[] => {
      const out = (rawPages ?? [])
        .map((p, i) => ({
          slideType: (i === 0 ? 'main' : 'supporting_1') as 'main' | 'supporting_1',
          headline: clean(p.headline),
          subheadline: clean(p.subheadline),
        }))
        .filter(p => p.headline)
        .slice(0, 3);
      if (out[1]) out[1].subheadline = ''; // card 2 is all headline — never a subtext
      return out;
    };

    // Gemini + grounding occasionally emits broken JSON (unescaped quotes) —
    // re-roll rather than failing the whole build.
    let pages: Page[] | null = null;
    let queries = { personQuery: '', contextQuery: '', circleQuery: '' };
    let failReason = '';
    for (let attempt = 1; attempt <= 3 && !pages; attempt++) {
      const raw = await geminiWithSearch(prompt, { temperature: 0.8, maxOutputTokens: 2048 });
      try {
        const result = JSON.parse(extractGeminiJson(raw)) as {
          pages?: Array<{ headline?: string; subheadline?: string }>;
          personQuery?: string; contextQuery?: string; circleQuery?: string;
        };
        const parsed = sanitizePages(result.pages);
        if (parsed.length < 3) { failReason = `returned ${parsed.length} usable pages (need 3)`; continue; }
        pages = parsed;
        queries = {
          personQuery: clean(result.personQuery),
          contextQuery: clean(result.contextQuery),
          circleQuery: clean(result.circleQuery),
        };
      } catch (e) { failReason = `could not parse AI output: ${String(e)}`; }
    }
    if (!pages) {
      return NextResponse.json({ error: `Gemini failed after 3 attempts — ${failReason}` }, { status: 502 });
    }

    // Models overshoot char limits no matter how the prompt begs. If any line
    // is over budget, run one search-free tighten pass that compresses without
    // changing facts; keep the originals if it fails.
    const CAPS = [
      { h: 78,  s: 68 },   // page 1 — hook + small fact
      { h: 170, s: 0 },    // page 2 — two short sentences, all headline
      { h: 72,  s: 72 },   // page 3 — one short sentence each
    ];
    const overCaps = (ps: Page[]) => ps.some((p, i) => p.headline.length > CAPS[i].h || p.subheadline.length > CAPS[i].s);
    if (overCaps(pages)) {
      try {
        const tightenPrompt = [
          `These are lines for a 3-card social carousel. Some are OVER their hard character limits. Rewrite ONLY what is needed so every line fits — keep the same concrete facts, names and numbers, keep the punch, cut filler words. Do not add new information.`,
          ``,
          `Limits:`,
          `- pages[0].headline <= 70 chars; pages[0].subheadline <= 60 chars`,
          `- pages[1].headline <= 160 chars (two short sentences); pages[1].subheadline stays ""`,
          `- pages[2].headline <= 65 chars; pages[2].subheadline <= 65 chars (one short sentence each)`,
          ``,
          `Current JSON:`,
          JSON.stringify({ pages }),
          ``,
          `Never use the " character inside a string value. Output ONLY the same strict minified JSON shape: {"pages":[...]}`,
        ].join('\n');
        const traw = await geminiGenerate([{ text: tightenPrompt }], { temperature: 0.3, maxOutputTokens: 800 });
        const tightened = sanitizePages((JSON.parse(extractGeminiJson(traw)) as { pages?: Array<{ headline?: string; subheadline?: string }> }).pages);
        if (tightened.length === 3) pages = tightened;
      } catch (e) { console.warn('[carousel-copy] tighten pass failed — keeping originals:', e); }
    }

    return NextResponse.json({ pages, ...queries });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
