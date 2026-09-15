// GET /api/photos/search?source=wikimedia|openverse&q=… — free-to-use photos of a person, for the Pricer's photo
// panel and the Photos section, one source per request so the panel can show each as it lands.
//
// Wikimedia Commons: its own search API; every file carries its licence and author. Openverse: WordPress's index of
// Flickr, Wikimedia and others, asked for commercial-use licences and photographs only; it indexes Commons too, so
// the panel drops a file it already has. Neither needs a key. A failure answers 502 with { error }.
//
// Nothing here is a licence check. Most results are CC BY / BY-SA (credit the author), some are public domain;
// the panel shows the licence on every tile and links to the file page. Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import type { FreePhoto, PhotoSource, PhotosResponse } from '@/lib/photos/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Wikimedia asks every API client to say who it is.
const UA = 'PauvStudio/1.0 (https://pauv.com)';
const LIMIT = 24;         // per source
const MIN_SIDE = 400;     // px — anything smaller makes a poor square
const GRID_WIDTH = 400;   // px — Commons thumbnail for the grid
const CROP_WIDTH = 1920;  // px — Commons thumbnail the crop is cut from (originals run to 8,000px and many MB)
// Commons answers in about a second. Openverse answers cached searches at once and fresh ones slowly, and during
// its outages (seen 2026-09-15: its own /healthcheck/ hung) not at all — so give it longer, since nothing waits on it.
const TIMEOUT_MS: Record<PhotoSource, number> = { wikimedia: 12_000, openverse: 25_000 };

interface WmPage {
  pageid: number;
  title: string;
  index: number;          // search rank; Object.values() gives no order
  imageinfo?: {
    url: string; descriptionurl: string; thumburl?: string; width: number; height: number; mime: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
}
interface OvItem {
  id: string; title?: string; url: string; thumbnail?: string; width?: number; height?: number;
  license: string; license_version?: string; license_url?: string; creator?: string; source?: string; foreign_landing_url?: string;
}

// "Neon Tommy<br>Uploaded by …" → "Neon Tommy": Commons' Artist field is HTML, often several lines.
const text = (html?: string) =>
  (html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map(s => s.trim()).find(Boolean)?.slice(0, 80) ?? '';
const licenseLabel = (l: string, v?: string) =>
  l === 'cc0' ? 'CC0' : l === 'pdm' ? 'Public domain' : `CC ${l.toUpperCase()}${v ? ` ${v}` : ''}`;

async function getJson<T>(url: URL, timeoutMs: number): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}${await r.text().then(t => (t ? `: ${t.slice(0, 120)}` : ''), () => '')}`);
  return r.json() as Promise<T>;
}

async function wikimedia(q: string): Promise<FreePhoto[]> {
  // Commons only serves thumbnail widths it has already rendered, and the API renders whatever it is asked for —
  // so ask twice, at grid size and at crop size, rather than editing the width in a URL (that answers 400).
  const ask = (width: number) => {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query', format: 'json',
      generator: 'search', gsrnamespace: '6', gsrlimit: String(LIMIT), gsrsearch: `${q} filetype:bitmap`,
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width),
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
    }).toString();
    return getJson<{ query?: { pages?: Record<string, WmPage> } }>(url, TIMEOUT_MS.wikimedia);
  };
  const [grid, crop] = await Promise.all([ask(GRID_WIDTH), ask(CROP_WIDTH)]);
  const cropInfo = new Map(Object.values(crop.query?.pages ?? {}).map(p => [p.pageid, p.imageinfo?.[0]]));
  return Object.values(grid.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .flatMap(p => {
      const ii = p.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime) || Math.min(ii.width, ii.height) < MIN_SIDE) return [];
      const md = ii.extmetadata ?? {};
      const big = cropInfo.get(p.pageid);
      return [{
        id: `wm-${p.pageid}`,
        source: 'Wikimedia Commons' as const,
        title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        thumb: ii.thumburl ?? ii.url,
        full: big?.thumburl ?? big?.url ?? ii.url,
        width: ii.width, height: ii.height,
        license: md.LicenseShortName?.value || 'licence not stated',
        licenseUrl: md.LicenseUrl?.value ?? '',
        creator: text(md.Artist?.value),
        page: ii.descriptionurl,
      }];
    });
}

async function openverse(q: string): Promise<FreePhoto[]> {
  const url = new URL('https://api.openverse.org/v1/images/');
  // Anonymous requests may ask for at most 20 a page (more is answered 401).
  url.search = new URLSearchParams({ q, license_type: 'commercial', category: 'photograph', page_size: String(Math.min(LIMIT, 20)) }).toString();
  const j = await getJson<{ results?: OvItem[] }>(url, TIMEOUT_MS.openverse);
  return (j.results ?? [])
    .filter(i => i.url && Math.min(i.width ?? 0, i.height ?? 0) >= MIN_SIDE)
    .map(i => ({
      id: `ov-${i.id}`,
      source: 'Openverse' as const,
      provider: i.source,
      title: i.title ?? '',
      thumb: i.thumbnail ?? i.url,   // Openverse's thumbnailer fails on some files; the panel falls back to `full`
      full: i.url,
      width: i.width ?? 0, height: i.height ?? 0,
      license: licenseLabel(i.license, i.license_version),
      licenseUrl: i.license_url ?? '',
      creator: i.creator ?? '',
      page: i.foreign_landing_url ?? i.url,
    }));
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const source = req.nextUrl.searchParams.get('source');
  if (!q) return NextResponse.json({ error: 'q is required' }, { status: 400 });
  if (source !== 'wikimedia' && source !== 'openverse') {
    return NextResponse.json({ error: 'source must be wikimedia or openverse' }, { status: 400 });
  }

  try {
    const photos = source === 'wikimedia' ? await wikimedia(q) : await openverse(q);
    const body: PhotosResponse = { query: q, source, photos };
    return NextResponse.json(body);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const error = timedOut ? `didn't answer within ${TIMEOUT_MS[source] / 1000}s` : e instanceof Error ? e.message : String(e);
    console.warn(`[pricer photos] ${source} "${q}": ${error}`);
    return NextResponse.json({ error }, { status: 502 });
  }
}
