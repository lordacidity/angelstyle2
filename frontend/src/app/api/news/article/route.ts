// News article: read and verify a story from the outlet's own page (a Google
// News link is resolved first; search results already carry the outlet URL),
// and collect the outlet's latest real headlines for the page's side column.
//   POST /api/news/article  { link, name? }  →  { article, rail, people, highlight }
//
// The link can be a search result's or one pasted in by hand — any article
// page on an approved outlet. Nobody searched for a pasted one, so the story
// is read for whoever on Pauv it names (lib/news/roster-match): `people`, the
// ones in the headline first, then by how often the story says them.
//
// `name` is who the page is for, when that is known: `highlight` is the form
// of their name the page prints — the whole name, or the short form the press
// uses for them ("Kennedy" for RFK Jr.) — and whether it is in the headline
// or the story (lib/news/highlight). What the recording drags over.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { latestFromOutlet, resolveGoogleNewsLink } from '@/lib/news/google-news';
import { highlightFor } from '@/lib/news/highlight';
import { imdbIdOf, imdbRail } from '@/lib/news/imdb';
import { ArticleError, readNewsArticle } from '@/lib/news/read-article';
import { isOrdinaryName } from '@/lib/news/roster-match';
import { asNamed, rosterReader } from '@/lib/news/trending';
import type { NewsArticle, OutletId, RailItem, StoryPerson } from '@/lib/news/types';

export const runtime = 'nodejs';

/** Outlets whose page layout has a column of other stories. */
const HAS_RAIL: OutletId[] = ['espn', 'cnn', 'fox', 'tmz', 'people'];

/** Everyone on Pauv the story names. One-word names that are also ordinary
 *  words are left out — "Rose" five times in a story is not Rosé, and nothing
 *  here can tell (the trending list has the AI for that). A roster that won't
 *  load costs the names, not the story. */
async function peopleIn(article: NewsArticle): Promise<StoryPerson[]> {
  try {
    const read = await rosterReader();
    const inHeadline = new Set(read(article.headline).map(f => f.person.ticker));
    const body = [article.headline, article.dek ?? '', ...article.keyPoints, ...article.body.map(b => b.text)].join('\n');
    return read(body)
      .filter(f => !isOrdinaryName(f.person.name))
      .map(f => ({ ...asNamed(f.person), inHeadline: inHeadline.has(f.person.ticker), mentions: f.count }))
      .sort((a, b) => Number(b.inHeadline) - Number(a.inHeadline) || b.mentions - a.mentions);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const parsed = z.object({ link: z.string().url(), name: z.string().trim().max(80).optional() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'A result link is required.' }, { status: 400 });

  let url: string;
  try {
    url = await resolveGoogleNewsLink(parsed.data.link);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  try {
    const article = await readNewsArticle(url);
    let rail: RailItem[] = [];
    // IMDb's lists come from IMDb itself, under the names its pages give them;
    // everyone else's latest headlines come from Google News.
    if (article.outlet === 'imdb') {
      rail = await imdbRail(imdbIdOf(new URL(article.url)) ?? '').catch(() => []);
    } else if (HAS_RAIL.includes(article.outlet)) {
      rail = await latestFromOutlet(article.outlet, article.headline).catch(() => []);
    }
    if (rail.length === 0 && (article.outlet === 'imdb' || HAS_RAIL.includes(article.outlet))) {
      article.notes.push("Couldn't load the outlet's other headlines, so the side column is empty.");
    }
    const [people, highlight] = await Promise.all([peopleIn(article), highlightFor(article, parsed.data.name).catch(() => null)]);
    return NextResponse.json({ article, rail, people, highlight });
  } catch (err) {
    const status = err instanceof ArticleError ? 422 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), url }, { status });
  }
}
