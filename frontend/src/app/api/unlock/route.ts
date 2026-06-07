import { NextRequest, NextResponse } from 'next/server';
import {
  signToken,
  timingSafeEqualStr,
  COOKIE_NAME,
  SITE_SCOPE,
  COOKIE_TTL_MS,
} from '@/lib/auth';

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
    path: '/',
    maxAge: Math.floor(COOKIE_TTL_MS / 1000),
  });
  return res;
}
