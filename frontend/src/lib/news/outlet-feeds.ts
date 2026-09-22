// The outlets' own lists of what they have just published — read straight
// from each outlet, for the trending list (lib/news/trending).
//
// Google News (lib/news/google-news) hands over at most a hundred headlines
// per query and wraps every link in one that has to be decoded; the outlets
// themselves list far more, with their own URLs, and cost one request each:
//
//   ESPN      its site API, a list per league (the RSS feeds answer a
//             challenge page to anything scripted), plus the all-sports list
//   CNN       the Google News sitemap (its RSS feeds stopped in 2024)
//   Fox       the Google News sitemap, and the section RSS feeds
//   TMZ       the Google News sitemap, and the RSS feed
//   NYT       the section RSS feeds, the Athletic's feed, and the Google
//             News sitemap
//   BBC       the RSS feeds, news sections and sport sections both
//   People    the Google News sitemap (people.com refuses fetch() for the
//             story pages, but not for this)
//   IMDb      its own lists, read by lib/news/imdb; not here
//
// Every item is a real headline the outlet lists, with the outlet's own URL
// and the outlet's own timestamp; anything without both is dropped. Video,
// audio and live pages are left out the way search leaves them out. The lists
// are read together and kept for a few minutes, so a refresh is cheap.

import { gunzipSync } from 'node:zlib';
import { BROWSER_HEADERS, decodeEntities } from './html';
import { articleUrlProblem, outletForHost } from './outlets';
import type { OutletId } from './types';

export interface OutletHeadline {
  outlet: OutletId;
  title: string;
  /** The outlet's own URL for the story, tracking parameters removed. */
  url: string;
  publishedAt: string;
}

type Source = { outlet: OutletId; kind: 'rss' | 'sitemap' | 'espn'; url: string };

const ESPN_LEAGUES = [
  'football/nfl', 'basketball/nba', 'baseball/mlb', 'hockey/nhl', 'soccer/eng.1', 'soccer/usa.1', 'mma/ufc',
  'golf/pga', 'tennis/atp', 'tennis/wta', 'basketball/wnba', 'football/college-football', 'basketball/mens-college-basketball',
  'racing/f1',
];
const FOX_SECTIONS = ['latest', 'politics', 'entertainment', 'sports', 'us', 'world', 'media', 'health', 'lifestyle', 'opinion', 'tech', 'science'];
const NYT_SECTIONS = [
  'HomePage', 'World', 'US', 'Politics', 'Business', 'Technology', 'Sports', 'Arts', 'Movies', 'Television', 'Music',
  'FashionandStyle', 'Health', 'Science', 'Books', 'NYRegion', 'MostShared', 'MostViewed',
];
const BBC_NEWS = ['', 'world', 'uk', 'business', 'politics', 'health', 'science_and_environment', 'technology', 'entertainment_and_arts', 'world/us_and_canada'];
const BBC_SPORT = [
  '', 'football', 'cricket', 'formula1', 'rugby-union', 'tennis', 'golf', 'athletics', 'cycling', 'boxing', 'american-football',
  'basketball', 'mixed-martial-arts', 'motorsport',
];

const SOURCES: Source[] = [
  ...ESPN_LEAGUES.map((l): Source => ({ outlet: 'espn', kind: 'espn', url: `https://site.api.espn.com/apis/site/v2/sports/${l}/news?limit=50` })),
  { outlet: 'espn', kind: 'espn', url: 'https://now.core.api.espn.com/v1/sports/news?limit=100' },
  { outlet: 'cnn', kind: 'sitemap', url: 'https://www.cnn.com/sitemap/news.xml' },
  { outlet: 'fox', kind: 'sitemap', url: 'https://www.foxnews.com/sitemap.xml?type=news' },
  ...FOX_SECTIONS.map((s): Source => ({ outlet: 'fox', kind: 'rss', url: `https://moxie.foxnews.com/google-publisher/${s}.xml` })),
  { outlet: 'tmz', kind: 'sitemap', url: 'https://www.tmz.com/sitemap-news.xml' },
  { outlet: 'tmz', kind: 'rss', url: 'https://www.tmz.com/rss.xml' },
  ...NYT_SECTIONS.map((s): Source => ({ outlet: 'nyt', kind: 'rss', url: `https://rss.nytimes.com/services/xml/rss/nyt/${s}.xml` })),
  { outlet: 'nyt', kind: 'rss', url: 'https://www.nytimes.com/athletic/rss/news/' },
  { outlet: 'nyt', kind: 'sitemap', url: 'https://www.nytimes.com/sitemaps/new/news.xml.gz' },
  ...BBC_NEWS.map((s): Source => ({ outlet: 'bbc', kind: 'rss', url: `https://feeds.bbci.co.uk/news/${s ? `${s}/` : ''}rss.xml` })),
  ...BBC_SPORT.map((s): Source => ({ outlet: 'bbc', kind: 'rss', url: `https://feeds.bbci.co.uk/sport/${s ? `${s}/` : ''}rss.xml` })),
  { outlet: 'people', kind: 'sitemap', url: 'https://people.com/google-news-sitemap.xml' },
];

const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(cdata(m[1])).trim() : null;
};
const iso = (s: string | null): string | null => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

async function fetchBody(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, Accept: 'application/rss+xml,application/xml,text/xml,application/json,*/*;q=0.8' },
    redirect: 'follow', signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  // A .gz sitemap comes as a gzip file, not a gzip-encoded answer.
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8');
}

/** RSS 2.0: pubDate or Dublin Core's dc:date (TMZ). */
function rssItems(xml: string): { title: string | null; link: string | null; at: string | null }[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
    title: tag(m[1], 'title'),
    link: tag(m[1], 'link'),
    at: iso(tag(m[1], 'pubDate') ?? tag(m[1], 'dc:date')),
  }));
}

/** A Google News sitemap: a <url> per story with its title and publish time. */
function sitemapItems(xml: string): { title: string | null; link: string | null; at: string | null }[] {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => ({
    title: tag(m[1], 'news:title'),
    link: tag(m[1], 'loc'),
    at: iso(tag(m[1], 'news:publication_date') ?? tag(m[1], 'lastmod')),
  }));
}

/** ESPN's lists: `articles` from the site API, `headlines` from the news
 *  API. A Media item is a video clip; everything else has a story page. */
function espnItems(json: string): { title: string | null; link: string | null; at: string | null }[] {
  let j: { articles?: Record<string, unknown>[]; headlines?: Record<string, unknown>[] };
  try { j = JSON.parse(json); } catch { return []; }
  return (j.articles ?? j.headlines ?? [])
    .filter(a => a.type !== 'Media')
    .map(a => {
      const links = a.links as { web?: { href?: string } } | undefined;
      return {
        title: typeof a.headline === 'string' ? decodeEntities(a.headline).trim() : null,
        link: links?.web?.href ?? null,
        at: iso(typeof a.published === 'string' ? a.published : null),
      };
    });
}

async function readSource(s: Source): Promise<OutletHeadline[]> {
  const text = await fetchBody(s.url);
  const items = s.kind === 'espn' ? espnItems(text) : s.kind === 'sitemap' ? sitemapItems(text) : rssItems(text);
  const out: OutletHeadline[] = [];
  for (const it of items) {
    if (!it.title || !it.link || !it.at) continue;
    let u: URL;
    try { u = new URL(it.link); } catch { continue; }
    if (outletForHost(u.hostname) !== s.outlet || articleUrlProblem(s.outlet, u)) continue;
    out.push({ outlet: s.outlet, title: it.title.replace(/\s+/g, ' '), url: `${u.origin}${u.pathname}`, publishedAt: it.at });
  }
  return out;
}

const KEEP_MS = 3 * 60_000;
let kept: { at: number; value: Promise<OutletHeadline[]> } | null = null;

/** Everything the outlets list right now, newest first, one entry per story.
 *  A list that won't answer costs its own headlines and nothing else; the
 *  answer is kept for a few minutes. */
export function outletHeadlines(): Promise<OutletHeadline[]> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.value;
  const value = (async () => {
    const lists = await Promise.all(SOURCES.map(s => readSource(s).catch((err: unknown) => {
      console.warn('[news] outlet list skipped —', s.url, err instanceof Error ? err.message : err);
      return [] as OutletHeadline[];
    })));
    const seen = new Set<string>();
    const out: OutletHeadline[] = [];
    for (const it of lists.flat()) {
      const key = `${it.outlet}|${new URL(it.url).pathname.toLowerCase().replace(/\/$/, '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  })();
  kept = { at: Date.now(), value };
  value.catch(() => { kept = null; });
  return value;
}
