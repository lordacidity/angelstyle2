// DELETE /api/ai-persona/takes/:id
//
// A take is one persona's run through one scene. While the scene is in
// progress, deleting it takes that persona out of the scene. Once the scene is
// approved, the take is the persona's saved video, and this deletes the video.
// Either way its files go too. A job still running at fal is simply never
// collected.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { deleteTake, markTakeUsed, renameTake } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
import { MAX_NAME_CHARS } from '@/lib/aipersona/types';
import { isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  try {
    return (await deleteTake(id)) ? NextResponse.json({ ok: true }) : refuse('That is already gone.', 404);
  } catch (err) {
    return fail('takes DELETE', err);
  }
}

/** PATCH { name } — rename a saved video. Only that character's video of the
 *  scene is renamed.
 *  PATCH { usedIn } — note the persona video in Vids it was the start of. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; usedIn?: unknown };
  if (body.usedIn !== undefined) {
    if (!isUuid(body.usedIn)) return refuse('bad persona video id');
    try {
      return (await markTakeUsed(id, body.usedIn)) ? NextResponse.json({ ok: true }) : refuse('That video is gone.', 404);
    } catch (err) {
      return fail('takes PATCH', err);
    }
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_CHARS) : '';
  if (!name) return refuse('A video needs a name.');
  try {
    return (await renameTake(id, name)) ? NextResponse.json({ ok: true }) : refuse('That video is gone.', 404);
  } catch (err) {
    return fail('takes PATCH', err);
  }
}
