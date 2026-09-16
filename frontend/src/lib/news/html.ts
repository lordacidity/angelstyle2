// Small, dependency-free helpers for reading article pages on the server.

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

export async function fetchText(url: string, timeoutMs = 15000): Promise<{ status: number; text: string; finalUrl: string }> {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  return { status: res.status, text: await res.text(), finalUrl: res.url || url };
}
