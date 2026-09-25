'use client';

// Bytes of library clips, fetched once per browser and kept — in memory for
// the session and in the Cache API across reloads — so the stage and the
// exporter read a persona's clips off this machine rather than pulling them
// from the bucket on every build. That pull was most of the Supabase egress:
// the persona's three clips fetched for the stage, then again in ranges by
// the exporter, on every one of a few hundred builds a month.
//
// Keyed by the clip's URL, which never changes for the same bytes — a
// re-shoot or an edit goes up under a fresh path (api/vids/videos/sign) — so
// a cached entry can never be stale. The exporter reads exactly the bytes it
// would have fetched, so the file it writes is the same file.
//
// Only http(s) URLs are cached. A local clip's blob: URL (simpler/vidsLocal)
// already lives in this tab, and a planned clip has no URL at all.

const CACHE_NAME = 'vids-clips-v1';
/** How many clips' bytes stay in memory at once: the slots of the build on
 *  the stage and a change of persona or two before the oldest go. Whatever is
 *  pinned (on the stage right now) never goes. The Cache API keeps everything
 *  else on disk, so a clip that leaves memory is read back without the
 *  network. */
const MEM_MAX = 12;

export const isCacheableClipUrl = (url: string | null | undefined): url is string =>
  typeof url === 'string' && /^https?:\/\//.test(url);

/** Bytes in memory, least recently used first, each with the object URL a
 *  media element can play it from. */
const mem = new Map<string, { blob: Blob; objectUrl: string }>();
/** Fetches under way, so two askers share one. */
const inflight = new Map<string, Promise<Blob>>();
/** URLs on the stage right now — kept in memory whatever else comes in. */
let pinned = new Set<string>();
/** URLs that could not be fetched this session — handed back as they are, so
 *  the element streams them from the bucket the way it did before. */
const failed = new Set<string>();

function hold(url: string, blob: Blob): void {
  const had = mem.get(url);
  mem.delete(url);
  mem.set(url, had ?? { blob, objectUrl: URL.createObjectURL(blob) });
  for (const [oldest, entry] of mem) {
    if (mem.size <= MEM_MAX) break;
    if (pinned.has(oldest)) continue;
    mem.delete(oldest);
    URL.revokeObjectURL(entry.objectUrl);
  }
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** The clip's bytes: from memory, else from the Cache API, else fetched once
 *  and put there. Rejects when the clip can't be fetched — a network error, a
 *  URL that isn't http — which callers take as "read it the old way". */
export function cachedClipBlob(url: string): Promise<Blob> {
  const held = mem.get(url);
  if (held) { hold(url, held.blob); return Promise.resolve(held.blob); }
  const going = inflight.get(url);
  if (going) return going;
  const p = (async () => {
    if (!isCacheableClipUrl(url)) throw new Error('not a fetchable clip URL');
    const cache = await openCache();
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      const blob = await hit.blob();
      hold(url, blob);
      return blob;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    // Kept on disk for next time, best effort — a full or blocked store is
    // no reason not to hand the bytes back.
    if (cache) await cache.put(url, res.clone()).catch(() => {});
    const blob = await res.blob();
    hold(url, blob);
    return blob;
  })();
  inflight.set(url, p);
  p.then(
    () => { failed.delete(url); inflight.delete(url); },
    () => { failed.add(url); inflight.delete(url); },
  );
  return p;
}

/** What a media element should play the clip from: an object URL over its
 *  bytes once they are held here; null while they are still on the way (ask
 *  cachedClipBlob); the clip's own URL once fetching it has failed, so the
 *  element streams it from the bucket as it always did. A pure lookup, safe
 *  to call while rendering. */
export function heldClipSrc(url: string): string | null {
  const held = mem.get(url);
  if (held) return held.objectUrl;
  return failed.has(url) ? url : null;
}

/** Say which clips are on the stage right now, so they stay in memory however
 *  many others come and go. Replaces the last set. */
export function setPinnedClips(urls: Iterable<string>): void {
  pinned = new Set(urls);
}

/** Drop everything on disk that isn't in `keep` — called with the library's
 *  URLs whenever it is read, so a deleted or re-shot clip's bytes don't stay
 *  on the machine and the cache can never be bigger than the library. */
export async function trimClipCache(keep: Iterable<string>): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  const want = new Set(keep);
  try {
    for (const req of await cache.keys()) {
      if (!want.has(req.url)) await cache.delete(req);
    }
  } catch {
    /* nothing to trim, or storage is off */
  }
}
