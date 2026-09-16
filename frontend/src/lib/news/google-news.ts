// Google News for the News section: search limited to the approved outlets,
// the latest headlines from one outlet, and turning Google's wrapped article
// links back into the outlet's own URL.
//
// Google News RSS is free and needs no key. Its <link>s point at
// news.google.com/rss/articles/<id>, which no longer redirect; the outlet URL
// is recovered the way the Google News web app does it, through its
// batchexecute endpoint, with the signature and timestamp the article page
// carries.

import { request as httpsRequest } from 'node:https';
import { decodeEntities, BROWSER_HEADERS } from './html';
import { OUTLETS, articleUrlProblem, outletForHost } from './outlets';
import type { NewsHit, OutletId, RailItem } from './types';

const FEED = 'https://news.google.com/rss/search';

export type NewsRange = '1d' | '7d' | '30d' | 'any';

interface FeedItem { title: string; link: string; publishedAt: string | null; sourceUrl: string | null; sourceName: string | null }

async function fetchFeed(q: string): Promise<FeedItem[]> {
  const url = new URL(FEED);
  url.searchParams.set('q', q);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Google News answered ${res.status}`);
  const xml = await res.text();
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const pick = (tag: string) => {
      const r = it.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return r ? decodeEntities(r[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() : null;
    };
    const src = it.match(/<source url="([^"]*)">([\s\S]*?)<\/source>/);
    const link = pick('link');
    const title = pick('title');
    if (!link || !title) continue;
    const pub = pick('pubDate');
    const t = pub ? Date.parse(pub) : NaN;
    items.push({
      title,
      link,
      publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
      sourceUrl: src ? decodeEntities(src[1]) : null,
      sourceName: src ? decodeEntities(src[2]).trim() : null,
    });
  }
  return items;
}

/** Google News appends " - Outlet Name" to every title; the page doesn't have it.
 *  Athletic stories carry " - The Athletic" as well. */
function stripSourceSuffix(title: string, sourceName: string | null): string {
  const t = sourceName && title.endsWith(` - ${sourceName}`)
    ? title.slice(0, -(sourceName.length + 3))
    : title.replace(/\s+-\s+[^-]{2,40}$/, '');
  return t.replace(/\s+-\s+The Athletic$/, '').trim();
}

function siteClause(ids: OutletId[]): string {
  const hosts = OUTLETS.filter(o => ids.includes(o.id)).flatMap(o => o.hosts);
  return hosts.length === 1 ? `site:${hosts[0]}` : `(${hosts.map(h => `site:${h}`).join(' OR ')})`;
}

function outletOf(item: FeedItem): OutletId | null {
  if (!item.sourceUrl) return null;
  try { return outletForHost(new URL(item.sourceUrl).hostname); } catch { return null; }
}

/** Lower case, accents and curly quotes folded, so names match however they're typed. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'").toLowerCase();
}

/** Whether a headline has the whole name in it, as words: "Macklemore's"
 *  counts, "Swift" alone doesn't count for "Taylor Swift". */
export function headlineNames(title: string, query: string): boolean {
  const words = fold(query).split(/[\s-]+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return false;
  return new RegExp(`(^|[^a-z0-9])${words.join('[\\s-]+')}(?![a-z0-9])`).test(fold(title));
}

/** The same story can be listed under two hosts (bbc.com and bbc.co.uk,
 *  www.cnn.com and edition.cnn.com); the path is what identifies it. */
function storyKey(outlet: OutletId, url: URL): string {
  return `${outlet}|${url.pathname.toLowerCase().replace(/\/$/, '')}`;
}

/** Stories about `query` from the approved outlets only. Every result is
 *  resolved to the outlet's own URL, and anything that isn't an article page
 *  (video, audio, live pages, section fronts) is left out. Headlines that name
 *  what was searched come first, then newest first. */
export async function searchApprovedNews(query: string, ids: OutletId[], range: NewsRange): Promise<NewsHit[]> {
  const when = range === 'any' ? '' : ` when:${range}`;
  const items = await fetchFeed(`${query} ${siteClause(ids)}${when}`);
  const seenTitles = new Set<string>();
  const candidates: { outlet: OutletId; title: string; item: FeedItem }[] = [];
  for (const it of items) {
    const outlet = outletOf(it);
    if (!outlet || !ids.includes(outlet)) continue;
    const title = stripSourceSuffix(it.title, it.sourceName);
    const key = `${outlet}|${title.toLowerCase()}`;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    candidates.push({ outlet, title, item: it });
  }

  const urls = await resolveGoogleNewsLinks(candidates.map(c => c.item.link));
  if (candidates.length > 0 && urls.every(u => u === null)) {
    throw new Error("Google News wouldn't open any of the results. Try again in a minute.");
  }

  const seenStories = new Set<string>();
  const hits: NewsHit[] = [];
  candidates.forEach((c, i) => {
    const url = urls[i];
    if (!url) return;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (outletForHost(parsed.hostname) !== c.outlet || articleUrlProblem(c.outlet, parsed)) return;
    const key = storyKey(c.outlet, parsed);
    if (seenStories.has(key)) return;
    seenStories.add(key);
    hits.push({ outlet: c.outlet, title: c.title, publishedAt: c.item.publishedAt, link: c.item.link, url, named: headlineNames(c.title, query) });
  });
  const ts = (h: NewsHit) => (h.publishedAt ? Date.parse(h.publishedAt) : 0);
  hits.sort((a, b) => Number(b.named) - Number(a.named) || ts(b) - ts(a));
  return hits;
}

/** The outlet's latest headlines, for the page's side column. Real titles only. */
export async function latestFromOutlet(id: OutletId, excludeTitle: string, limit = 12): Promise<RailItem[]> {
  const items = await fetchFeed(`${siteClause([id])} when:1d`);
  const skip = excludeTitle.toLowerCase();
  const seen = new Set<string>([skip]);
  const out: RailItem[] = [];
  for (const it of items) {
    if (outletOf(it) !== id) continue;
    const title = stripSourceSuffix(it.title, it.sourceName);
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, publishedAt: it.publishedAt });
    if (out.length >= limit) break;
  }
  return out;
}

const resolved = new Map<string, string>();
const RESOLVED_MAX = 5000;

function remember(link: string, url: string) {
  if (resolved.size >= RESOLVED_MAX) resolved.delete(resolved.keys().next().value!);
  resolved.set(link, url);
}

/** A plain GET over node:https. Search makes up to 100 of these at once, and
 *  going through Next's wrapped fetch made that burst several times slower. */
function httpsText(url: string, timeoutMs: number, redirects = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] }, timeout: timeoutMs }, res => {
      const next = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && next && redirects > 0) {
        res.resume();
        resolve(httpsText(new URL(next, url).toString(), timeoutMs, redirects - 1));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** The signature and timestamp Google's article page carries for one link. */
async function articleSignature(id: string): Promise<{ sig: string; ts: number } | null> {
  try {
    const html = await httpsText(`https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US:en`, 10000);
    const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    return sig && ts ? { sig, ts: Number(ts) } : null;
  } catch {
    return null;
  }
}

/** The outlet's own URL for each Google News link, in order; null where Google
 *  wouldn't say. Other links pass through. Signatures are fetched a few at a
 *  time, then all the links are decoded in one request. */
export async function resolveGoogleNewsLinks(links: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  const todo: { i: number; link: string; id: string }[] = [];
  links.forEach((link, i) => {
    let u: URL | null = null;
    try { u = new URL(link); } catch { /* not a link */ }
    out.push(u && u.hostname !== 'news.google.com' ? link : resolved.get(link) ?? null);
    const id = u?.hostname === 'news.google.com' ? u.pathname.split('/').filter(Boolean).pop() : undefined;
    if (out[i] === null && id) todo.push({ i, link, id });
  });
  if (todo.length === 0) return out;

  const signed: { i: number; link: string; id: string; sig: string; ts: number }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, todo.length) }, async () => {
    while (next < todo.length) {
      const t = todo[next++];
      const s = await articleSignature(t.id);
      if (s) signed.push({ ...t, ...s });
    }
  }));

  for (let start = 0; start < signed.length; start += 100) {
    const chunk = signed.slice(start, start + 100);
    const envelopes = chunk.map((c, n) => ['Fbv4je', JSON.stringify([
      'garturlreq',
      [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      c.id, c.ts, c.sig,
    ]), null, String(n + 1)]);
    let text: string;
    try {
      const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': BROWSER_HEADERS['User-Agent'] },
        body: 'f.req=' + encodeURIComponent(JSON.stringify([envelopes])),
        signal: AbortSignal.timeout(20000),
        cache: 'no-store',
      });
      text = await res.text();
    } catch {
      continue;
    }
    // Each answer is a ["wrb.fr", "Fbv4je", "<json>", …, "<envelope number>"] row.
    for (const line of text.split('\n')) {
      if (!line.startsWith('[')) continue;
      let rows: unknown;
      try { rows = JSON.parse(line); } catch { continue; }
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!Array.isArray(row) || row[0] !== 'wrb.fr' || typeof row[2] !== 'string') continue;
        const c = chunk[Number(row[row.length - 1]) - 1];
        let url: unknown;
        try { url = JSON.parse(row[2])[1]; } catch { continue; }
        if (!c || typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
        out[c.i] = url;
        remember(c.link, url);
      }
    }
  }
  return out;
}

/** The outlet's own URL for one Google News link (other links pass through). */
export async function resolveGoogleNewsLink(link: string): Promise<string> {
  const [url] = await resolveGoogleNewsLinks([link]);
  if (!url) throw new Error("Couldn't work out the outlet's link for that result.");
  return url;
}
