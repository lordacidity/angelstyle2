// The Aiden section's own lock, on top of the site-wide one.
//
// The site password (middleware.ts) lets the whole team into the Studio. This
// section is one person's private network log, so it has a second lock of its
// own, and every /api/aiden route but the unlock endpoint checks it itself: the
// data is closed at the server and not merely hidden by the page.
//
// There are two keys to that lock:
//
//   AIDEN_PASSWORD   typed into the page. Unlocking sets a signed cookie.
//   AIDEN_API_TOKEN  sent as `Authorization: Bearer <token>` by Parvis (the
//                    agent in Desktop/jarvis) and anything else with no browser.
//                    It opens every /api/aiden route: read, write, delete, chat.
//
// Fail-CLOSED, unlike the site gate: a key that is unset opens nothing. Both
// live in the environment only. This repo is public, so neither may ever be
// written into a source file.
//
// Web Crypto only, nothing from Node: middleware imports this too.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualStr, verifyToken } from '@/lib/auth';

export const AIDEN_COOKIE = 'aiden_auth';
export const AIDEN_SCOPE = 'aiden';
export const AIDEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// A token short enough to guess is treated as no token at all.
const MIN_TOKEN_LENGTH = 32;

export function aidenPassword(): string {
  return process.env.AIDEN_PASSWORD ?? '';
}

/** What the cookie is signed with. AUTH_SECRET where the deployment has one;
 *  otherwise the password itself, which is no weaker: whoever knows it could
 *  simply unlock. */
export function aidenSecret(): string {
  return process.env.AUTH_SECRET || aidenPassword();
}

/** Does this request carry the API token. */
export function hasAidenToken(req: NextRequest): boolean {
  const token = process.env.AIDEN_API_TOKEN ?? '';
  if (token.length < MIN_TOKEN_LENGTH) return false;
  const given = /^Bearer\s+(\S+)$/i.exec((req.headers.get('authorization') ?? '').trim())?.[1] ?? '';
  return given.length > 0 && timingSafeEqualStr(given, token);
}

export async function isAidenUnlocked(req: NextRequest): Promise<boolean> {
  if (hasAidenToken(req)) return true;
  if (!aidenPassword()) return false;
  const cookie = req.cookies.get(AIDEN_COOKIE)?.value;
  return (await verifyToken(cookie, aidenSecret(), AIDEN_SCOPE)) !== null;
}

export function aidenLocked(): NextResponse {
  return NextResponse.json({ error: 'locked' }, { status: 401 });
}
