// Asking /api/photos/search from the browser, one source at a time, and folding the answers into one grid.
// Shared by the Pricer's photo panel and the Photos section.

import type { FreePhoto, PhotoSource, PhotosResponse } from '@/lib/photos/types';

export const SOURCES: { key: PhotoSource; label: string }[] = [
  { key: 'wikimedia', label: 'Wikimedia Commons' },
  { key: 'openverse', label: 'Openverse' },
];
export const sourceLabel = (key: PhotoSource) => SOURCES.find(s => s.key === key)?.label ?? key;

// One source, one query. Throws with a line the page can show as it is ("didn't answer within 25s", "HTTP 429").
export async function fetchPhotos(source: PhotoSource, q: string): Promise<FreePhoto[]> {
  const r = await fetch(`/api/photos/search?source=${source}&q=${encodeURIComponent(q)}`);
  const j = await r.json().catch(() => ({})) as Partial<PhotosResponse> & { error?: string };
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.photos ?? [];
}

// The file behind a URL, so a Commons file seen through Openverse matches the same file from Commons.
const fileKey = (u: string) => {
  try { return decodeURIComponent(new URL(u).pathname.split('/').pop() ?? '').replace(/^\d+px-/, '').toLowerCase(); } catch { return u; }
};

// Later arrivals go after, never between, so tiles don't move under the pointer; a file already in the grid
// (Openverse indexes Commons too) is not added twice.
export function mergePhotos(prev: FreePhoto[], fresh: FreePhoto[]): FreePhoto[] {
  const seen = new Set(prev.map(p => fileKey(p.full)));
  return [...prev, ...fresh.filter(p => !seen.has(fileKey(p.full)))];
}
