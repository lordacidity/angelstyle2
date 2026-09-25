'use client';

import { useEffect, useReducer } from 'react';
import { cachedClipBlob, heldClipSrc, isCacheableClipUrl, setPinnedClips } from '@/lib/vids-clip-cache';

/** What to point each media element at, for a list of clip URLs: an object
 *  URL over the clip's cached bytes once they are here, null while they are
 *  on the way, and the URL itself for anything the cache doesn't take — a
 *  local clip's blob: URL, a clip that couldn't be fetched. One hook for the
 *  whole list, because the stage renders its slots in a loop; it re-renders
 *  as each clip lands. Pass null for an empty slot. */
export function useCachedClipSrcs(urls: readonly (string | null)[]): (string | null)[] {
  const [, landed] = useReducer((n: number) => n + 1, 0);
  // The list as one string, so the effect keys on what is in it rather than
  // on the array made fresh each render. A URL cannot hold a newline.
  const key = urls.map((u) => u ?? '').join('\n');
  useEffect(() => {
    const wanted = key.split('\n').filter(isCacheableClipUrl);
    setPinnedClips(wanted);
    let live = true;
    for (const url of wanted) {
      if (heldClipSrc(url)) continue;
      cachedClipBlob(url).then(() => { if (live) landed(); }, () => { if (live) landed(); });
    }
    return () => { live = false; };
  }, [key]);
  useEffect(() => () => setPinnedClips([]), []);
  return urls.map((url) => (url === null ? null : isCacheableClipUrl(url) ? heldClipSrc(url) : url));
}
