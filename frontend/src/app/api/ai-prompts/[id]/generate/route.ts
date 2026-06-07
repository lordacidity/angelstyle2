// Generate a 3-sentence blurb on the single biggest BREAKING story about a
// specific PERSON connected to one AI-Prompt topic, then persist it to Railway.
//
// Pipeline: SerpAPI (google_news engine, sorted newest-first) pulls the freshest
// breaking headlines for the topic → DeepSeek picks the one biggest story that
// centres on a person (an athlete or artist, per the slot's category) and writes
// exactly three detailed sentences packed with interesting facts about them → we
// save that on the slot. The client passes the current topic text in the body so
// hitting Go also commits any not-yet-blurred edit (and we fall back to the
// stored topic).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat } from '@/lib/deepseek';
import { getPrompt, updatePrompt, saveOverview } from '@/lib/ai-prompts-db';

export const runtime = 'nodejs';

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

// Pull the freshest BREAKING headlines for `topic` off Google News via SerpAPI.
// We use the regular google engine in news mode (tbm=nws) because — unlike the
// google_news engine — it accepts `tbs` alongside a free-text `q`: qdr:w limits
// to the past week and sbd:1 sorts newest-first, so we get genuinely breaking
// stories rather than evergreen relevance hits. (google_news rejects `so` with
// `q`.) Some results nest the real articles under `stories` — we flatten those
// in so a clustered topic still contributes its headlines.
async function fetchTrendingHeadlines(topic: string): Promise<Headline[]> {
  const key = process.env.SERPAPI_KEY ?? '';
  if (!key) throw new Error('SERPAPI_KEY not set');

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('tbm', 'nws');
  url.searchParams.set('q', topic);
  url.searchParams.set('gl', 'us');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('tbs', 'qdr:w,sbd:1'); // past week, sorted newest / breaking first
  url.searchParams.set('api_key', key);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`serpapi ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { news_results?: SerpNewsItem[]; error?: string };
  if (json.error) throw new Error(`serpapi: ${json.error}`);

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
    .slice(0, 12);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const Schema = z.object({ topic: z.string().optional() });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

    // Prefer the topic the client just had on screen (commits a pending edit);
    // otherwise read what's stored. Either way the slot must exist.
    const existing = await getPrompt(id);
    if (!existing) return NextResponse.json({ error: 'prompt not found' }, { status: 404 });

    const bodyTopic = (parsed.data.topic ?? '').trim();
    const topic = bodyTopic || existing.topic.trim();
    if (!topic) return NextResponse.json({ error: 'add a topic first' }, { status: 400 });

    // Keep the stored topic in sync with what was used to generate.
    if (bodyTopic && bodyTopic !== existing.topic) await updatePrompt(id, { topic: bodyTopic });

    const headlines = await fetchTrendingHeadlines(topic);
    if (headlines.length === 0) {
      return NextResponse.json({ error: 'no recent news found for that topic' }, { status: 502 });
    }

    const headlinesText = headlines
      .map((h, i) => {
        const meta = [h.source, h.date].filter(Boolean).join(', ');
        return `${i + 1}. ${h.title}${meta ? ` (${meta})` : ''}${h.snippet ? ` - ${h.snippet}` : ''}`;
      })
      .join('\n');

    const person = existing.category === 'artist' ? 'artist' : 'athlete';

    const raw = await deepseekChat(
      [
        {
          role: 'system',
          content:
            `From recent breaking-news headlines about a topic, pick the SINGLE biggest story that centres on ONE specific person (an ${person} connected to the topic) — the most controversial, viral, talked-about person right now — and describe it.\n` +
            'Rules:\n' +
            '- The story MUST be about one named person, not a team, league, or event in the abstract. If several people appear, pick the single most controversial / viral one.\n' +
            '- Pick ONE story only, the most breaking and talked-about one, not a roundup.\n' +
            '- Write EXACTLY three sentences about that person and their story, in detail.\n' +
            '- Pack in specific, interesting facts: real name, what just happened, plus telling numbers, dates, teams, records, or background that make it vivid.\n' +
            '- Do not invent facts. Only use what the headlines support.\n' +
            '- Plain text only. No preamble, no labels, no bullet points, no markdown, no quotes, no emojis, no em-dashes.',
        },
        {
          role: 'user',
          content:
            `Topic: ${topic}\n\nRecent breaking headlines:\n${headlinesText}\n\n` +
            `Pick the biggest breaking story about one specific ${person} and write the 3 detailed sentences now.`,
        },
      ],
      { temperature: 0.5 },
    );

    const overview = (raw ?? '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\*/g, '')
      .replace(/\s*—\s*/g, ', ')
      .replace(/, ,/g, ',')
      .trim();
    if (!overview) return NextResponse.json({ error: 'empty overview from model' }, { status: 502 });

    const row = await saveOverview(id, overview);
    if (!row) return NextResponse.json({ error: 'prompt not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[ai-prompts generate]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
