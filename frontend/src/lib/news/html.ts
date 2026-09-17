// Small, dependency-free helpers for reading article pages on the server.

import { request as httpsRequest } from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
  eacute: 'é', egrave: 'è', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú',
  ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
  Eacute: 'É', Aacute: 'Á', Oacute: 'Ó', Ntilde: 'Ñ', copy: '©', reg: '®', trade: '™',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

/** An HTML fragment as plain text: tags dropped, entities decoded, spaces collapsed. */
export function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/[ \s]+/g, ' ')
    .trim();
}

/** Every JSON-LD object on the page, @graph entries flattened in. */
export function jsonLdObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x && typeof x === 'object') {
      out.push(x as Record<string, unknown>);
      const g = (x as Record<string, unknown>)['@graph'];
      if (g) walk(g);
    }
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* a malformed block is skipped */ }
  }
  return out;
}

/** The page's article object from JSON-LD, if it has one. */
export function articleLd(html: string): Record<string, unknown> | null {
  return jsonLdObjects(html).find(o => /Article|BlogPosting/i.test([o['@type']].flat().join(','))) ?? null;
}

export function ldString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  return null;
}

/** Author names from a JSON-LD author field (string, object or array). */
export function ldAuthors(v: unknown): string[] {
  const names = [v].flat().map(a => {
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object') return ldString((a as Record<string, unknown>).name) ?? '';
    return '';
  });
  const seen = new Set<string>();
  return names
    .map(n => decodeEntities(n).replace(/\s+/g, ' ').trim())
    .filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

/** Text of the first element matching a tag + class fragment, or null. */
export function elementText(html: string, tag: string, classPart: string): string | null {
  const re = new RegExp(`<${tag}[^>]*class="[^"]*${classPart}[^"]*"[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = html.match(re);
  const t = m ? textOf(m[1]) : '';
  return t || null;
}

export function firstH1(html: string): string | null {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const t = m ? textOf(m[1]) : '';
  return t || null;
}

/** Mostly-capitals lines are promos and related-story links, not article text. */
export function isShouting(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length >= 12 && letters === letters.toUpperCase();
}

export const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface Fetched { status: number; text: string; finalUrl: string }

export async function fetchText(url: string, timeoutMs = 15000): Promise<Fetched> {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  return { status: res.status, text: await res.text(), finalUrl: res.url || url };
}

/** The same page asked for over a plain HTTPS request instead of fetch().
 *
 *  People sits behind a guard that refuses fetch() whatever headers it is
 *  given — it answers a challenge page with status 403 — but serves the story
 *  to an ordinary request with a browser's header names and order. The first
 *  ask is often refused anyway, so it is repeated. */
export function fetchTextPlain(url: string, timeoutMs = 15000, hops = 4): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { reject(new Error('not a link')); return; }
    const req = httpsRequest({
      host: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Host: u.hostname, ...BROWSER_HEADERS },
      timeout: timeoutMs,
    }, res => {
      const code = res.statusCode ?? 0;
      const location = res.headers.location;
      if (code >= 300 && code < 400 && location && hops > 0) {
        res.resume();
        fetchTextPlain(new URL(location, u).toString(), timeoutMs, hops - 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] ?? '');
        let text: string;
        try {
          text = (enc === 'gzip' ? gunzipSync(body) : enc === 'br' ? brotliDecompressSync(body) : enc === 'deflate' ? inflateSync(body) : body).toString('utf8');
        } catch {
          text = body.toString('utf8');
        }
        resolve({ status: code, text, finalUrl: u.toString() });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** A page, however the outlet will part with it: fetch first, and when that is
 *  refused the plain way, a few times — the guard lets most of them through
 *  after the first. */
export async function fetchPage(url: string, timeoutMs = 15000): Promise<Fetched> {
  const first = await fetchText(url, timeoutMs).catch((err: unknown) => err instanceof Error ? err : new Error(String(err)));
  if (!(first instanceof Error) && first.status !== 403) return first;
  let last: Fetched | Error = first;
  for (let i = 0; i < 3; i++) {
    last = await fetchTextPlain(url, timeoutMs).catch((err: unknown) => err instanceof Error ? err : new Error(String(err)));
    if (!(last instanceof Error) && last.status !== 403) return last;
  }
  if (last instanceof Error) throw last;
  return last;
}
