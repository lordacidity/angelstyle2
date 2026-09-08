// POST /api/vids/videos/sign { name, mime, withThumb, id? } — mint the id +
// signed bucket URLs for one clip. The browser PUTs the bytes straight to
// Supabase Storage, then registers the row with POST /api/vids/videos using the
// same id.
//
// Pass `id` to re-shoot an existing clip: the same row keeps its id (so every
// persona and folder pointing at it survives) and the new bytes go to a fresh
// path — `videos/<id>-<stamp>.mp4` — because reusing the old one would leave the
// public URL serving whatever the CDN and every open tab already cached. The
// old objects are dropped once the row has been repointed (PATCH … { media }).
import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { errMessage, signUpload } from '@/lib/vids-db';
import { isUuid } from '@/lib/vids-db';
import type { SignUploadResponse } from '@/lib/vids-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function extFor(name: string, mime: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  // A still is filed exactly like a clip — same bucket, same row, same id — and
  // only its type says it is one (see isPhoto).
  if (mime.startsWith('image/')) {
    const ext = mime.slice('image/'.length).replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5);
    return ext.length >= 2 ? ext.toLowerCase() : 'jpg';
  }
  return 'mp4';
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown; mime?: unknown; withThumb?: unknown; id?: unknown;
  };
  const name = typeof body.name === 'string' ? body.name : 'clip.mp4';
  const mime = typeof body.mime === 'string' && /^(video|image)\//.test(body.mime) ? body.mime : 'video/mp4';
  if (body.id !== undefined && !isUuid(body.id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }
  try {
    // Replacing an existing clip keeps its id and takes a fresh suffix; a brand
    // new one gets a new id and the plain path.
    const id = isUuid(body.id) ? body.id : randomUUID();
    const suffix = isUuid(body.id) ? `-${randomBytes(4).toString('hex')}` : '';
    const video = await signUpload(`videos/${id}${suffix}.${extFor(name, mime)}`);
    const thumb = body.withThumb ? await signUpload(`thumbs/${id}${suffix}.jpg`) : null;
    const res: SignUploadResponse = { id, video, thumb };
    return NextResponse.json(res);
  } catch (err) {
    console.error('[vids sign POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
