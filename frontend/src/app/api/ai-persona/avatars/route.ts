// /api/ai-persona/avatars
//
//   GET -> [{ name, avatarUrl }] for every persona with a profile picture, so
//          other sections that list the same people (Vids2) can show it. They
//          match on the name, the way Vids files a persona's videos.
//
// Behind the site gate like every /api/* route.

import { NextResponse } from 'next/server';
import { listAvatars } from '@/lib/aipersona/db';
import { fail } from '@/lib/aipersona/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listAvatars());
  } catch (err) {
    return fail('avatars GET', err);
  }
}
