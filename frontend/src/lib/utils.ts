/** Build a proxied stream URL for cross-origin media playback */
export function proxyStreamUrl(url: string): string {
  return `/api/proxy?stream=1&url=${encodeURIComponent(url)}`;
}

/** Clamp a zoom/scale value to [min, max] */
export function clampZoom(val: number, min = 0.5, max = 3): number {
  return Math.max(min, Math.min(max, val));
}

/** Format seconds as M:SS */
export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Pick the best video URL from a VideoData-like object, proxied */
export function bestVideoUrl(data: { play?: string; hdplay?: string; wmplay?: string }): string {
  return proxyStreamUrl(data.play || data.hdplay || data.wmplay || '');
}

/** Strip characters Windows can't put in a filename, for a download name.
 *  Used by Simpler (components/simpler). The Charts/Vids export path has its
 *  own copy in lib/canvasVideoExport with a different fallback name; they are
 *  kept apart so a change to one export's naming can't rename the other's. */
export function safeExportName(raw: string) {
  return raw.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70).replace(/[. ]+$/g, '').trim() || 'vid';
}
