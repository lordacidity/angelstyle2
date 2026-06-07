import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME, SITE_SCOPE } from '@/lib/auth';

// Site-wide password gate. Every route requires a signed `site_auth` cookie except the
// unlock UI/endpoint (and framework internals, excluded via the matcher). The cookie is
// minted by /api/unlock after the shared SITE_PASSWORD is entered. See src/lib/auth.ts.
//
// Fail-open if SITE_PASSWORD is unset, so a missing env var can't lock you out of your own
// site. On Vercel (the public deploy) the env vars are always present, so the gate is live.

const PUBLIC_PREFIXES = ['/unlock', '/api/unlock'];

export async function middleware(req: NextRequest) {
  const password = process.env.ACCESS_TOKEN;
  const secret = process.env.AUTH_SECRET || '';
  // Gate disabled unless BOTH are set — fail-open so a partial misconfig can't lock you out.
  if (!password || !secret) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const ok = await verifyToken(req.cookies.get(COOKIE_NAME)?.value, secret, SITE_SCOPE);
  if (ok) return NextResponse.next();

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
  // Run on everything except Next internals and the favicon (those never need the gate).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
