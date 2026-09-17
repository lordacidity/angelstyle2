// IMDb for the News section: the news items IMDb lists, read from the same
// public endpoint imdb.com's own pages read them from.
//
// Why not the page: imdb.com answers a scripted visitor with an AWS challenge
// page, never the story (the way ESPN and the Times do), so the news item is
// read from api.graphql.imdb.com — the endpoint the site itself calls, serving
// exactly what the page shows: the headline, who wrote it, when, the excerpt
// IMDb runs, and the publisher it credits. Nothing here is generated: an item
// without a headline, a byline or a date is dropped.
//
// IMDb asks that its data not be put to public or commercial use (the answer
// carries that notice). This is one item at a time, to redraw the page a
// person picked, and no IMDb data is stored.

import type { NewsHit, RailItem } from './types';
import { headlineNames } from './google-news';

const ENDPOINT = 'https://api.graphql.imdb.com/';

/** The lists IMDb keeps, under the names its pages give them. */
export const IMDB_LISTS = [
  { category: 'TOP', label: 'Top news' },
  { category: 'CELEBRITY', label: 'Celebrity news' },
  { category: 'MOVIE', label: 'Movie news' },
  { category: 'TV', label: 'TV news' },
  { category: 'INDIE', label: 'Indie news' },
] as const;

export type ImdbList = (typeof IMDB_LISTS)[number]['category'];

export interface ImdbItem {
  /** "ni66018955"; the page is imdb.com/news/<id>/. */
  id: string;
  headline: string;
  byline: string;
  publishedAt: string;
  /** The article as far as IMDb runs it, paragraph by paragraph. */
  paragraphs: string[];
  /** The publisher IMDb credits the story to ("Variety", "Deadline"). */
  source: string | null;
  /** Which of IMDb's lists it was found in. */
  list: ImdbList;
  label: string;
}

const QUERY = `query($c:NewsCategory!,$n:Int!){news(category:$c,first:$n){edges{node{
  id articleTitle{plainText} byline date source{homepage{label}} text{plainText}
}}}}`;

interface Node {
  id?: string;
  articleTitle?: { plainText?: string };
  byline?: string;
  date?: string;
  source?: { homepage?: { label?: string } };
  text?: { plainText?: string };
}

/** IMDb's own lists come back in list order, newest first. Each list is asked
 *  for once and kept for a few minutes: search, the page and its rail all read
 *  the same answer. */
const cache = new Map<ImdbList, { at: number; items: ImdbItem[] }>();
const CACHE_MS = 5 * 60_000;
const PER_LIST = 60;

async function fetchList(category: ImdbList, label: string): Promise<ImdbItem[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-imdb-client-name': 'imdb-web-next' },
    body: JSON.stringify({ query: QUERY, variables: { c: category, n: PER_LIST } }),
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`IMDb answered ${res.status}`);
  const json = await res.json() as { data?: { news?: { edges?: { node?: Node }[] } }; errors?: { message?: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? 'IMDb refused the request');
  const edges = json.data?.news?.edges ?? [];
  const out: ImdbItem[] = [];
  for (const e of edges) {
    const n = e.node;
    const headline = n?.articleTitle?.plainText?.trim();
    const byline = n?.byline?.trim();
    const date = n?.date;
    if (!n?.id || !headline || !byline || !date) continue;
    const t = Date.parse(date);
    if (!Number.isFinite(t)) continue;
    out.push({
      id: n.id,
      headline,
      byline,
      publishedAt: new Date(t).toISOString(),
      paragraphs: (n.text?.plainText ?? '').split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean),
      source: n.source?.homepage?.label?.trim() || null,
      list: category,
      label,
    });
  }
  return out;
}

async function list(category: ImdbList, label: string): Promise<ImdbItem[]> {
  const hit = cache.get(category);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const items = await fetchList(category, label);
  cache.set(category, { at: Date.now(), items });
  return items;
}

/** Every item IMDb is listing right now, each kept under the list it came
 *  from (an item in two lists keeps the first). */
export async function imdbNews(): Promise<ImdbItem[]> {
  const lists = await Promise.all(IMDB_LISTS.map(l => list(l.category, l.label).catch(() => [] as ImdbItem[])));
  const seen = new Set<string>();
  const out: ImdbItem[] = [];
  for (const items of lists) {
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}

export const imdbUrl = (id: string) => `https://www.imdb.com/news/${id}/`;

/** The id in an IMDb news URL, or null. */
export function imdbIdOf(url: URL): string | null {
  return url.pathname.match(/^\/news\/(ni\d+)\/?$/)?.[1] ?? null;
}

export async function imdbItem(id: string): Promise<ImdbItem | null> {
  return (await imdbNews()).find(i => i.id === id) ?? null;
}

/** IMDb items about `query`, newest first, headlines that name it first —
 *  the order searchApprovedNews puts Google's results in. */
export async function searchImdbNews(query: string, range: '1d' | '7d' | '30d' | 'any'): Promise<NewsHit[]> {
  const days = range === '1d' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : null;
  const since = days === null ? 0 : Date.now() - days * 86_400_000;
  const words = query.trim().split(/\s+/).filter(Boolean);
  const items = await imdbNews();
  const hits: NewsHit[] = [];
  for (const it of items) {
    if (Date.parse(it.publishedAt) < since) continue;
    const named = headlineNames(it.headline, query);
    // A story counts when it names what was searched in the headline, or says
    // the whole name in the excerpt IMDb runs.
    const inText = words.length > 0 && it.paragraphs.some(p => headlineNames(p, query));
    if (!named && !inText) continue;
    hits.push({
      outlet: 'imdb',
      title: it.headline,
      publishedAt: it.publishedAt,
      link: imdbUrl(it.id),
      url: imdbUrl(it.id),
      named,
    });
  }
  return hits;
}

/** The lists IMDb shows beside a story: three for Similar News, then four each
 *  for the rail's three lists, all real items and none of them the story
 *  itself. */
export async function imdbRail(exclude: string): Promise<RailItem[]> {
  const items = await imdbNews();
  const taken = new Set<string>([exclude]);
  const pick = (want: ImdbList, n: number): ImdbItem[] => {
    const out: ImdbItem[] = [];
    for (const it of items) {
      if (out.length >= n) break;
      if (it.list !== want || taken.has(it.id)) continue;
      taken.add(it.id);
      out.push(it);
    }
    return out;
  };
  const asRail = (its: ImdbItem[], label: string): RailItem[] =>
    its.map(i => ({ title: i.headline, publishedAt: i.publishedAt, byline: i.byline, group: label }));

  return [
    ...asRail(pick('MOVIE', 3), 'Movie news'),
    ...asRail(pick('TOP', 4), 'Top news'),
    ...asRail(pick('CELEBRITY', 4), 'Celebrity news'),
    ...asRail(pick('INDIE', 4), 'Indie news'),
  ];
}
