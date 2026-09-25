// Reads a real article from an approved outlet: the headline as printed, the
// byline, the publish (and update) time and the article body, word for word —
// its paragraphs, and the subheadings, bullet points and pulled quotes the
// outlet sets between them, in the order the page prints them. Each outlet is
// read from the most reliable public source it offers:
//
//   CNN, Fox, TMZ,      the article page itself (its JSON-LD plus the page's
//   BBC, People         own headline and body markup)
//   ESPN                ESPN's public content API (the page blocks scripted
//                       visitors; the API serves the same story)
//   NYT                 the Times' public oEmbed feed (the page blocks scripted
//                       visitors; the feed gives headline, summary, byline and
//                       date, but no article text)
//   The Athletic        the Athletic's public API, rendered as a Times page
//                       (headline, summary, authors and time; no article text)
//   IMDb                the endpoint imdb.com's own pages read (the page blocks
//                       scripted visitors); see lib/news/imdb.ts
//
// A story without a headline, a byline or a date is refused: the page would
// otherwise need something made up to fill the gap.

import {
  articleLd, BROWSER_HEADERS, elementText, fetchPage, fetchText, firstH1, isShouting, ldAuthors, ldString, textOf, decodeEntities,
} from './html';
import { imdbIdOf, imdbItem, imdbUrl } from './imdb';
import { articleUrlProblem, athleticId, outletForHost, outletById } from './outlets';
import type { BodyBlock, NewsArticle, OutletId } from './types';

// As much of the article as the outlet gives, up to a length the PNG can hold.
export const MAX_BLOCKS = 80;

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

// ── The body ─────────────────────────────────────────────────────────────────

// Promotions the outlets drop between paragraphs ("Get our flagship newsletter
// with all the headlines you need to start the day. Sign up here.").
const PROMO = /\b(sign up here|sign up for|subscribe (to|now|here)|newsletter|download the .{0,30}app|click here|follow us on|on bbc sounds|on bbc iplayer)\b/i;

/** The blocks as the page gets them: each tidied, the promos and the shouted
 *  link lines out, a heading with nothing under it out, and no more than the
 *  PNG can hold. */
function articleBody(blocks: BodyBlock[]): BodyBlock[] {
  const kept: BodyBlock[] = [];
  for (const b of blocks) {
    const text = b.text.replace(/[ \s]+/g, ' ').trim();
    if (text.length <= 1) continue;
    // A subheading is allowed its capitals; a paragraph in capitals is a promo.
    if (b.kind !== 'h2' && isShouting(text)) continue;
    if (text.length < 240 && PROMO.test(text)) continue;
    kept.push({ kind: b.kind, text });
    if (kept.length >= MAX_BLOCKS) break;
  }
  while (kept.length && kept[kept.length - 1].kind === 'h2') kept.pop();
  return kept;
}

/** The paragraphs (and pulled quotes) of a body, as text. */
const paragraphsOf = (body: BodyBlock[]): string[] =>
  body.filter(b => b.kind === 'p' || b.kind === 'quote').map(b => b.text);

/** Both at once, from whatever blocks a reader found. */
function bodyOf(blocks: BodyBlock[]): Pick<NewsArticle, 'body' | 'paragraphs'> {
  const body = articleBody(blocks);
  return { body, paragraphs: paragraphsOf(body) };
}

const p = (text: string): BodyBlock => ({ kind: 'p', text });

type Pick_ = BodyBlock['kind'] | 'list' | null;

/** The body blocks in a run of HTML, in order: every paragraph, heading,
 *  list and pulled quote `kindOf` says is the article's. A list is handed
 *  back as its bullets. Anything `kindOf` leaves out — and everything inside
 *  it — is skipped, so a list of related links never leaks its items. */
function pickBlocks(html: string, kindOf: (tag: string, attrs: string, inner: string) => Pick_): BodyBlock[] {
  const out: BodyBlock[] = [];
  for (const m of html.matchAll(/<(h2|h3|blockquote|ul|ol|p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const kind = kindOf(m[1].toLowerCase(), m[2], m[3]);
    if (kind === 'list') {
      for (const li of m[3].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) out.push({ kind: 'li', text: textOf(li[1]) });
    } else if (kind) {
      out.push({ kind, text: textOf(m[3]) });
    }
  }
  return out;
}

/** What a tag is when every one of them is the article's (ESPN's story HTML). */
const plainKind = (tag: string): Pick_ =>
  tag === 'p' ? 'p' : tag === 'li' ? 'li' : tag === 'blockquote' ? 'quote' : tag === 'ul' || tag === 'ol' ? 'list' : 'h2';

async function pageHtml(url: string, outlet: OutletId): Promise<string> {
  let res;
  try {
    res = await fetchPage(url);
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
  // The story is HTML: paragraphs, subheadings, lists and quotes, with ESPN's
  // own tags for the videos and "also see" links laid between them.
  const story = (ldString(h.story) ?? '').replace(/<alsosee\b[^>]*>[\s\S]*?<\/alsosee>|<(?:alsosee|video\d*|inline\d*)\b[^>]*\/?>/gi, '');
  let blocks = pickBlocks(story, plainKind);
  // An older story is plain text, a paragraph a line.
  if (!blocks.length) blocks = story.split(/\n/).map(t => p(textOf(t)));
  const league = byType('league')[0] ?? ldString(h.section);
  const team = byType('team')[0] ?? null;
  return {
    outlet: 'espn',
    url: cleanUrl(u),
    headline: decodeEntities(ldString(h.headline) ?? ''),
    headlineParts: null,
    sourceName: null,
    dek: null,
    authors,
    byline: byline || joinNames(authors),
    publishedAt: isoOrNull(h.published),
    publishedDate: null,
    updatedAt: isoOrNull(h.lastModified),
    section: league ?? null,
    ...bodyOf(blocks),
    keyPoints: [],
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
    sourceName: null,
    dek: ldString(j.summary) ? decodeEntities(ldString(j.summary)!) : null,
    authors,
    byline,
    publishedAt: null,
    publishedDate,
    updatedAt: null,
    section: afterDate === 'live' ? null : sectionName(afterDate),
    body: [],
    paragraphs: [],
    keyPoints: [],
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
    sourceName: null,
    dek: ldString(a.excerpt_plaintext) ? decodeEntities(ldString(a.excerpt_plaintext)!) : null,
    authors,
    byline: joinNames(authors),
    publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    publishedDate: null,
    updatedAt: null,
    section: 'The Athletic',
    body: [],
    paragraphs: [],
    keyPoints: [],
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
  // CNN names every block of the story: the paragraphs, the subheadings
  // between them, and the lists. Nothing else on the page carries the names.
  const blocks = pickBlocks(html, (tag, attrs) => {
    const name = attrs.match(/data-component-name="([^"]+)"/)?.[1];
    if (tag === 'p' && name === 'paragraph') return 'p';
    if ((tag === 'h2' || tag === 'h3') && name === 'subheader') return 'h2';
    if ((tag === 'ul' || tag === 'ol') && name === 'list') return 'list';
    return null;
  });
  const section = u.pathname.match(/^\/\d{4}\/\d{2}\/\d{2}\/([a-z-]+)\//)?.[1];
  return {
    outlet: 'cnn',
    url: cleanUrl(u),
    headline: elementText(html, 'h1', 'headline__text') ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ''),
    headlineParts: null,
    sourceName: null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: sectionName(section),
    ...bodyOf(blocks),
    keyPoints: [],
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
  // the same container don't. A paragraph that is only a bold link is a
  // promo ("CLICK HERE…"). The subheadings are plain <h2>s; the ones with the
  // "title" class head the related-stories lists under the article.
  const blocks = pickBlocks(body, (tag, attrs, inner) => {
    if (tag === 'p') return /data-layout-index/.test(attrs) && !/^\s*<(strong|b)>\s*<a /i.test(inner) ? 'p' : null;
    if (tag === 'h2' || tag === 'h3') return /class="[^"]*\btitle\b/.test(attrs) ? null : 'h2';
    return null;
  });
  return {
    outlet: 'fox',
    url: cleanUrl(u),
    headline: elementText(html, 'h1', 'headline') ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ''),
    headlineParts: null,
    sourceName: null,
    dek: elementText(html, 'h2', 'sub-headline'),
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: sectionName(u.pathname.split('/').filter(Boolean)[0]),
    ...bodyOf(blocks),
    keyPoints: [],
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
  // TMZ's JSON-LD carries the story clean, a blank line between paragraphs;
  // when it is missing, the paragraphs of the page's own article blocks.
  const bodyText = decodeEntities(ldString(ld.articleBody) ?? '');
  let blocks = bodyText.split(/\n\s*\n/).map(t => p(t));
  if (!bodyText.trim()) {
    const at = html.search(/class="article__blocks/);
    blocks = pickBlocks(at >= 0 ? html.slice(at, at + 200_000) : '', (tag, _attrs, inner) =>
      (tag === 'p' && !/Launch Gallery|<script/i.test(inner) ? 'p' : null));
  }
  return {
    outlet: 'tmz',
    url: cleanUrl(u),
    headline,
    headlineParts: main ? { kicker, main, sub } : null,
    sourceName: null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: null,
    ...bodyOf(blocks),
    keyPoints: [],
    live: false,
    notes: [],
  };
}

// ── BBC ────────────────────────────────────────────────────────────────────

// BBC News lays a story out as named blocks — text-block, subheadline-block,
// crosshead-block, the list blocks — in page order.
function bbcNewsBlocks(html: string): BodyBlock[] {
  const out: BodyBlock[] = [];
  for (const m of html.matchAll(/data-component="([a-z-]+)"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const name = m[1];
    const inner = m[2];
    if (name === 'text-block') {
      const ps = [...inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(x => p(textOf(x[1])));
      out.push(...(ps.length ? ps : [p(textOf(inner))]));
    } else if (name === 'subheadline-block' || name === 'crosshead-block') {
      out.push({ kind: 'h2', text: textOf(inner) });
    } else if (/-list-(block|list)$/.test(name)) {
      for (const li of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) out.push({ kind: 'li', text: textOf(li[1]) });
    }
  }
  return out;
}

// BBC Sport is a different renderer: the story runs from the headline to the
// topic list as rich-text blocks (the paragraphs), subheadline blocks (the
// <h2>s), with the pictures, video players and quizzes laid between them —
// each block named by a data-testid. Only what sits inside a rich-text or a
// subheadline block is the story: a video player's "This video can not be
// played" and a picture's caption are paragraphs too, but not the story's.
function bbcSportBlocks(html: string): BodyBlock[] {
  const start = Math.max(0, html.indexOf('data-testid="headline"'));
  const end = html.indexOf('data-testid="topic-list"', start);
  const region = html.slice(start, end > 0 ? end : undefined);
  const out: BodyBlock[] = [];
  let inside: string | null = null;
  for (const m of region.matchAll(/data-testid="([^"]+)"|<(h2|p|li)\b([^>]*)>([\s\S]*?)<\/\2>/gi)) {
    if (m[1]) { inside = m[1]; continue; }
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    if (tag === 'h2' && inside === 'subheadline') out.push({ kind: 'h2', text: textOf(m[4]) });
    else if (inside === 'rich-text' && tag === 'p' && /-Paragraph\b/.test(attrs)) out.push(p(textOf(m[4])));
    // The related-story links at the foot of a block are list items too.
    else if (inside === 'rich-text' && tag === 'li' && !/LinkItem|-Link\b/.test(attrs)) out.push({ kind: 'li', text: textOf(m[4]) });
  }
  return out;
}

async function readBbc(u: URL): Promise<NewsArticle> {
  const html = await pageHtml(u.toString(), 'bbc');
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  let blocks = bbcNewsBlocks(html);
  if (!blocks.length) blocks = bbcSportBlocks(html);
  return {
    outlet: 'bbc',
    url: cleanUrl(u),
    // The page's own headline; BBC's JSON-LD often carries a different, search-engine one.
    headline: firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ''),
    headlineParts: null,
    sourceName: null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: null,
    ...bodyOf(blocks),
    keyPoints: [],
    live: false,
    notes: [],
  };
}


// ── People ─────────────────────────────────────────────────────────────────

/** The bullets People puts in the NEED TO KNOW box above some stories, as
 *  People writes them. Empty when the article has no box. */
function peopleKeyPoints(html: string): string[] {
  const block = html.match(/<div[^>]*class="[^"]*theme-needtoknow[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (!block) return [];
  return [...block[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => textOf(m[1])).filter(Boolean).slice(0, 6);
}

async function readPeople(u: URL): Promise<NewsArticle> {
  const html = await pageHtml(u.toString(), 'people');
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  // The story's own blocks — its paragraphs and lists are "html" blocks, its
  // subheadings "heading" blocks; People's related-story cards, promos and
  // the NEED TO KNOW box sit in other block types.
  const blocks = pickBlocks(html, (tag, attrs) => {
    if (!/mntl-sc-block-(html|heading)\b/.test(attrs)) return null;
    if (tag === 'p') return 'p';
    if (tag === 'h2' || tag === 'h3') return 'h2';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'blockquote') return 'quote';
    return null;
  });
  const first = u.pathname.split('/').filter(Boolean);
  return {
    outlet: 'people',
    url: cleanUrl(u),
    headline: elementText(html, 'h1', 'article-heading') ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ''),
    headlineParts: null,
    sourceName: null,
    dek: elementText(html, 'p', 'article-subheading'),
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: first.length > 1 ? sectionName(first[0]) : null,
    ...bodyOf(blocks),
    keyPoints: peopleKeyPoints(html),
    live: false,
    notes: [],
  };
}

// ── IMDb ───────────────────────────────────────────────────────────────────

async function readImdb(u: URL): Promise<NewsArticle> {
  const id = imdbIdOf(u);
  if (!id) throw new ArticleError('That IMDb link has no news id.');
  let item;
  try {
    item = await imdbItem(id);
  } catch (err) {
    throw new ArticleError(`IMDb wouldn't serve that story (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!item) throw new ArticleError('IMDb is no longer listing that story, so it can\'t be read.');
  return {
    outlet: 'imdb',
    url: imdbUrl(id),
    headline: item.headline,
    headlineParts: null,
    sourceName: item.source,
    dek: null,
    authors: [item.byline],
    byline: item.byline,
    publishedAt: item.publishedAt,
    publishedDate: null,
    updatedAt: null,
    section: null,
    ...bodyOf(item.paragraphs.map(t => p(t))),
    keyPoints: [],
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
    people: readPeople, imdb: readImdb,
  };
  const article = await readers[outlet](u);
  if (article.outlet !== 'nyt' && article.body.length === 0) {
    article.notes.push(`Couldn't read the article text from ${outletById(outlet).name}; the page shows no paragraphs.`);
  }
  return requireVerified(article);
}
