// One source tree, two sites.
//
// The Studio (angelstyle) and the clipper page at pauv.io/clipping are built
// from these same files — no copy, no package, no submodule. A change to how
// Vids 2 builds a video is a change to both, because there is only one of it.
// The whole difference between the two deployments is NEXT_PUBLIC_APP, set on
// the clipper Vercel project alone.
//
// pauv.io keeps its own repo and its own site; it forwards one path prefix to
// the clipper deployment and is otherwise untouched:
//
//   pauv.io/clipping/:path*  →  <clipper deployment>/clipping/:path*
//
// That works because the clipper build sets `basePath: '/clipping'`
// (next.config.ts, off the same flag): its pages, its /_next assets and its API
// routes all answer under /clipping/*, so one rewrite catches everything and
// nothing can collide with pauv.io's own routes.
//
// basePath is free for `next/link`, `next/image` and the router — they prepend
// it themselves. It is NOT free for anything that builds a URL by hand: a bare
// `fetch('/api/vids')`, an `img.src = '/news/cnn.png'`, an <audio> pointed at
// '/audio/track-1.mp3'. In the clipper build those resolve against pauv.io,
// which has no such routes, and 404. Every one of them goes through withBase()
// instead — at the few chokepoints the Vids 2 tree funnels through, not at each
// call site, so a new outlet logo or a new API route can't quietly miss it.

/** True in the clipper deployment only. Inlined at build time. */
export const CLIPPERS = process.env.NEXT_PUBLIC_APP === 'clippers';

/** What every path this app serves is prefixed with. '' in the Studio. Keep in
 *  step with `basePath` in next.config.ts — both read the same flag. */
export const BASE_PATH = CLIPPERS ? '/clipping' : '';

/** A root-relative path this app serves, as the browser should ask for it.
 *  A no-op in the Studio, so it is safe to wrap anything. Absolute URLs and
 *  data:/blob: URLs are passed through untouched. */
export function withBase(path: string): string {
  if (!BASE_PATH) return path;
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}
