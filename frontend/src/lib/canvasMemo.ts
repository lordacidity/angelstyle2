// Shared React.memo comparator for the media-page canvases (TikTok / Charts /
// ChartsImage). One canvas renders per entry, and CanvasGrid re-renders on every
// keystroke — so without memoization every entry's canvas re-renders each time,
// which is the Media page's main source of typing/scroll lag.
//
// Two things make a naive React.memo useless here:
//   1. Callbacks are inline arrows (new identity every render).
//   2. Several data props are freshly built each render — getMarketData() returns
//      a new object, and `?? [null,null]` / `?? ['','']` create new arrays.
//
// So we compare DATA props BY VALUE (JSON) and IGNORE callback identity. Ignoring
// callbacks is safe: every canvas callback closes over a constant entry id + a
// stable setState function, so a "stale" callback still does the right thing (and
// onRecordingStateChange is additionally mirrored into a ref inside each canvas).
export function canvasPropsEqual(a: object, b: object): boolean {
  const serialize = (p: object): string | null => {
    const out: Record<string, unknown> = {};
    // Object.entries preserves JSX attribute order, which is stable across renders
    // for the same element — so the two serialisations stay comparable.
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'function') continue; // callbacks (ref is not a prop) — ignore identity
      out[k] = v;
    }
    try { return JSON.stringify(out); } catch { return null; }
  };
  const sa = serialize(a);
  const sb = serialize(b);
  if (sa === null || sb === null) return false; // unserializable → re-render to be safe
  return sa === sb;
}
