// Generate the long-form, copy-paste social caption for a video post.
//
// Flow (per Angel's spec):
//   1. The category comes from the brand kit (athlete | artist) and filters the
//      AI-Prompts topic pool to that vertical.
//   2. DeepSeek reads the on-card caption + editor context (plus the fetched
//      video title as light video signal) and picks the single best-fitting
//      topic from that pool.
//   3. We hand the model that topic's freshly generated news overview and have it
//      write the caption AROUND that news.
//
// Output rules (hard):
//   - EXACTLY 3 paragraphs.
//   - Between 1750 and 2000 characters.
//   - The FIRST TWO SENTENCES are about the video; everything after pivots into
//     the topic / recent news.
//   - NO em dashes. No Pauv / trading / CTA mentions (the CTA is a separate
//     widget), no hashtags, no emojis, no markdown.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat, parseJson, type ChatMessage } from '@/lib/deepseek';
import { listPrompts, type AiPromptRow, type PromptCategory } from '@/lib/ai-prompts-db';

export const runtime = 'nodejs';

const MIN_CHARS = 1750;
const MAX_CHARS = 2000;
const TARGET_PARAGRAPHS = 3;

// Strip wrapping quotes, stray markdown, and (critically) every em / en dash —
// the caption must never contain one. Dashes become commas; any double comma
// that falls out of that is collapsed.
function cleanText(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\*/g, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim();
}

// Force the caption to exactly `n` paragraphs. Too many → merge the overflow into
// the last; too few → return as-is (nothing reliable to split on; the retry loop
// nudges the model instead).
function normalizeParagraphs(s: string, n: number): string {
  const paras = s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 1) return paras[0] ?? s.trim();
  if (paras.length === n) return paras.join('\n\n');
  if (paras.length > n) {
    const head = paras.slice(0, n - 1);
    const tail = paras.slice(n - 1).join(' ');
    return [...head, tail].join('\n\n');
  }
  return paras.join('\n\n');
}

function countParagraphs(s: string): number {
  return s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
}

// Trim an over-long caption to <= max, preferring the last sentence end at/above
// min so we stay inside the band and never cut a word.
function clampRange(s: string, min: number, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  let best = -1;
  for (const stop of ['. ', '! ', '? ', '\n']) {
    const i = cut.lastIndexOf(stop);
    if (i >= 0 && i + 1 >= min && i + 1 > best) best = i + 1;
  }
  if (best >= min) return cut.slice(0, best).trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace >= min ? cut.slice(0, lastSpace) : cut).trim();
}

// Ask the model which single topic best fits the video (judged by the on-card
// caption + context). Returns an index into `candidates`; defaults to 0 on any
// ambiguity so we always have a topic.
async function pickTopicIndex(
  candidates: AiPromptRow[],
  video: { caption?: string; context?: string; videoTitle?: string },
): Promise<number> {
  if (candidates.length === 1) return 0;
  const list = candidates.map((c, i) => `${i}. ${c.topic}: ${c.overview}`).join('\n');
  const raw = await deepseekChat(
    [
      {
        role: 'system',
        content:
          'You match a video to the SINGLE most relevant topic from a numbered list. ' +
          'Judge by which topic best fits what the video is about. If none fit well, pick the closest. ' +
          'Return only JSON: {"index": <number>}.',
      },
      {
        role: 'user',
        content: [
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
      caption:    z.string().optional(),  // on-card caption (editor-written)
      context:    z.string().optional(),  // editor's free-form context
      videoTitle: z.string().optional(),  // scraped VideoData.title
      author:     z.string().optional(),  // scraped VideoData.author.nickname
      category:   z.enum(['athlete', 'artist', 'gamer']).optional(),  // from the brand kit
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { caption, context, videoTitle, author, category } = parsed.data;

    if (!caption?.trim() && !context?.trim() && !videoTitle?.trim()) {
      return NextResponse.json({ error: 'need at least caption, context, or fetched video title' }, { status: 400 });
    }

    const cat: PromptCategory = category ?? 'athlete';
    const industry =
      cat === 'artist' ? 'music / artists' :
      cat === 'gamer'  ? 'gaming / esports' :
      'sports / athletes';

    // ── 1 + 2. Pick the best-fitting topic from this category's AI-Prompts pool ──
    let prompts: AiPromptRow[] = [];
    try {
      prompts = await listPrompts();
    } catch (e) {
      console.error('[social-caption] listPrompts failed', e);
    }
    const candidates = prompts.filter((p) => p.topic.trim() && p.overview.trim() && p.category === cat);
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: `No ${cat} topics with a generated overview are available — add one in AI Prompts first.` },
        { status: 422 },
      );
    }
    const idx = await pickTopicIndex(candidates, { caption, context, videoTitle });
    const chosen = candidates[idx] ?? candidates[0];

    // ── 3. Write the caption around that topic's news overview ───────────────────
    const sys =
      'You write the long-form caption that gets copy-pasted under a sports OR music video on Instagram and TikTok.\n\n' +
      'You are given the brand industry, a TOPIC plus a short brief of the most recent / most talked-about news for that topic, and signals about the specific video being posted (its on-card caption, the editor\'s context notes, and the scraped video title).\n\n' +
      'STRUCTURE (follow exactly):\n' +
      `- EXACTLY ${TARGET_PARAGRAPHS} paragraphs, each separated by a single blank line.\n` +
      '- The FIRST TWO SENTENCES are about the VIDEO itself, what is happening in this clip, using the video caption / context / title. Hook the viewer on the video.\n' +
      '- Immediately AFTER those two sentences, pivot into the recent NEWS from the brief and stay there for the rest of the caption. Paragraph 1 carries the two video sentences and then begins the news; paragraphs 2 and 3 develop the news story and the bigger picture.\n\n' +
      'CONTENT:\n' +
      '- Center the body on the news / trend in the brief, the biggest current story in that corner of the industry.\n' +
      '- Use the real names, teams, events, and dates from the brief (these double as SEO keywords). Do not invent facts beyond the brief and the video signals.\n' +
      '- Sound like an in-the-know fan who follows the space, not a brand account.\n\n' +
      'HARD RULES (these override everything else):\n' +
      `- LENGTH: the entire caption must be between ${MIN_CHARS} and ${MAX_CHARS} characters. Aim for about 1900. Add depth on the news and the bigger picture to reach the length, never pad with filler.\n` +
      '- NEVER use an em dash ("—") or en dash ("–"). Use a comma, a period, or "and" instead.\n' +
      '- NEVER mention Pauv, trading, tickers, markets, stocks, buying, investing, "take a position", "link in bio", or any call to action. This is purely a news / industry caption.\n' +
      '- No hashtags, no emojis, no markdown, no labels, no preamble.\n' +
      '- Plain text only. Return ONLY the caption text.';

    const user = [
      `Industry: ${industry}`,
      `Topic: ${chosen.topic}`,
      `Recent trending news brief: ${chosen.overview}`,
      '',
      'The specific video being posted:',
      `- On-card caption: ${caption?.trim() || '(none)'}`,
      context    ? `- Editor context: ${context.trim()}` : '',
      videoTitle ? `- Scraped video title: ${videoTitle.trim()}` : '',
      author     ? `- Source creator: ${author.trim()}` : '',
      '',
      `Write the caption now. First two sentences about the video, then into the news. EXACTLY ${TARGET_PARAGRAPHS} paragraphs, between ${MIN_CHARS} and ${MAX_CHARS} characters, no em dashes.`,
    ].filter(Boolean).join('\n');

    // Generate, then nudge on misses (length out of band or wrong paragraph
    // count). The model tends to under-run the floor; over-runs get clamped. The
    // closest-to-valid candidate wins if no attempt lands cleanly.
    const messages: ChatMessage[] = [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ];
    const MAX_ATTEMPTS = 4;
    let best = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const raw = await deepseekChat(messages, { temperature: 0.7 });
      let candidate = normalizeParagraphs(cleanText(raw), TARGET_PARAGRAPHS);
      if (candidate.length > MAX_CHARS) {
        candidate = normalizeParagraphs(clampRange(candidate, MIN_CHARS, MAX_CHARS), TARGET_PARAGRAPHS);
      }
      const inBand = candidate.length >= MIN_CHARS && candidate.length <= MAX_CHARS;
      const okParas = countParagraphs(candidate) === TARGET_PARAGRAPHS;
      if (inBand && okParas) { best = candidate; break; }

      // Keep the closest-to-valid partial: prefer the correct paragraph count,
      // then the longest draft still within the ceiling.
      const bestOkParas = best ? countParagraphs(best) === TARGET_PARAGRAPHS : false;
      const promote =
        !best ||
        (okParas && !bestOkParas) ||
        (okParas === bestOkParas && candidate.length > best.length && candidate.length <= MAX_CHARS);
      if (promote) best = candidate;

      const issues: string[] = [];
      if (candidate.length < MIN_CHARS) issues.push(`it is ${candidate.length} characters, under the ${MIN_CHARS} minimum, expand the news paragraphs to land between ${MIN_CHARS} and ${MAX_CHARS}`);
      if (candidate.length > MAX_CHARS) issues.push(`it is ${candidate.length} characters, over the ${MAX_CHARS} maximum, tighten to between ${MIN_CHARS} and ${MAX_CHARS}`);
      if (!okParas) issues.push(`it has ${countParagraphs(candidate)} paragraphs, rewrite as EXACTLY ${TARGET_PARAGRAPHS} paragraphs separated by single blank lines`);
      if (issues.length === 0) issues.push('output did not pass validation, regenerate');

      messages.push({ role: 'assistant', content: candidate });
      messages.push({
        role: 'user',
        content:
          `That draft has problems: ${issues.join('; ')}. Keep the first two sentences about the video, ` +
          'keep everything after them on the news, and use NO em dashes. Return ONLY the caption.',
      });
    }

    if (!best) return NextResponse.json({ error: 'empty response' }, { status: 502 });
    // `topic` is returned for visibility/debugging; the client only needs caption.
    return NextResponse.json({ caption: best, topic: chosen.topic });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
