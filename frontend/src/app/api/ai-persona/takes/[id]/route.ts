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
import { deleteTake } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
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
