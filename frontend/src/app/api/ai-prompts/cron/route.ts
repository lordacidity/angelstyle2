// Daily cron — regenerates the "recent breaking news" overview for every AI
// Prompt slot that has a topic set, so when teammates open the app each
// morning the captions are pulling from a brief that's at most ~24h old.
//
// Vercel cron hits this GET endpoint on the schedule in vercel.json. The body
// of the work mirrors /api/ai-prompts/[id]/generate one prompt at a time —
// SerpAPI fresh-headlines for the topic, DeepSeek writes 3 sentences about the
// single biggest breaking story centred on one specific athlete/artist, save
// to Railway. Failures on individual prompts are collected and surfaced; one
// bad topic does not abort the batch.
//
// AUTH:
// In production the request must carry "Authorization: Bearer $CRON_SECRET".
// Vercel automatically includes this header on cron invocations as long as
// the CRON_SECRET env var is set on the project — see
// vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs. When the env
// var is unset (e.g. local dev) the guard is skipped so the route can be hit
// from a browser for testing.

import { NextRequest, NextResponse } from 'next/server';
import { deepseekChat } from '@/lib/deepseek';
import { listPrompts, saveOverview, type AiPromptRow } from '@/lib/ai-prompts-db';

export const runtime = 'nodejs';
// Headroom for ~30 prompts * ~6s/prompt (SerpAPI + DeepSeek). Vercel Pro
// allows up to 900s; Hobby caps at 300. We sit at 300 to work on either.
export const maxDuration = 300;

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

// Identical query shape to ai-prompts/[id]/generate so the cron-refreshed
// overview matches what a manual "Go" would produce.
async function fetchTrendingHeadlines(topic: string): Promise<Headline[]> {
  const key = process.env.SERPAPI_KEY ?? '';
  if (!key) throw new Error('SERPAPI_KEY not set');

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('tbm', 'nws');
  url.searchParams.set('q', topic);
  url.searchParams.set('gl', 'us');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('tbs', 'qdr:w,sbd:1');
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

function cleanOverview(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\*/g, '')
    .replace(/\s*—\s*/g, ', ')
    .replace(/, ,/g, ',')
    .trim();
}

interface PromptResult { id: string; topic: string; ok: boolean; error?: string }

async function regenerateOne(p: AiPromptRow): Promise<PromptResult> {
  const topic = p.topic.trim();
  if (!topic) return { id: p.id, topic, ok: false, error: 'empty topic' };
  try {
    const headlines = await fetchTrendingHeadlines(topic);
    if (headlines.length === 0) return { id: p.id, topic, ok: false, error: 'no headlines' };

    const headlinesText = headlines
      .map((h, i) => {
        const meta = [h.source, h.date].filter(Boolean).join(', ');
        return `${i + 1}. ${h.title}${meta ? ` (${meta})` : ''}${h.snippet ? ` - ${h.snippet}` : ''}`;
      })
      .join('\n');

    const person = p.category === 'artist' ? 'artist' : 'athlete';
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

    const overview = cleanOverview(raw);
    if (!overview) return { id: p.id, topic, ok: false, error: 'empty overview from model' };

    const saved = await saveOverview(p.id, overview);
    return saved ? { id: p.id, topic, ok: true } : { id: p.id, topic, ok: false, error: 'save failed' };
  } catch (e) {
    return { id: p.id, topic, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  // Vercel sends this header automatically when CRON_SECRET is set. The check
  // is skipped when the env var is absent so the route stays hittable from a
  // local dev environment (or by a teammate kicking off a manual refresh).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  let prompts: AiPromptRow[] = [];
  try {
    prompts = await listPrompts();
  } catch (e) {
    return NextResponse.json({ error: 'listPrompts failed', detail: String(e) }, { status: 500 });
  }

  const eligible = prompts.filter((p) => p.topic.trim().length > 0);
  // Serial — SerpAPI + DeepSeek are per-call rate-limited and a 30-prompt
  // parallel fan-out has bitten us before. ~6s per prompt sits comfortably
  // under the 300s maxDuration even at ~50 prompts.
  const results: PromptResult[] = [];
  for (const p of eligible) {
    results.push(await regenerateOne(p));
  }

  const succeeded = results.filter((r) => r.ok).length;
  return NextResponse.json({
    total: eligible.length,
    succeeded,
    failed: eligible.length - succeeded,
    results,
    ranAt: new Date().toISOString(),
  });
}
