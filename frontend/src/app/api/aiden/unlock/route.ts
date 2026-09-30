// /api/aiden/unlock — the Aiden section's own lock (see lib/aiden-auth).
//   GET    is it unlocked in this browser, and is a password configured at all
//   POST   { password } → sets the signed aiden_auth cookie
//   DELETE locks it again
import { NextRequest, NextResponse } from 'next/server';
import { signToken, timingSafeEqualStr } from '@/lib/auth';
import {
  AIDEN_COOKIE, AIDEN_SCOPE, AIDEN_TTL_MS, aidenPassword, aidenSecret, isAidenUnlocked,
} from '@/lib/aiden-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return NextResponse.json({
    configured: Boolean(aidenPassword()),
    unlocked: await isAidenUnlocked(req),
  });
}

export async function POST(req: NextRequest) {
  const password = aidenPassword();
  if (!password) {
    return NextResponse.json({ error: 'AIDEN_PASSWORD is not set' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const submitted = body?.password;
  if (typeof submitted !== 'string' || !timingSafeEqualStr(submitted, password)) {
    return NextResponse.json({ error: 'wrong password' }, { status: 401 });
  }

  const token = await signToken({ scope: AIDEN_SCOPE, exp: Date.now() + AIDEN_TTL_MS }, aidenSecret());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AIDEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(AIDEN_TTL_MS / 1000),
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AIDEN_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
