// Generate a long-form social caption for a sports/music page, driven by what's
// trending in the industry RIGHT NOW rather than by the specific video.
//
// Two flows live here:
//
//   A. Prediction-market hook (athlete/artist rows with a typed context — the
//      preferred path per Angel's growth direction). The board's CONTEXT column
//      is treated as a Google query seed; we tack on prediction-market terms
//      and pull live headlines off SerpAPI, then write the caption around those
//      stories — the goal is to land in front of fans who follow Kalshi /
//      Polymarket / sports betting markets. videoTitle and author are
//      DELIBERATELY dropped from the prompt: Angel wants the angle anchored to
//      a viral market event, not whatever the scraped clip happens to be.
//
//   B. AI-Prompts trending fallback (no context typed, or SerpAPI fails). The
//      original flow: pick the best curated topic from the AI Prompts DB and
//      write around its overview. Kept so rows with no context don't error
//      out entirely.
//
// Hard rules (both flows): never mention Pauv (or trading / tickers / CTAs),
// and never exceed 2000 characters.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat, parseJson, type ChatMessage } from '@/lib/deepseek';
import { listPrompts, type AiPromptRow, type PromptCategory } from '@/lib/ai-prompts-db';

export const runtime = 'nodejs';

const MAX_CHARS = 2000;
const MIN_CHARS = 1750;

interface SerpSource { name?: string }
interface SerpNewsItem {
  title?: string;
  snippet?: string;
  source?: SerpSource | string;
  date?: string;
  link?: string;
  stories?: SerpNewsItem[];
}
interface Headline { title: string; source: string; date: string; snippet: string }

// Live Google News pull for the prediction-market flow. Reuses the same query
// shape the ai-prompts/generate route uses (tbm=nws + qdr:w + sbd:1) so we get
// genuinely breaking stories newest-first. We tack prediction-market terms onto
// whatever the user typed in the board's CONTEXT column so generic seeds like
// "NBA" land on sports-betting / Kalshi / Polymarket headlines instead of
// box-score recaps.
async function fetchPredictionMarketHeadlines(seed: string): Promise<Headline[]> {
  const key = process.env.SERPAPI_KEY ?? '';
  if (!key) return [];

  const q = `${seed} prediction markets Kalshi Polymarket`;
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('tbm', 'nws');
  url.searchParams.set('q', q);
  url.searchParams.set('gl', 'us');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('tbs', 'qdr:w,sbd:1');
  url.searchParams.set('api_key', key);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const json = (await res.json()) as { news_results?: SerpNewsItem[]; error?: string };
    if (json.error) return [];

    const flat: SerpNewsItem[] = [];
    for (const item of json.news_results ?? []) {
      if (Array.isArray(item.stories) && item.stories.length) flat.push(...item.stories);
      else flat.push(item);
    }
    return flat
      .map((s) => ({
        title: (s.title ?? '').trim(),
        source: (typeof s.source === 'string' ? s.source : s.source?.name ?? '').trim(),
        date: (s.date ?? '').trim(),
        snippet: (s.snippet ?? '').trim(),
      }))
      .filter((h) => h.title)
      .slice(0, 10);
  } catch {
    return [];
  }
}

// Force the caption into exactly two paragraphs. If the model emits more, the
// first stays the lead and the rest merge into the second; one paragraph is left
// as-is (nothing sensible to split on).
function normalizeToTwoParagraphs(s: string): string {
  const paras = s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 1) return paras[0] ?? s.trim();
  if (paras.length === 2) return paras.join('\n\n');
  return [paras[0], paras.slice(1).join(' ')].join('\n\n');
}

// Trim an over-long caption to <= max, preferring the last sentence end that's
// still at or above `min` (so we stay inside the band), then a word boundary,
// so we never ship a half-word or drop below the floor unnecessarily.
function clampRange(s: string, min: number, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  let bestStop = -1;
  for (const st of ['. ', '! ', '? ', '\n']) {
    const i = cut.lastIndexOf(st);
    if (i >= 0 && i + 1 >= min && i + 1 > bestStop) bestStop = i + 1;
  }
  if (bestStop >= min) return cut.slice(0, bestStop).trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace >= min ? cut.slice(0, lastSpace) : cut).trim();
}

function cleanText(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    // Model is told "no markdown" but sometimes emits **bold** / *italics*.
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\*/g, '')
    // Safety net for em-dashes the model is told to avoid.
    .replace(/\s*—\s*/g, ', ')
    .replace(/, ,/g, ',')
    .trim();
}

// Ask the model which single topic best fits the video. Returns an index into
// `candidates`; defaults to 0 on any ambiguity so we always have a topic.
async function pickTopicIndex(
  candidates: AiPromptRow[],
  video: { caption?: string; context?: string; videoTitle?: string },
): Promise<number> {
  if (candidates.length === 1) return 0;
  const list = candidates
    .map((c, i) => `${i}. ${c.topic}: ${c.overview}`)
    .join('\n');
  const raw = await deepseekChat(
    [
      {
        role: 'system',
        content:
          'You match a video to the SINGLE most relevant topic from a numbered list. ' +
          'Judge by which topic\'s subject best fits the video. If none fit well, pick the closest. ' +
          'Return only JSON: {"index": <number>}.',
      },
      {
        role: 'user',
        content:
          [
            video.caption ? `Video caption: ${video.caption}` : '',
            video.context ? `Context: ${video.context}` : '',
            video.videoTitle ? `Video title: ${video.videoTitle}` : '',
            '',
            'Topics:',
            list,
            '',
            'Return {"index": N} for the best-matching topic.',
          ].filter(Boolean).join('\n'),
      },
    ],
    { json: true, temperature: 0.2 },
  );
  try {
    const idx = Number(parseJson<{ index?: number }>(raw).index);
    if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length) return idx;
  } catch { /* fall through to default */ }
  return 0;
}

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      url:        z.string().optional(),
      caption:    z.string().optional(),  // user's typed on-card caption
      context:    z.string().optional(),  // user's free-form context
      videoTitle: z.string().optional(),  // pulled from VideoData.title
      author:     z.string().optional(),  // pulled from VideoData.author.nickname
      category:   z.enum(['athlete', 'artist']).optional(),  // industry, from the brand
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { caption, context, videoTitle, author, category } = parsed.data;

    if (!caption?.trim() && !context?.trim() && !videoTitle?.trim()) {
      return NextResponse.json({ error: 'need at least caption, context, or fetched video title' }, { status: 400 });
    }

    const industry = category === 'artist' ? 'music / artists' : category === 'athlete' ? 'sports / athletes' : '';

    // ── Flow A: prediction-market hook (athlete/artist + typed context) ───────
    // The board's CONTEXT column is hand-typed as a viral market angle ("World
    // Cup on Kalshi", "NBA on Polymarket", etc.); we use it directly as the
    // SerpAPI seed and skip every auto-scraped field (videoTitle/author). Falls
    // through to Flow B if no headlines come back, so a flaky SerpAPI doesn't
    // brick the caption.
    let sys: string;
    let user: string;
    let chosen: AiPromptRow | null = null;
    const useMarketFlow = (category === 'athlete' || category === 'artist') && !!context?.trim();
    const marketHeadlines = useMarketFlow ? await fetchPredictionMarketHeadlines(context!.trim()) : [];

    if (useMarketFlow && marketHeadlines.length > 0) {
      const headlinesText = marketHeadlines
        .map((h, i) => {
          const meta = [h.source, h.date].filter(Boolean).join(', ');
          return `${i + 1}. ${h.title}${meta ? ` (${meta})` : ''}${h.snippet ? ` - ${h.snippet}` : ''}`;
        })
        .join('\n');

      sys =
        'You write a long-form social caption for a sports OR music page on Instagram and TikTok. ' +
        'The caption is built around what is happening on PREDICTION MARKETS right now (Kalshi, Polymarket, sports betting markets, market volume on specific games or events), not a play-by-play of the video.\n\n' +
        'You will get an industry, a market-flavored context seed, and a list of the freshest news headlines that came back when we searched that seed alongside prediction-market terms.\n\n' +
        'Write the caption so it:\n' +
        '- Leads with the biggest current PREDICTION-MARKET storyline from the headlines: which event/odds/market is everyone talking about, what just moved, what volume is doing.\n' +
        '- Uses the real names, teams, events, dates, and specifics from the headlines (they double as SEO + reach for the prediction-market audience). Do not invent facts beyond the headlines.\n' +
        '- Treats the on-card caption (and the video implicitly behind it) as a hook only. Spend the bulk on the prediction-market angle and why this market matters.\n' +
        '- Sounds like an in-the-know fan who follows both the sport/music AND the markets around it, not a brand account.\n\n' +
        'HARD RULES (these override everything else):\n' +
        '- STRUCTURE: EXACTLY two paragraphs, separated by a single blank line.\n' +
        `- LENGTH: between ${MIN_CHARS} and ${MAX_CHARS} characters. Aim for ~1900. Add depth on the market storyline to reach the length, no filler.\n` +
        '- NEVER mention Pauv, "take a position", "link in bio", or any direct CTA. You CAN reference Kalshi, Polymarket, prediction markets, odds, volume, sports betting markets as journalism — that\'s the whole point — but never as a call to action.\n' +
        '- No hashtags, no emojis, no markdown, no em-dashes (use commas or periods), no labels, no preamble.\n' +
        '- Plain text only.\n' +
        'Return ONLY the caption text.';

      user = [
        industry ? `Industry: ${industry}` : '',
        `Market-flavored context seed (the angle this post is leaning into): ${context!.trim()}`,
        caption ? `On-card caption (light background only): ${caption}` : '',
        '',
        'Freshest headlines from a Google News search for that seed + prediction-market terms (use these as the trending hook):',
        headlinesText,
        '',
        `Write the caption now, centered on the prediction-market storyline above. EXACTLY two paragraphs, between ${MIN_CHARS} and ${MAX_CHARS} characters.`,
      ].filter(Boolean).join('\n');
    } else {
      // ── Flow B: AI-Prompts trending fallback ────────────────────────────────
      let prompts: AiPromptRow[] = [];
      try {
        prompts = await listPrompts();
      } catch (e) {
        console.error('[social-caption] listPrompts failed', e);
      }
      const cat: PromptCategory | undefined = category;
      const candidates = prompts.filter(
        (p) => p.topic.trim() && p.overview.trim() && (!cat || p.category === cat),
      );

      if (candidates.length > 0) {
        const idx = await pickTopicIndex(candidates, { caption, context, videoTitle });
        chosen = candidates[idx] ?? candidates[0];
      }

      sys =
        'You write a long-form social caption for a sports OR music page on Instagram and TikTok. ' +
        'The caption is about the wider INDUSTRY and what is trending in the news RIGHT NOW, not a play-by-play of the specific video.\n\n' +
        'You may be given the industry, a TOPIC plus a short brief of the most recent / most talked-about news for that topic, and some light context about a video being posted.\n\n' +
        'Write the caption so it:\n' +
        '- Leads with and centers on the recent NEWS / trend in the brief, the biggest current story in that corner of the industry.\n' +
        '- Uses the real names, teams, events, dates and specifics from the brief (these double as SEO keywords). Do not invent facts beyond the brief and the context.\n' +
        '- Treats the video as a small hook at most. Spend the bulk of the caption on the industry storyline, why it matters, and the bigger picture, NOT on describing the video.\n' +
        '- Sounds like an in-the-know fan who follows the space, not a brand account.\n\n' +
        'HARD RULES (these override everything else):\n' +
        '- STRUCTURE: EXACTLY two paragraphs, separated by a single blank line. Not one, not three.\n' +
        `- LENGTH: the entire caption must be between ${MIN_CHARS} and ${MAX_CHARS} characters. Aim for about 1900. Never go below ${MIN_CHARS} and never exceed ${MAX_CHARS}. Add more depth on the news and the bigger picture to reach the length, do not pad with filler.\n` +
        '- NEVER mention Pauv, trading, tickers, markets, stocks, buying, investing, "take a position", "link in bio", or any call to action. This is purely a news / industry caption.\n' +
        '- No hashtags, no emojis, no markdown, no em-dashes (use commas or periods), no labels, no preamble.\n' +
        '- Plain text only.\n' +
        'Return ONLY the caption text.';

      user = [
        industry ? `Industry: ${industry}` : '',
        chosen ? `Topic: ${chosen.topic}` : '',
        chosen ? `Recent trending news brief: ${chosen.overview}` : 'No specific news brief is available; write a current, industry-flavored caption from the context below.',
        videoTitle ? `Video title (light background only): ${videoTitle}` : '',
        author     ? `Source creator (light background only): ${author}` : '',
        caption    ? `On-card caption (light background only): ${caption}` : '',
        context    ? `Editor context (light background only): ${context}` : '',
        '',
        `Write the caption now, centered on the industry news above. EXACTLY two paragraphs, between ${MIN_CHARS} and ${MAX_CHARS} characters.`,
      ].filter(Boolean).join('\n');
    }

    // Generate, then nudge once if it lands short — the model tends to under-run
    // the floor more than it over-runs the ceiling. Over-runs get clamped; the
    // best in-or-near-band candidate wins. Keep attempts small to stay snappy.
    const messages: ChatMessage[] = [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ];
    let best = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await deepseekChat(messages, { temperature: 0.7 });
      let candidate = normalizeToTwoParagraphs(cleanText(raw));
      if (candidate.length > MAX_CHARS) candidate = normalizeToTwoParagraphs(clampRange(candidate, MIN_CHARS, MAX_CHARS));
      if (candidate.length >= MIN_CHARS && candidate.length <= MAX_CHARS) { best = candidate; break; }
      // Hold onto the longest candidate that still fits under the ceiling.
      if (candidate.length <= MAX_CHARS && candidate.length > best.length) best = candidate;
      // Too short — ask it to expand, keeping structure and rules.
      messages.push({ role: 'assistant' as const, content: candidate });
      messages.push({
        role: 'user' as const,
        content:
          `That draft was ${candidate.length} characters, under the ${MIN_CHARS} minimum. ` +
          `Expand it to between ${MIN_CHARS} and ${MAX_CHARS} characters, keeping EXACTLY two paragraphs and every rule. ` +
          'Add more substance on the news and the bigger-picture industry angle, no filler. Return ONLY the caption.',
      });
    }

    const text = best;
    if (!text) return NextResponse.json({ error: 'empty response' }, { status: 502 });
    // `topic` is returned for visibility/debugging; the client only needs caption.
    return NextResponse.json({ caption: text, topic: chosen?.topic ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
