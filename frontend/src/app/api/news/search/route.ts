// News search: article pages about a name from the approved outlets only.
//   GET /api/news/search?q=Macklemore&outlets=espn,cnn&range=30d
//
// Google News lists every outlet but IMDb, which it barely carries; IMDb's own
// lists are searched alongside it (lib/news/imdb.ts) and the two are merged the
// same way: headlines that name what was searched first, then newest first.
//
// Both go by the short forms the press uses for the name as well as the whole
// of it — "Putin" for Vladimir Putin — worked out once per name by
// lib/news/name-forms, and handed back as `forms` so the page can say what was
// searched. Google's whole-name feed doesn't wait for them.
import { NextRequest, NextResponse } from 'next/server';
import { searchApprovedNews, type NewsRange } from '@/lib/news/google-news';
import { searchImdbNews } from '@/lib/news/imdb';
import { nameForms } from '@/lib/news/name-forms';
import { OUTLET_IDS, isOutletId } from '@/lib/news/outlets';
import type { NewsHit } from '@/lib/news/types';

export const runtime = 'nodejs';

const RANGES: NewsRange[] = ['1d', '7d', '30d', 'any'];

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ error: 'Type a name to search for.' }, { status: 400 });
  const outlets = (req.nextUrl.searchParams.get('outlets') ?? '').split(',').filter(isOutletId);
  const rangeParam = req.nextUrl.searchParams.get('range') as NewsRange | null;
  const range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : '30d';
  const wanted = outlets.length ? outlets : OUTLET_IDS;
  const fromGoogle = wanted.filter(id => id !== 'imdb');
  const formsP = nameForms(q);
  try {
    const [google, imdb, forms] = await Promise.all([
      fromGoogle.length ? searchApprovedNews(q, fromGoogle, range, formsP) : Promise.resolve([] as NewsHit[]),
      wanted.includes('imdb')
        ? formsP.then(f => searchImdbNews(q, range, f)).catch(() => [] as NewsHit[])
        : Promise.resolve([] as NewsHit[]),
      formsP,
    ]);
    const hits = [...google, ...imdb];
    const ts = (h: NewsHit) => (h.publishedAt ? Date.parse(h.publishedAt) : 0);
    hits.sort((a, b) => Number(b.named) - Number(a.named) || ts(b) - ts(a));
    return NextResponse.json({ hits, forms });
  } catch (err) {
    return NextResponse.json({ error: `Search failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
