// Resolve a search-result photo into a URL the carousel canvas can ALWAYS
// draw (same-origin or data:). Chain:
//   1. cache the full-res URL locally (/api/ai/photos/cache)
//   2. hosts that block server fetches entirely (fbsbx etc. — cache 422s AND
//      the proxy 502s): fall back to the search THUMBNAIL — data: URIs draw
//      directly, remote thumbs get cached
//   3. last resort: the same-origin image proxy on the full-res URL
export async function resolvePhotoSrc(url: string, thumbnail?: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return url;

  const tryCache = async (u: string): Promise<string | null> => {
    try {
      const r = await fetch('/api/ai/photos/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      if (r.ok) {
        const data = await r.json() as { localUrl: string };
        return data.localUrl;
      }
    } catch (e) { console.warn('[photo cache]', e); }
    return null;
  };

  const cached = await tryCache(url);
  if (cached) return cached;

  if (thumbnail) {
    if (thumbnail.startsWith('data:')) return thumbnail;
    if (/^https?:\/\//i.test(thumbnail)) {
      const cachedThumb = await tryCache(thumbnail);
      if (cachedThumb) return cachedThumb;
    }
  }

  return `/api/charts/image-proxy?url=${encodeURIComponent(url)}`;
}
