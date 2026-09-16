// Reads a real article from an approved outlet: the headline as printed, the
// byline, the publish (and update) time and the article text, word for
// word. Each outlet is read from the most reliable public source it offers:
//
//   CNN, Fox, TMZ, BBC  the article page itself (its JSON-LD plus the page's
//                       own headline and paragraph markup)
//   ESPN                ESPN's public content API (the page blocks scripted
//                       visitors; the API serves the same story)
//   NYT                 the Times' public oEmbed feed (the page blocks scripted
//                       visitors; the feed gives headline, summary, byline and
//                       date, but no article text)
//   The Athletic        the Athletic's public API, rendered as a Times page
//                       (headline, summary, authors and time; no article text)
//
// A story without a headline, a byline or a date is refused: the page would
// otherwise need something made up to fill the gap.

import {
  articleLd, BROWSER_HEADERS, elementText, fetchText, firstH1, isShouting, ldAuthors, ldString, textOf, decodeEntities,
} from './html';
import { articleUrlProblem, athleticId, outletForHost, outletById } from './outlets';
import type { NewsArticle, OutletId } from './types';

// As much of the article as the outlet gives, up to a length the PNG can hold.
const MAX_PARAGRAPHS = 60;

export class ArticleError extends Error {}

function cleanUrl(u: URL): string {
  return `${u.origin}${u.pathname}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const SECTION_NAMES: Record<string, string> = {
  us: 'U.S.', uk: 'UK', nyregion: 'New York', politics: 'Politics', world: 'World', business: 'Business',
  entertainment: 'Entertainment', sport: 'Sport', sports: 'Sports', arts: 'Arts', style: 'Style', health: 'Health',
  tech: 'Tech', technology: 'Technology', science: 'Science', travel: 'Travel', media: 'Media', opinion: 'Opinion',
  opinions: 'Opinion', lifestyle: 'Lifestyle', climate: 'Climate', weather: 'Weather', food: 'Food', books: 'Books',
  movies: 'Movies', television: 'Television', theater: 'Theater', music: 'Music', well: 'Well', realestate: 'Real Estate',
  magazine: 'Magazine', upshot: 'The Upshot', economy: 'Economy', markets: 'Markets', crime: 'Crime',
};
function sectionName(slug: string | undefined): string | null {
  if (!slug) return null;
  return SECTION_NAMES[slug] ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function isoOrNull(v: unknown): string | null {
  const s = ldString(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Promotions the outlets drop between paragraphs ("Get our flagship newsletter
// with all the headlines you need to start the day. Sign up here.").
const PROMO = /\b(sign up here|sign up for|subscribe (to|now|here)|newsletter|download the .{0,30}app|click here|follow us on|on bbc sounds|on bbc iplayer)\b/i;

function articleText(paragraphs: string[]): string[] {
  return paragraphs
    .map(p => p.replace(/[ \s]+/g, ' ').trim())
    .filter(p => p.length > 1 && !isShouting(p) && !(p.length < 240 && PROMO.test(p)))
    .slice(0, MAX_PARAGRAPHS);
}

async function pageHtml(url: string, outlet: OutletId): Promise<string> {
  let res;
  try {
    res = await fetchText(url);
  } catch (err) {
    throw new ArticleError(`Couldn't reach ${outletById(outlet).name}: ${String(err instanceof Error ? err.message : err)}`);
  }
  if (res.status !== 200) {
    throw new ArticleError(`${outletById(outlet).name} wouldn't serve that page (${res.status}). Try another story.`);
  }
  return res.text;
}

function requireVerified(a: NewsArticle): NewsArticle {
  const name = outletById(a.outlet).name;
  if (!a.headline) throw new ArticleError(`Couldn't read the headline from ${name}, so this story can't be used.`);
  if (a.authors.length === 0 && !a.byline) throw new ArticleError(`${name} doesn't credit an author on this story, so it can't be used.`);
  if (!a.publishedAt && !a.publishedDate) throw new ArticleError(`Couldn't read the publish date from ${name}, so this story can't be used.`);
  return a;
}

// ── ESPN ────────────────────────────────────────────────────────────────────

async function readEspn(u: URL): Promise<NewsArticle> {
  const id = u.pathname.match(/\/id\/(\d+)/)?.[1];
  if (!id) throw new ArticleError('That ESPN link has no story id.');
  let json: { headlines?: Record<string, unknown>[] };
  try {
    const res = await fetchText(`https://content.core.api.espn.com/v1/sports/news/${id}`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    json = JSON.parse(res.text);
  } catch (err) {
    throw new ArticleError(`ESPN wouldn't serve that story (${err instanceof Error ? err.message : String(err)}).`);
  }
  const h = json.headlines?.[0];
  if (!h) throw new ArticleError('ESPN has no story under that id.');
  const categories = Array.isArray(h.categories) ? (h.categories as Record<string, unknown>[]) : [];
  const byType = (t: string) => categories.filter(c => c.type === t).map(c => ldString(c.description)).filter(Boolean) as string[];
  const byline = ldString(h.byline) ?? '';
  const authors = byline ? byline.split(/\s*(?:,|\band\b)\s*/).filter(Boolean) : byType('contributor');
  const story = ldString(h.story) ?? '';
  const paragraphs = story.split(/<\/p>|<p(?:\s[^>]*)?>|\n/i).map(textOf);
  const league = byType('league')[0] ?? ldString(h.section);
  const team = byType('team')[0] ?? null;
  return {
    outlet: 'espn',
    url: cleanUrl(u),
    headline: decodeEntities(ldString(h.headline) ?? ''),
    headlineParts: null,
    dek: null,
    authors,
    byline: byline || joinNames(authors),
    publishedAt: isoOrNull(h.published),
    publishedDate: null,
    updatedAt: isoOrNull(h.lastModified),
    section: league ?? null,
    paragraphs: articleText(paragraphs),
    live: h.isLiveBlog === true,
    notes: team ? [`Team: ${team}`] : [],
  };
}

// ── The New York Times ─────────────────────────────────────────────────────

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

async function readNyt(u: URL): Promise<NewsArticle> {
  if (athleticId(u)) return readAthletic(u, athleticId(u)!);
  const url = cleanUrl(u);
  let j: Record<string, unknown>;
  try {
    const res = await fetchText(`https://www.nytimes.com/svc/oembed/json/?url=${encodeURIComponent(url)}`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    j = JSON.parse(res.text);
  } catch (err) {
    throw new ArticleError(`The Times wouldn't describe that story (${err instanceof Error ? err.message : String(err)}).`);
  }
  const byline = ldString(j.author_name) ?? '';
  const authors = byline.replace(/^By\s+/i, '').split(/\s*(?:,|\band\b)\s*/).map(s => s.trim()).filter(Boolean);
  // "September 15, 2026" → 2026-09-15. The feed gives the day only.
  let publishedDate: string | null = null;
  const d = (ldString(j.publication_date) ?? '').match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (d) {
    const m = MONTHS.indexOf(d[1].toLowerCase());
    if (m >= 0) publishedDate = `${d[3]}-${String(m + 1).padStart(2, '0')}-${d[2].padStart(2, '0')}`;
  }
  const seg = u.pathname.split('/').filter(Boolean);
  const afterDate = /^\d{4}$/.test(seg[0] ?? '') ? seg[3] : seg[0];
  return {
    outlet: 'nyt',
    url,
    headline: decodeEntities(ldString(j.title) ?? ''),
    headlineParts: null,
    dek: ldString(j.summary) ? decodeEntities(ldString(j.summary)!) : null,
    authors,
    byline,
    publishedAt: null,
    publishedDate,
    updatedAt: null,
    section: afterDate === 'live' ? null : sectionName(afterDate),
    paragraphs: [],
    live: u.pathname.includes('/live/'),
    notes: ["The Times doesn't let its article text be read, so the page shows the headline, summary and byline only."],
  };
}

// The Athletic's pages block scripted visitors and the Times' feed leaves its
// bylines blank, so Athletic stories are read from the Athletic's own public
// API (the one its app uses): headline, summary, authors and publish time.
// No article text, same as the Times.
async function readAthletic(u: URL, id: string): Promise<NewsArticle> {
  let a: Record<string, unknown> | null;
  try {
    const res = await fetch('https://api.theathletic.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_HEADERS['User-Agent'] },
      body: JSON.stringify({
        // id is digits only (athleticId)
        query: `{ articleById(id: "${id}") { id title excerpt_plaintext published_at primary_tag permalink authors { author { name } } } }`,
      }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    a = ((await res.json()) as { data?: { articleById?: Record<string, unknown> | null } }).data?.articleById ?? null;
  } catch (err) {
    throw new ArticleError(`The Athletic wouldn't describe that story (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!a || String(a.id) !== id) throw new ArticleError('The Athletic has no story under that id.');
  const authors = (Array.isArray(a.authors) ? a.authors : [])
    .map(x => ldString((x as { author?: { name?: unknown } })?.author?.name))
    .filter(Boolean) as string[];
  const ms = typeof a.published_at === 'number' ? a.published_at : NaN;
  const league = ldString(a.primary_tag);
  return {
    outlet: 'nyt',
    url: ldString(a.permalink) ?? cleanUrl(u),
    headline: decodeEntities(ldString(a.title) ?? ''),
    headlineParts: null,
    dek: ldString(a.excerpt_plaintext) ? decodeEntities(ldString(a.excerpt_plaintext)!) : null,
    authors,
    byline: joinNames(authors),
    publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    publishedDate: null,
    updatedAt: null,
    section: 'The Athletic',
    paragraphs: [],
    live: false,
    notes: [
      `A story from The Athletic${league ? ` (${league})` : ''}, shown on The Times' page.`,
      "The Athletic doesn't let its article text be read, so the page shows the headline, summary and byline only.",
    ],
  };
}

// ── CNN ────────────────────────────────────────────────────────────────────

async function readCnn(u: URL): Promise<NewsArticle> {
  const html = await pageHtml(u.toString(), 'cnn');
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const paragraphs = [...html.matchAll(/<p[^>]*data-component-name="paragraph"[^>]*>([\s\S]*?)<\/p>/gi)].map(m => textOf(m[1]));
  const section = u.pathname.match(/^\/\d{4}\/\d{2}\/\d{2}\/([a-z-]+)\//)?.[1];
  return {
    outlet: 'cnn',
    url: cleanUrl(u),
    headline: elementText(html, 'h1', 'headline__text') ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ''),
    headlineParts: null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: sectionName(section),
    paragraphs: articleText(paragraphs),
    live: u.pathname.includes('/live-news/'),
    notes: [],
  };
}

// ── Fox News ───────────────────────────────────────────────────────────────

async function readFox(u: URL): Promise<NewsArticle> {
  const html = await pageHtml(u.toString(), 'fox');
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const bodyAt = html.search(/class="article-body"/);
  const body = bodyAt >= 0 ? html.slice(bodyAt, bodyAt + 200_000) : '';
  // Article paragraphs carry data-layout-index; video captions and promos in
  // the same container don't.
  const paragraphs = [...body.matchAll(/<p\s[^>]*data-layout-index[^>]*>([\s\S]*?)<\/p>/gi)]
    .filter(m => !/^\s*<(strong|b)>\s*<a /i.test(m[1]))
    .map(m => textOf(m[1]));
  return {
    outlet: 'fox',
    url: cleanUrl(u),
    headline: elementText(html, 'h1', 'headline') ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ''),
    headlineParts: null,
    dek: elementText(html, 'h2', 'sub-headline'),
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: sectionName(u.pathname.split('/').filter(Boolean)[0]),
    paragraphs: articleText(paragraphs),
    live: false,
    notes: [],
  };
}

// ── TMZ ────────────────────────────────────────────────────────────────────

function tmzFragment(html: string, n: number): string | null {
  const m = html.match(new RegExp(`<(\\w+)[^>]*class="article__header--hf${n}[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, 'i'));
  const t = m ? textOf(m[2]) : '';
  return t || null;
}

async function readTmz(u: URL): Promise<NewsArticle> {
  const html = await pageHtml(u.toString(), 'tmz');
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const headline = elementText(html, 'h1', 'article__header--headline-title') ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? '');
  const kicker = tmzFragment(html, 1);
  const main = tmzFragment(html, 2);
  const sub = tmzFragment(html, 3);
  const bodyText = decodeEntities(ldString(ld.articleBody) ?? '');
  return {
    outlet: 'tmz',
    url: cleanUrl(u),
    headline,
    headlineParts: main ? { kicker, main, sub } : null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: null,
    paragraphs: articleText(bodyText.split(/\n\s*\n/)),
    live: false,
    notes: [],
  };
}

// ── BBC ────────────────────────────────────────────────────────────────────

async function readBbc(u: URL): Promise<NewsArticle> {
  const html = await pageHtml(u.toString(), 'bbc');
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const paragraphs = [...html.matchAll(/data-component="text-block"[^>]*>([\s\S]*?)<\/div>/gi)].map(m => textOf(m[1]));
  return {
    outlet: 'bbc',
    url: cleanUrl(u),
    // The page's own headline; BBC's JSON-LD often carries a different, search-engine one.
    headline: firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ''),
    headlineParts: null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: null,
    paragraphs: articleText(paragraphs),
    live: false,
    notes: [],
  };
}

/** Read and verify a story from an approved outlet. Throws ArticleError with a
 *  message fit to show when the story can't be used. */
export async function readNewsArticle(rawUrl: string): Promise<NewsArticle> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new ArticleError('That is not a valid link.'); }
  const outlet = outletForHost(u.hostname);
  if (!outlet) throw new ArticleError(`${u.hostname} is not one of the approved outlets.`);
  const problem = articleUrlProblem(outlet, u);
  if (problem) throw new ArticleError(problem);

  const readers: Record<OutletId, (u: URL) => Promise<NewsArticle>> = {
    espn: readEspn, nyt: readNyt, cnn: readCnn, fox: readFox, tmz: readTmz, bbc: readBbc,
  };
  const article = await readers[outlet](u);
  if (article.outlet !== 'nyt' && article.paragraphs.length === 0) {
    article.notes.push(`Couldn't read the article text from ${outletById(outlet).name}; the page shows no paragraphs.`);
  }
  return requireVerified(article);
}
