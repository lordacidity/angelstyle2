// Pauv trade recordings, kept — the browser's side of api/vids/trade-cache.
//
// The trade recording is the same for everybody who makes a video on the same
// person, the same way, in the same theme: it is drawn from the roster and a
// name-seeded script, nothing of the clipper's. Drawing it is the long part of
// a phone's wait, so the first one drawn is sent up and kept, and the clipper
// page is handed that file from then on (makeTradeClip in vids2Build).
//
// Kept for good. The price and the chart on it are the day's it was drawn —
// which a video watched weeks later was never going to match anyway. Bump
// TRADE_CACHE_VERSION when components/trade/trade-video changes what the
// recording looks like or how long its beats run: the version is in the key,
// so every recording is drawn afresh, once, under the new one.
//
// Everything here is best effort. A recording that can't be read is drawn,
// and one that can't be kept is simply not kept.

import { withBase } from '@/lib/clipping';
import type { Direction, Theme, TradeBeats, ZoomLevel } from '@/app/components/trade/trade-video';

export const TRADE_CACHE_VERSION = 1;

export const tradeCacheKey = (name: string, direction: Direction, theme: Theme, zoom: ZoomLevel): string =>
  `v${TRADE_CACHE_VERSION}|${name.trim().toLowerCase().replace(/\|/g, ' ').slice(0, 120)}|${direction}|${theme}|${zoom}`;

export interface KeptTrade {
  blob: Blob;
  /** Pauv's spelling of them, as the recording shows it. */
  person: string;
  seconds: number;
  beats: TradeBeats;
}

const ROUTE = '/api/vids/trade-cache';

/** The recording kept under this key, bytes and all — or null. */
export async function readTradeCache(key: string, signal?: AbortSignal): Promise<KeptTrade | null> {
  try {
    const r = await fetch(withBase(`${ROUTE}?key=${encodeURIComponent(key)}`), { signal });
    if (!r.ok) return null;
    const row = await r.json() as { url: string; person: string; seconds: number; beats: TradeBeats };
    const file = await fetch(row.url, { signal });
    if (!file.ok) return null;
    const blob = await file.blob();
    if (!blob.size) return null;
    return { blob: blob.type ? blob : new Blob([blob], { type: 'video/mp4' }), person: row.person, seconds: row.seconds, beats: row.beats };
  } catch (e) {
    // A cancel is the caller's to hear about; anything else is a miss.
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return null;
  }
}

/** Send a recording just drawn up to be kept, unless somebody already has. */
export async function keepTradeClip(key: string, blob: Blob, meta: Omit<KeptTrade, 'blob'>): Promise<void> {
  try {
    // Only an MP4: that is what every browser the page runs in can decode.
    if (blob.type !== 'video/mp4') return;
    const json = { 'Content-Type': 'application/json' };
    const sign = await fetch(withBase(ROUTE), { method: 'POST', headers: json, body: JSON.stringify({ key }) });
    if (!sign.ok) return;
    const { path, url } = await sign.json() as { path: string; url: string };
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'false' }, body: blob });
    if (!put.ok) return;
    await fetch(withBase(ROUTE), {
      method: 'PUT', headers: json, body: JSON.stringify({ key, path, sizeBytes: blob.size, ...meta }),
    });
  } catch { /* not kept: the next one to draw it tries again */ }
}
