import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { deepseekChat, parseJson, type ChatMessage } from '@/lib/deepseek';
import { searchTweets, type Tweet } from '@/lib/twitter';
import { searchGoogleNews, type GNewsArticle } from '@/lib/google-news';
import { getHandlesByIndustry } from '@/lib/news-sources';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// ---- newsdata.io ----

interface NewsdataArticle {
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  source_id: string | null;
  image_url: string | null;
}

async function fetchNewsdata(q: string): Promise<NewsdataArticle[]> {
  const key = process.env.NEWSDATA_API_KEY ?? '';
  if (!key) return [];
  const url = new URL('https://newsdata.io/api/1/latest');
  url.searchParams.set('apikey', key);
  url.searchParams.set('language', 'en');
  url.searchParams.set('size', '10');
  url.searchParams.set('q', q);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const json = await res.json() as { status: string; results?: NewsdataArticle[] };
  return json.status === 'success' ? (json.results ?? []) : [];
}

// ---- query builders ----

function yesterdayISODate(): string {
  return new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
}

function buildPersonAboutQuery(
  handles: string[],
  personName: string,
  maxLen = 480,
): { query: string; used: number } {
  const namePart = ` "${personName}"`;
  const suffix = ` -filter:replies -filter:retweets since:${yesterdayISODate()}`;
  const headroom = maxLen - suffix.length - namePart.length - 2;
  const kept: string[] = [];
  let used = 0;
  for (const h of handles) {
    const piece = `from:${h}`;
    const cost = piece.length + (kept.length > 0 ? 4 : 0);
    if (used + cost > headroom) break;
    kept.push(piece);
    used += cost;
  }
  return { query: `(${kept.join(' OR ')})${namePart}${suffix}`, used: kept.length };
}

// ---- raw item shape (pre-DeepSeek) ----

interface RawItem {
  type: 'tweet' | 'article';
  url: string;
  rawText: string;
  description: string | null;
  sourceName: string;
  publishedAt: string | null;
  imageUrl: string | null;
  likeCount?: number;
  tweetAuthorName?: string;
  tweetAuthorHandle?: string;
}

function tweetToRaw(t: Tweet): RawItem {
  return {
    type: 'tweet',
    url: t.url,
    rawText: t.text,
    description: null,
    sourceName: `@${t.author.userName} on X`,
    publishedAt: t.createdAt || null,
    imageUrl: null,
    likeCount: t.likeCount,
    tweetAuthorName: t.author.name,
    tweetAuthorHandle: t.author.userName,
  };
}

function newsdataToRaw(a: NewsdataArticle): RawItem {
  return {
    type: 'article',
    url: a.link,
    rawText: a.title,
    description: a.description,
    sourceName: a.source_id ?? 'news',
    publishedAt: a.pubDate,
    imageUrl: a.image_url,
  };
}

function gnewsToRaw(a: GNewsArticle): RawItem {
  return {
    type: 'article',
    url: a.link,
    rawText: a.title,
    description: a.description,
    sourceName: a.source_id ?? 'news',
    publishedAt: a.pubDate,
    imageUrl: null,
  };
}

function normalizeTitle(t: string): string {
  return t.toLowerCase()
    .replace(/\s+-\s+[^-]+$/, '')  // strip " - Source Name" suffix Google News appends
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- main handler ----

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({ ticker: z.string().min(1), exclude: z.array(z.string()).default([]) });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'ticker required' }, { status: 400 });
    const { ticker, exclude } = parsed.data;

    // Resolve talent from Supabase.
    const { data: profile, error: profileErr } = await sb
      .from('profiles')
      .select('id,ticker,name,industry,info_subcategory')
      .eq('ticker', ticker)
      .is('delisted_at', null)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: `Ticker ${ticker} not found` }, { status: 404 });
    }

    const personName = (profile as { name: string }).name;
    const industry = (profile as { industry: string | null }).industry ?? '';

    // Get curator handles for this talent's industry (soft-fail).
    let curatorHandles: string[] = [];
    let curatorsError: string | undefined;
    try {
      if (industry) curatorHandles = await getHandlesByIndustry(industry);
    } catch (err) {
      curatorsError = String(err);
    }

    const curator = buildPersonAboutQuery(curatorHandles, personName);

    // Fire Twitter, Newsdata, and Google News in parallel — but cap each source so
    // one slow provider (the X/Twitter API is the usual laggard, 20-30s) can't hold
    // up the whole lookup. A source that overruns is treated as an empty/failed
    // result and we proceed with whatever the others returned.
    const SOURCE_TIMEOUT_MS = 8000;
    const withTimeout = <T,>(p: Promise<T>, label: string): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${SOURCE_TIMEOUT_MS}ms`)), SOURCE_TIMEOUT_MS),
        ),
      ]);
    const [tweetsResult, newsdataResult, gnewsResult] = await Promise.allSettled([
      curator.used > 0
        ? withTimeout(searchTweets({ query: curator.query, queryType: 'Latest', maxItems: 12 }), 'twitter')
        : Promise.resolve<Tweet[]>([]),
      withTimeout(fetchNewsdata(`"${personName}"`), 'newsdata'),
      withTimeout(searchGoogleNews({ q: `"${personName}"`, timeframeHours: 48 }), 'google-news'),
    ]);

    // Merge results — tweets first (freshest), then dedupe articles by title.
    const rawItems: RawItem[] = [];
    let tweetsError: string | undefined;
    let articlesError: string | undefined;

    if (tweetsResult.status === 'fulfilled') {
      rawItems.push(...tweetsResult.value.map(tweetToRaw));
    } else {
      tweetsError = String(tweetsResult.reason);
    }

    // Merge Newsdata + Google News, deduped by normalized title.
    const articleBucket: RawItem[] = [];
    if (newsdataResult.status === 'fulfilled') {
      articleBucket.push(...newsdataResult.value.map(newsdataToRaw));
    } else {
      articlesError = String(newsdataResult.reason);
    }
    if (gnewsResult.status === 'fulfilled') {
      articleBucket.push(...gnewsResult.value.map(gnewsToRaw));
    }

    const seenTitles = new Set<string>();
    for (const item of articleBucket) {
      const key = normalizeTitle(item.rawText);
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      rawItems.push(item);
    }

    const excludeSet = new Set(exclude as string[]);
    const eligible = excludeSet.size > 0
      ? rawItems.filter(r => !excludeSet.has(r.url))
      : rawItems;

    if (eligible.length === 0) {
      return NextResponse.json({
        ticker, personName, items: [], candidatesConsidered: 0,
        tweetsError, articlesError, curatorsError,
      });
    }

    // DeepSeek: confirm each item is actually about this person, caption it, rank.
    const targetCount = 10;
    const compact = eligible.map((r, i) => ({
      i,
      type: r.type,
      source: r.sourceName,
      text: r.rawText,
      description: r.description ? r.description.slice(0, 240) : null,
    }));

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          `You are a news editor curating a feed about ONE person: ${personName}. ` +
          'For each candidate item:\n\n' +
          '(a) IS IT ABOUT THEM? — Skip items where the person is just a passing mention, ' +
          'listed among many names, or if it is about a different person with a similar name.\n\n' +
          '(b) CAPTION — Rewrite as a punchy news headline under 80 chars, present tense, ' +
          'subject-verb-object, factual not opinion.\n\n' +
          '(c) NEWSWORTHY — boolean. True if a financial-news editor would price it into ' +
          'the person\'s market; false for fan takes, vague hype, or tabloid fluff.\n\n' +
          'Rank picks by news-worthiness: breaking > evergreen, substantive > opinion. ' +
          'Return STRICT JSON.',
      },
      {
        role: 'user',
        content:
          `Target person: ${personName} (ticker $${ticker})\n\n` +
          `Candidate items:\n${JSON.stringify(compact, null, 2)}\n\n` +
          `Pick up to ${targetCount} items genuinely about ${personName}, ranked best first.\n\n` +
          `Respond with: {"picks": [{"i": <index>, "caption": "<rewritten headline>", "newsworthy": <true|false>}]}`,
      },
    ];

    type Pick = { i: number; caption: string; newsworthy?: boolean };
    let picks: Pick[] = [];
    try {
      // Bound the confirm/caption/rank call: the v4 reasoning model can spend
      // 40s+ over a big candidate list. Cap the wait and fall back to raw headlines
      // so the feed never hangs on it.
      const DEEPSEEK_TIMEOUT_MS = 14000;
      const raw = await Promise.race([
        deepseekChat(messages, { json: true, temperature: 0.2 }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`deepseek confirm timed out after ${DEEPSEEK_TIMEOUT_MS}ms`)), DEEPSEEK_TIMEOUT_MS),
        ),
      ]);
      picks = parseJson<{ picks: Pick[] }>(raw).picks ?? [];
    } catch {
      // Fallback: keep the first few candidates with their raw headline as caption.
      picks = eligible.slice(0, 6).map((r, i) => ({ i, caption: r.rawText.slice(0, 120), newsworthy: true }));
    }

    const items = picks
      .filter(p => eligible[p.i] && p.newsworthy !== false)
      .map(p => {
        const r = eligible[p.i];
        return {
          caption: p.caption,
          source: r.type as 'tweet' | 'article',
          url: r.url,
          mainPerson: personName,
          matchedTicker: ticker,
          publishedAt: r.publishedAt,
          imageUrl: r.imageUrl,
          rawText: r.rawText,
          sourceName: r.sourceName,
          likeCount: r.likeCount,
          extractPayload: r.type === 'tweet'
            ? { tweetText: r.rawText, tweetAuthorName: r.tweetAuthorName, tweetAuthorHandle: r.tweetAuthorHandle }
            : { title: r.rawText, description: r.description },
        };
      })
      .slice(0, targetCount);

    return NextResponse.json({
      ticker, personName, items,
      candidatesConsidered: eligible.length,
      curatorHandlesUsed: curator.used,
      tweetsError, articlesError, curatorsError,
    });

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
