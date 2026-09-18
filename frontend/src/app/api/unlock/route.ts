import { NextRequest, NextResponse } from 'next/server';
import {
  signToken,
  timingSafeEqualStr,
  COOKIE_NAME,
  SITE_SCOPE,
  COOKIE_TTL_MS,
} from '@/lib/auth';
import { BASE_PATH } from '@/lib/clipping';

// Verifies the shared site password and, on success, sets the signed `site_auth` cookie
// that the middleware checks on every other route.
export async function POST(req: NextRequest) {
  const password = process.env.ACCESS_TOKEN;
  const secret = process.env.AUTH_SECRET || '';
  if (!password || !secret) {
    return NextResponse.json({ error: 'gate not configured' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const submitted = body?.password;
  if (typeof submitted !== 'string' || !timingSafeEqualStr(submitted, password)) {
    return NextResponse.json({ error: 'wrong password' }, { status: 401 });
  }

  const token = await signToken({ scope: SITE_SCOPE, exp: Date.now() + COOKIE_TTL_MS }, secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // Scoped to what this deployment serves, not to the domain. The clipper
    // build sits under /clipping on pauv.io, which has a site of its own on the
    // same host — our cookie has no business being sent with its requests.
    path: BASE_PATH || '/',
    maxAge: Math.floor(COOKIE_TTL_MS / 1000),
  });
  return res;
}
