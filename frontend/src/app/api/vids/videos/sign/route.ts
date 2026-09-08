// POST /api/vids/videos/sign { name, mime, withThumb, withSource, id? } — mint
// the id + signed bucket URLs for one clip. `withSource` adds a target for the
// recording the uploaded render was made from (`sources/<id>.<ext>`), which the
// intake run sends up beside the render so the clip can be re-edited from it. The browser PUTs the bytes straight to
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
    name?: unknown; mime?: unknown; withThumb?: unknown; withSource?: unknown; sourceName?: unknown; id?: unknown;
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
    // The recording keeps its own extension: it is whatever was dropped in,
    // not the MP4 the render came out as.
    const sourceName = typeof body.sourceName === 'string' ? body.sourceName : name;
    const source = body.withSource
      ? await signUpload(`sources/${id}${suffix}.${extFor(sourceName, 'video/mp4')}`)
      : null;
    const res: SignUploadResponse = { id, video, thumb, source };
    return NextResponse.json(res);
  } catch (err) {
    console.error('[vids sign POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
