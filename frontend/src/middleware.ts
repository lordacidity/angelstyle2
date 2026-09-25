import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME, SITE_SCOPE } from '@/lib/auth';
import { CLIPPERS } from '@/lib/clipping';

// Site-wide password gate. Every route requires a signed `site_auth` cookie except the
// unlock UI/endpoint (and framework internals, excluded via the matcher). The cookie is
// minted by /api/unlock after the shared SITE_PASSWORD is entered. See src/lib/auth.ts.
//
// Fail-open if SITE_PASSWORD is unset, so a missing env var can't lock you out of your own
// site. On Vercel (the public deploy) the env vars are always present, so the gate is live.

// /api/aier/health is exempt so platform healthchecks (Railway) can reach it without the
// site_auth cookie — it returns only boolean status, nothing sensitive.
const PUBLIC_PREFIXES = ['/unlock', '/api/unlock', '/api/aier/health'];

// ── The clipper deployment ───────────────────────────────────────────────────
// pauv.io/clipping is this same app built with NEXT_PUBLIC_APP=clippers, so
// every route the Studio has is compiled into it — the library's delete and
// rename endpoints, the Clippers page that sets the flags, all of it. Not
// rendering the sidebar hides them; it does not close them. This list is what
// closes them: in that build, anything not named here answers 404.
//
// It is exactly what the Vids 2 tree calls, and nothing else. A route added to
// that flow has to be added here too, or it will 404 in the clipper build alone
// — which is the trade for having one codebase instead of two.
const CLIPPER_PAGES = ['/', '/clippers', '/unlock'];

const CLIPPER_API = [
  '/api/unlock',
  // The library, read-only, and the folders Vids 2 files its own work in.
  // /api/vids alone: not /api/vids/videos or /api/vids/personas, whose PATCH and
  // DELETE would let a clipper rename or destroy the library, and not
  // /api/vids/clipable, which is where "ours alone" is decided.
  '/api/vids',
  '/api/vids/folders',
  '/api/vids/boom-sounds',
  // The words — the hook, the step-by-step captions, the post captions, the
  // ChatGPT question — and the recipe a tuned video can be saved as.
  '/api/vids/hook',
  '/api/vids/captions',
  '/api/vids/post-captions',
  '/api/vids/question',
  '/api/vids/recipes',
  // The recordings: the roster, the trade's price history, the news story and
  // its photos, the music, and the proxy both of those draw images through.
  '/api/ai/talents',
  '/api/ai/chatgpt',
  '/api/markets/batch-history',
  '/api/news/search',
  '/api/news/article',
  '/api/news/trending',
  // The categories the In the news filter suggests from, and widens by.
  '/api/news/categories',
  '/api/news/photos/person',
  '/api/news/photos/thumbs',
  '/api/charts/list-audio',
  '/api/charts/image-proxy',
  // The emoji a caption can carry, and which ones have been reached for before
  // — the captions rail reads and writes them (lib/emoji-prefs-store).
  '/api/emoji-prefs',
];

// Routes with something after them that still belong to the clipper: a saved
// recipe is fetched and deleted by its own code.
const CLIPPER_API_UNDER = ['/api/vids/recipes/'];

/** Files out of public/ — the outlet logos the news page draws, the songs, the
 *  BOOM, the Pauv marks on the trade. They come through middleware like
 *  anything else, and a clipper page with no logos and no sound is no page at
 *  all. Anything with a file extension is a file on disk: no page and no route
 *  handler in this app ends in one, so this can't widen past static assets. */
const looksLikeAFile = (p: string) => /\.[a-z0-9]+$/i.test(p);

function clipperAllows(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (CLIPPER_PAGES.includes(p)) return true;
  if (CLIPPER_API.includes(p)) return true;
  if (CLIPPER_API_UNDER.some((a) => p.startsWith(a))) return true;
  return looksLikeAFile(p);
}

export async function middleware(req: NextRequest) {
  // nextUrl.pathname is already basePath-relative, so these paths read the same
  // in both builds: '/clippers' here is pauv.io/clipping/clippers out there.
  const { pathname, search } = req.nextUrl;

  // Closed before the password is even looked at, so a probe of a route this
  // deployment does not serve learns nothing from being asked to unlock.
  if (CLIPPERS && !clipperAllows(pathname)) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'not found' }, { status: 404 })
      : new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }

  // The site root of the clipper deployment is the clipper page. Nothing links
  // to /clippers from out there — pauv.io/clipping is the whole address, and a
  // rewrite rather than a redirect is what keeps it that way: the clipper page
  // is served AT the root, so the address bar never picks up a second path.
  // What makes that safe to do from middleware — rather than from the routing
  // layer, where it used to live — is that the clipper build has no Studio to
  // serve if the gate is ever stepped around. See next.config.ts.
  const toClipperPage = () => {
    const url = req.nextUrl.clone();
    url.pathname = '/clippers';
    return NextResponse.rewrite(url);
  };

  const password = process.env.ACCESS_TOKEN;
  const secret = process.env.AUTH_SECRET || '';
  // Gate disabled unless BOTH are set — fail-open so a partial misconfig can't lock you out.
  if (!password || !secret) {
    return CLIPPERS && pathname === '/' ? toClipperPage() : NextResponse.next();
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const ok = await verifyToken(req.cookies.get(COOKIE_NAME)?.value, secret, SITE_SCOPE);
  if (ok) return CLIPPERS && pathname === '/' ? toClipperPage() : NextResponse.next();

  // Locked: JSON 401 for API calls, redirect to the unlock page for navigations.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'locked' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/unlock';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals, the favicon, and heavy upload endpoints
  // (mix-audio sends large video blobs — excluding it avoids Next's 10MB middleware body limit).
  //
  // '/' is listed separately and is NOT redundant. Next compiles these with
  // path-to-regexp, where the '(...)' below is a required parameter — it has to
  // match at least one character, so the pattern alone never matches the site
  // root. Without this line the root is the one path with no password gate, no
  // clipper allowlist and no rewrite: it served the whole Studio shell,
  // unauthenticated, at pauv.io/clipping.
  matcher: ['/', '/((?!_next/static|_next/image|favicon\\.ico|api/charts/mix-audio).*)'],
};
