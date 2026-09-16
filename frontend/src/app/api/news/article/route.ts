// News article: read and verify a story from the outlet's own page (a Google
// News link is resolved first; search results already carry the outlet URL),
// and collect the outlet's latest real headlines for the page's side column.
//   POST /api/news/article  { link }  →  { article, rail }
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { latestFromOutlet, resolveGoogleNewsLink } from '@/lib/news/google-news';
import { ArticleError, readNewsArticle } from '@/lib/news/read-article';
import type { OutletId, RailItem } from '@/lib/news/types';

export const runtime = 'nodejs';

/** Outlets whose page layout has a column of other stories. */
const HAS_RAIL: OutletId[] = ['espn', 'cnn', 'fox', 'tmz'];

export async function POST(req: NextRequest) {
  const parsed = z.object({ link: z.string().url() }).safeParse(await req.json().catch(() => ({})));
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
    if (HAS_RAIL.includes(article.outlet)) {
      rail = await latestFromOutlet(article.outlet, article.headline).catch(() => []);
      if (rail.length === 0) article.notes.push("Couldn't load the outlet's other headlines, so the side column is empty.");
    }
    return NextResponse.json({ article, rail });
  } catch (err) {
    const status = err instanceof ArticleError ? 422 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), url }, { status });
  }
}
