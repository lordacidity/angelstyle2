// /api/ai-persona/thumb?p=<character photo path>
//
//   GET -> a redirect to a small JPEG of the photo, made the first time it is
//          asked for and kept in the bucket beside the original. The front
//          screen lists every character at once, and a screen of full-size
//          photos (some tens of megabytes) is what made it crawl.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { isFramePath, isPhotoPath } from '@/lib/aipersona/db';
import { imageThumb } from '@/lib/aipersona/fit1080';
import { refuse } from '@/lib/aipersona/respond';
import { publicUrl } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('p');
  // A character photo, or the first frame one of its saved videos was made
  // from — a character's page lists its videos by those.
  if (!isPhotoPath(path) && !isFramePath(path)) return refuse('Not a character photo.');
  const thumb = await imageThumb(path);
  return NextResponse.redirect(publicUrl(thumb), {
    status: 302,
    // The thumbnail at a given path never changes, so the browser may keep the answer.
    headers: { 'Cache-Control': 'private, max-age=86400' },
  });
}
