// /api/ai-persona/personas/:id/avatar
//
//   POST -> a new profile picture for the persona: its photo, redrawn by the
//           image model at medium as a funny square headshot, saved as a 512px
//           JPEG and shown round wherever the persona is listed. Answers with
//           the persona. Any picture it had before is replaced.
//
// Behind the site gate like every /api/* route.

import { NextResponse } from 'next/server';
import { avatarPath, personaPhoto, setAvatar } from '@/lib/aipersona/db';
import { makeAvatar } from '@/lib/aipersona/fal';
import { imageAt1080p } from '@/lib/aipersona/fit1080';
import { fail, refuse } from '@/lib/aipersona/respond';
import { isUuid, publicUrl, putObject } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  try {
    const photo = await personaPhoto(id);
    if (!photo) return refuse('That character no longer exists.', 404);
    const made = await makeAvatar(publicUrl(await imageAt1080p(photo)));
    const res = await fetch(made);
    if (!res.ok) throw new Error(`Could not fetch the picture fal made (${res.status}).`);
    const sharp = (await import('sharp')).default;
    const jpg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 88 })
      .toBuffer();
    const path = avatarPath(id);
    await putObject(path, jpg, 'image/jpeg');
    const persona = await setAvatar(id, path);
    return persona ? NextResponse.json(persona) : refuse('That character no longer exists.', 404);
  } catch (err) {
    return fail('avatar POST', err);
  }
}
