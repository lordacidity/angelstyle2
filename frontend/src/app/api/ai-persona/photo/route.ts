// POST /api/ai-persona/photo — the portrait the persona wears.
//
// Takes the file itself (multipart, field `photo`), puts it on fal storage and
// answers with the public URL. Kling can only read an avatar from a URL, and
// the browser has no fal credentials, so the upload has to come through here.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { upload } from '@/lib/aipersona/fal';
import { MAX_PHOTO_BYTES, PHOTO_TYPES, type PhotoResponse } from '@/lib/aipersona/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let photo: unknown;
  try {
    photo = (await req.formData()).get('photo');
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form with a photo.' }, { status: 400 });
  }

  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: 'No photo in the request.' }, { status: 400 });
  }
  if (!PHOTO_TYPES.includes(photo.type)) {
    return NextResponse.json(
      { error: `Kling reads JPEG, PNG, WebP, GIF or AVIF — this one is ${photo.type || 'of no stated type'}.` },
      { status: 400 },
    );
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: `That photo is ${(photo.size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_PHOTO_BYTES / 1024 / 1024}MB.` },
      { status: 413 },
    );
  }

  try {
    const imageUrl = await upload(photo, 'photo upload');
    return NextResponse.json({ imageUrl } satisfies PhotoResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
