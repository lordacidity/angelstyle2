// Recent headlines about Pauv-listed people, for the Carousel "From an article"
// flow — so you can pick a story instead of hunting for a URL.
//
// One newsdata.io call: we OR together as many roster names as fit the query
// budget (optionally biased to the brand's category), then match each returned
// article back to the person it names. No per-person AI cost — matching is plain
// string comparison — so this stays cheap and fast.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { searchGoogleNews } from '@/lib/google-news';

export const runtime = 'nodejs';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// Google News RSS is free, unauthenticated and has no meaningful query-length cap
// (unlike newsdata.io, whose plan rejects any `q` over 100 chars) — so we OR a big
// batch of roster names per request and run several batches in parallel to cover
// as much of the roster as possible.
const NAME_BATCH = 40;
const MAX_BATCHES = 3;
// Only surface genuinely recent stories.
const TIMEFRAME_HOURS = 72;
// Keep the list varied — no single person should dominate the feed.
const PER_PERSON_CAP = 2;
const MAX_ITEMS = 10;

// Loose category bias: prefer roster people whose industry reads like the brand's
// vertical, so an athletes brand sees athlete stories first. Never exclusive —
// we top the list back up with everyone else if there's query budget left.
const CATEGORY_HINTS: Record<string, string[]> = {
  athletes: ['sport', 'football', 'soccer', 'basketball', 'nfl', 'nba', 'mma', 'ufc', 'boxing', 'baseball', 'tennis', 'golf', 'hockey', 'athlet'],
  artists:  ['music', 'rap', 'hip hop', 'pop', 'artist', 'singer', 'r&b', 'rock', 'dj', 'producer', 'actor', 'film'],
  gamers:   ['gam', 'esport', 'stream', 'twitch', 'youtube', 'content'],
};

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({ category: z.enum(['artists', 'athletes', 'gamers']).optional() });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    const category = parsed.success ? parsed.data.category : undefined;

    const { data: profiles, error } = await sb
      .from('profiles')
      .select('id,ticker,name,industry,info_subcategory,photo_url,delisted_at')
      .is('delisted_at', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const roster = (profiles ?? []) as Array<{
      id: string; ticker: string; name: string;
      industry: string | null; info_subcategory: string | null; photo_url: string | null;
    }>;
    if (roster.length === 0) return NextResponse.json({ items: [] });

    // Order the roster so category-matching people get first crack at the budget.
    const hints = category ? (CATEGORY_HINTS[category] ?? []) : [];
    const scored = roster.map(p => {
      const bag = `${p.industry ?? ''} ${p.info_subcategory ?? ''}`.toLowerCase();
      return { p, onVertical: hints.some(h => bag.includes(h)) };
    });
    const ordered = [...scored.filter(s => s.onVertical), ...scored.filter(s => !s.onVertical)].map(s => s.p);

    // Cover as much of the roster as possible: OR names in batches and fire the
    // batches in parallel (a failed batch just contributes nothing).
    const named = ordered.filter(p => (p.name ?? '').trim().length >= 3);
    if (named.length === 0) return NextResponse.json({ items: [] });
    const batches: (typeof named)[] = [];
    for (let i = 0; i < named.length && batches.length < MAX_BATCHES; i += NAME_BATCH) {
      batches.push(named.slice(i, i + NAME_BATCH));
    }
    const chosen = batches.flat();

    const settled = await Promise.allSettled(
      batches.map(b => searchGoogleNews({
        q: b.map(p => `"${p.name.trim()}"`).join(' OR '),
        timeframeHours: TIMEFRAME_HOURS,
      })),
    );
    const articles = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (articles.length === 0) return NextResponse.json({ items: [] });

    // Attach each article to the person it actually names (title first, then blurb).
    const seen = new Set<string>();
    const matched = articles.flatMap(a => {
      const title = (a.title ?? '').trim();
      const link = (a.link ?? '').trim();
      if (!title || !link || seen.has(link)) return [];
      const haystack = `${title} ${a.description ?? ''}`.toLowerCase();
      const person = chosen.find(p => haystack.includes(p.name.toLowerCase()));
      if (!person) return [];
      seen.add(link);
      return [{
        title,
        url: link,
        sourceName: a.source_id ?? 'news',
        publishedAt: a.pubDate,
        imageUrl: null as string | null,
        personName: person.name,
        ticker: person.ticker,
        photoUrl: person.photo_url,
      }];
    });

    // Freshest first, then cap per person so the feed shows a spread of names.
    const ts = (v: string | null) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };
    matched.sort((a, b) => ts(b.publishedAt) - ts(a.publishedAt));
    const perPerson = new Map<string, number>();
    const items = matched.filter(it => {
      const n = perPerson.get(it.ticker) ?? 0;
      if (n >= PER_PERSON_CAP) return false;
      perPerson.set(it.ticker, n + 1);
      return true;
    }).slice(0, MAX_ITEMS);

    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
