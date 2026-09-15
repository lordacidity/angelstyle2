// GET /api/pricer/photos?q=… — free-to-use photos of a person, for the Pricer's photo panel (PricerPhotos).
//
// Two sources, asked in parallel and merged: Wikimedia Commons (its own search API; every file carries its licence
// and author) and Openverse (WordPress's index of Flickr, Wikimedia and others; asked for commercial-use licences
// and photographs only). Openverse indexes Commons too, so a Commons file that turns up in both is kept once.
// Neither needs a key. A source that fails is named in `errors` and the other's results still come back.
//
// Nothing here is a licence check. Most results are CC BY / BY-SA (credit the author), some are public domain;
// the panel shows the licence on every tile and links to the file page. Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import type { PhotosResponse, PricerPhoto } from '@/lib/pricer/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Wikimedia asks every API client to say who it is.
const UA = 'PauvStudio/1.0 (https://pauv.com)';
const LIMIT = 24;         // per source
const MIN_SIDE = 400;     // px — anything smaller makes a poor square
const GRID_WIDTH = 400;   // px — Commons thumbnail for the grid
const CROP_WIDTH = 1920;  // px — Commons thumbnail the crop is cut from (originals run to 8,000px and many MB)
const TIMEOUT_MS = 12_000;

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
// The file behind a URL, so a Commons file seen through Openverse matches the same file from Commons.
const fileKey = (u: string) => {
  try { return decodeURIComponent(new URL(u).pathname.split('/').pop() ?? '').replace(/^\d+px-/, '').toLowerCase(); } catch { return u; }
};
const licenseLabel = (l: string, v?: string) =>
  l === 'cc0' ? 'CC0' : l === 'pdm' ? 'Public domain' : `CC ${l.toUpperCase()}${v ? ` ${v}` : ''}`;

async function getJson<T>(url: URL): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}${await r.text().then(t => (t ? `: ${t.slice(0, 120)}` : ''), () => '')}`);
  return r.json() as Promise<T>;
}

async function wikimedia(q: string): Promise<PricerPhoto[]> {
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
    return getJson<{ query?: { pages?: Record<string, WmPage> } }>(url);
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

async function openverse(q: string): Promise<PricerPhoto[]> {
  const url = new URL('https://api.openverse.org/v1/images/');
  // Anonymous requests may ask for at most 20 a page (more is answered 401).
  url.search = new URLSearchParams({ q, license_type: 'commercial', category: 'photograph', page_size: String(Math.min(LIMIT, 20)) }).toString();
  const j = await getJson<{ results?: OvItem[] }>(url);
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
  if (!q) return NextResponse.json({ error: 'q is required' }, { status: 400 });

  const [wm, ov] = await Promise.allSettled([wikimedia(q), openverse(q)]);
  const errors: PhotosResponse['errors'] = {};
  const reason = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason));
  const a = wm.status === 'fulfilled' ? wm.value : [];
  if (wm.status === 'rejected') errors.wikimedia = reason(wm);
  const seen = new Set(a.map(p => fileKey(p.full)));
  const b = ov.status === 'fulfilled' ? ov.value.filter(p => !seen.has(fileKey(p.full))) : [];
  if (ov.status === 'rejected') errors.openverse = reason(ov);

  // Interleave so the top of the grid mixes both sources.
  const photos: PricerPhoto[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) photos.push(a[i]);
    if (b[i]) photos.push(b[i]);
  }
  if (errors.wikimedia || errors.openverse) console.warn(`[pricer photos] "${q}":`, errors);
  const body: PhotosResponse = { query: q, photos, errors };
  return NextResponse.json(body);
}
