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

// Live Google News pull for the prediction-market flow.
//
// REQUIRES a prediction-market term to appear in each result by wrapping the
// market tokens in an OR clause: Google then ranks pages that mention Kalshi /
// Polymarket / "prediction market" higher than generic recaps. We also keep the
// user's seed as a verbatim phrase ("...") so a noisy seed like "knicks fight
// spurs prediction market" doesn't get diluted into a broad NBA query that
// returns box scores. tbs=qdr:w,sbd:1 = past week, newest-first.
//
// Returns headlines filtered to those that actually mention one of the market
// tokens — Google's ranker is generous and will sometimes leak generic sports
// stories in even with the OR clause. Falling back to the AI-Prompts trending
// flow when nothing survives is preferable to feeding the model recap noise.
const MARKET_TOKENS = ['kalshi', 'polymarket', 'prediction market', 'betting market', 'sportsbook', 'money line', 'odds', 'over/under'] as const;
async function fetchPredictionMarketHeadlines(seed: string): Promise<Headline[]> {
  const key = process.env.SERPAPI_KEY ?? '';
  if (!key) return [];

  // Wrap seed as a phrase so the dominant tokens stay tied together; require any
  // one market keyword to also appear via the OR group.
  const q = `"${seed}" (Kalshi OR Polymarket OR "prediction market" OR "betting market")`;
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
    const mapped = flat
      .map((s) => ({
        title: (s.title ?? '').trim(),
        source: (typeof s.source === 'string' ? s.source : s.source?.name ?? '').trim(),
        date: (s.date ?? '').trim(),
        snippet: (s.snippet ?? '').trim(),
      }))
      .filter((h) => h.title);

    // Post-filter: only keep stories whose title or snippet actually contains a
    // market token. If the strict filter strips everything, fall back to the raw
    // mapped list so the prompt still gets the freshest results we did find.
    const strict = mapped.filter((h) => {
      const blob = `${h.title} ${h.snippet}`.toLowerCase();
      return MARKET_TOKENS.some((t) => blob.includes(t));
    });
    return (strict.length > 0 ? strict : mapped).slice(0, 10);
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
        'You are a prediction-market reporter writing social captions for an Instagram / TikTok page. ' +
        'The caption is NOT a story about an athlete or artist. It is a story about a PREDICTION MARKET (Kalshi, Polymarket, sportsbook line, money line, total, market volume) where that athlete or artist happens to be the subject. ' +
        'Picture yourself as a financial journalist covering market action — except the asset class is a sports / pop-culture market.\n\n' +
        'You will get an industry, a market-flavored context seed, and a list of fresh news headlines that already mention a prediction market.\n\n' +
        'PARAGRAPH ASSIGNMENTS — each paragraph has a fixed job. Do not deviate:\n' +
        '- PARAGRAPH 1: The biggest current market storyline from the headlines. Name the platform (Kalshi / Polymarket / a specific sportsbook). Cite specific numbers from the headlines (odds, percentages, dollar volume) wherever they appear. Describe what JUST moved on the market and why it moved.\n' +
        '- PARAGRAPH 2: Wider market context. Related markets on the same event (series-winner, MVP, player props, derivative contracts), volume trends, what this market move says about broader sentiment in the prediction-market space right now, OR how this market is mispriced relative to fundamentals. Still market-only — do not pivot to an arena atmosphere story, a celebrity sighting, a political angle, a fashion moment, or any non-market sub-story. If a headline is about something off-court / off-stage, IGNORE it: you are filing on the market, not the spectacle.\n\n' +
        'NON-NEGOTIABLE CONTENT RULES:\n' +
        '- The OPENING SENTENCE of paragraph 1 must name a specific market or platform — "Kalshi", "Polymarket", "the sportsbook line", "the moneyline", "the spread", "the total", or a similarly concrete market term. Not "the team". Not "the game". The market.\n' +
        '- Every paragraph must contain MULTIPLE references to: Kalshi, Polymarket, prediction market, betting market, odds, money line, spread, total, over/under, volume, market cap, market price, sportsbook. A paragraph that mentions a market only once and then drifts into generic sports / music recap has failed.\n' +
        '- Cite specific numbers from the headlines whenever they appear. If a headline gives no numbers, describe direction and pressure ("market shifted in favor of...", "volume on the series winner has spiked...", "implied probability climbed from X to Y") — but stay in market vocabulary.\n' +
        '- Do NOT describe what is happening in the video. Do NOT recap the game / song / event play-by-play. The video is the SEO hook the post is filed under; the body is market analysis.\n' +
        '- Sound like an in-the-know markets follower (think Sharp Football, Unusual Whales, action-network analyst), not a sports recap writer.\n\n' +
        'HARD RULES (these override everything else):\n' +
        '- STRUCTURE: EXACTLY two paragraphs, separated by a single blank line.\n' +
        `- LENGTH: between ${MIN_CHARS} and ${MAX_CHARS} characters. Aim for ~1900. Add depth on the MARKET storyline (derivative markets, sentiment shifts, volume trends) to reach length, no filler.\n` +
        '- NEVER mention Pauv, "take a position", "link in bio", "place your bet", or any direct CTA. You CAN reference Kalshi / Polymarket / sportsbooks / odds / volume as journalism — that is the entire point — but never as a call to action.\n' +
        '- Do not invent fake odds, fake volume, or fake market activity. If the headlines do not give you a number, talk in directional / qualitative market terms.\n' +
        '- No hashtags, no emojis, no markdown, no em-dashes (use commas or periods), no labels, no preamble.\n' +
        '- Plain text only. Return ONLY the caption text.\n\n' +
        'Example of the VOICE + STRUCTURE we want (do not copy facts, copy the density of market language and the strict market focus across BOTH paragraphs):\n\n' +
        'PARA 1: Polymarket\'s "Knicks to win the series" contract is trading at 71 cents this morning, up from 49 cents before Game 2, the sharpest one-game move on the platform this postseason. Volume on the series-winner market has cleared $3.2M in the last 48 hours, with the biggest fills coming after the third quarter on Saturday, when the moneyline at major sportsbooks flipped Knicks from a +130 underdog to a -150 favorite in real time. The market reading the Spurs as cooked is no longer a contrarian take, it is the consensus.\n\n' +
        'PARA 2: The derivative markets are telling the same story even louder. Kalshi\'s "Wembanyama Finals MVP" market collapsed from 38 cents to 9 cents since tip-off Tuesday, the steepest one-week MVP-market drop Kalshi has logged this season. Sportsbook player-prop markets have followed, with Wembanyama\'s points total for Game 3 falling from 24.5 to 21.5 and his rebound total ticking down a full board. Open interest across the entire Finals market complex on Polymarket is now north of $11M, with money concentrating on a Knicks sweep rather than a closeout in five — a sentiment shift that the sportsbook series-price markets have not fully caught up to yet, which is why the cross-market spread is the conversation among traders right now.';

      user = [
        industry ? `Industry: ${industry}` : '',
        `Market-flavored context seed: ${context!.trim()}`,
        caption ? `On-card caption (for SEO context only — DO NOT describe the video): ${caption}` : '',
        '',
        'Fresh headlines from a Google News search for the seed + prediction-market terms. These are your sources of truth — quote numbers from them where possible, never invent:',
        headlinesText,
        '',
        `Write the caption now. Lead with a specific market name + movement. EXACTLY two paragraphs, between ${MIN_CHARS} and ${MAX_CHARS} characters. Every paragraph must contain a market term.`,
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
    // Flow A drafts have to be densely market-flavored, not just sprinkled.
    // Each paragraph needs at least TWO independent market token mentions —
    // one is easy for the model to hit and then drift back into a recap.
    const countMarketHits = (s: string) => {
      const l = s.toLowerCase();
      let n = 0;
      for (const t of MARKET_TOKENS) {
        let idx = 0;
        while ((idx = l.indexOf(t, idx)) !== -1) { n++; idx += t.length; }
      }
      return n;
    };
    const MIN_MARKET_HITS_PER_PARA = 2;
    const failingParagraphs = (s: string): number[] => {
      const paras = s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      const out: number[] = [];
      paras.forEach((p, i) => { if (countMarketHits(p) < MIN_MARKET_HITS_PER_PARA) out.push(i + 1); });
      return out;
    };
    const passesMarketCheck = (s: string) => !useMarketFlow || failingParagraphs(s).length === 0;

    // Lower temperature than the fallback flow — we want the model to LOCK
    // onto the market angle and stay there rather than creatively diversify
    // into atmosphere stories. 4 attempts (up from 3) gives the validator
    // more chances to fire when a generic seed leaks recap headlines.
    const MAX_ATTEMPTS = 4;
    const TEMP = useMarketFlow ? 0.5 : 0.7;
    let best = '';
    let bestPassesMarket = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const raw = await deepseekChat(messages, { temperature: TEMP });
      let candidate = normalizeToTwoParagraphs(cleanText(raw));
      if (candidate.length > MAX_CHARS) candidate = normalizeToTwoParagraphs(clampRange(candidate, MIN_CHARS, MAX_CHARS));
      const inBand = candidate.length >= MIN_CHARS && candidate.length <= MAX_CHARS;
      const okMarket = passesMarketCheck(candidate);
      if (inBand && okMarket) { best = candidate; bestPassesMarket = true; break; }
      // Best-partial selection: market-pass first, then length within band.
      const promote = (!bestPassesMarket && okMarket) || (bestPassesMarket === okMarket && candidate.length > best.length && candidate.length <= MAX_CHARS);
      if (promote) { best = candidate; bestPassesMarket = okMarket; }
      // Specific feedback: name which paragraph(s) failed so the retry knows
      // exactly what to fix.
      const issues: string[] = [];
      if (candidate.length < MIN_CHARS) issues.push(`it is ${candidate.length} characters, under the ${MIN_CHARS} minimum — expand to between ${MIN_CHARS} and ${MAX_CHARS}`);
      if (!okMarket && useMarketFlow) {
        const fails = failingParagraphs(candidate);
        issues.push(
          `paragraph${fails.length > 1 ? 's' : ''} ${fails.join(' and ')} lack${fails.length === 1 ? 's' : ''} dense prediction-market language — each paragraph needs AT LEAST ${MIN_MARKET_HITS_PER_PARA} mentions of Kalshi / Polymarket / odds / moneyline / spread / volume / sportsbook / market price. Do NOT pivot to arena vibes, celebrity sightings, political angles, or any non-market story. Rewrite the failing paragraph(s) so they are market analysis from start to finish`,
        );
      }
      if (issues.length === 0) issues.push('output did not pass validation, regenerate');
      messages.push({ role: 'assistant' as const, content: candidate });
      messages.push({
        role: 'user' as const,
        content:
          `That draft has problems: ${issues.join('; ')}. ` +
          'Rewrite keeping EXACTLY two paragraphs and every rule. Return ONLY the caption.',
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
