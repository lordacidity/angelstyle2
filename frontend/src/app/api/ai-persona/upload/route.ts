// POST /api/ai-persona/upload { kind, name, mime } -> { path, url }
//
// Mints a signed URL for one file. The browser PUTs the bytes straight to the
// bucket — a scene's video is far past what a request body through the site
// gate should carry — and then hands the path back to whichever route wanted
// the file: a `photo` to the personas routes, a `source` to POST scenes.
//
// Behind the site gate like every /api/* route.

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { photoPath, sourcePath } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
import { PHOTO_TYPES, type UploadResponse } from '@/lib/aipersona/types';
import { signUpload } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function videoExt(name: string, mime: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  return 'mp4';
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name : '';
  const mime = typeof body.mime === 'string' ? body.mime : '';

  let path: string;
  if (body.kind === 'photo') {
    if (!PHOTO_TYPES.includes(mime)) return refuse(`A character photo is a JPEG, PNG or WebP — this one is ${mime || 'of no stated type'}.`);
    path = photoPath(randomUUID(), PHOTO_EXT[mime]);
  } else if (body.kind === 'source') {
    if (!mime.startsWith('video/')) return refuse(`A scene is cut from a video — this one is ${mime || 'of no stated type'}.`);
    path = sourcePath(randomUUID(), videoExt(name, mime));
  } else {
    return refuse('kind must be photo or source.');
  }

  try {
    return NextResponse.json((await signUpload(path)) satisfies UploadResponse);
  } catch (err) {
    return fail('upload POST', err);
  }
}
