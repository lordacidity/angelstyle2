// POST /api/ai-persona/scenes/:id/approve
//
// Approve all: every persona's video is saved to that persona, and the scene
// is finished. From here the videos are found on the personas.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { loadScene, saveScene, toScene } from '@/lib/aipersona/db';
import { PersonaStateError, fail, refuse } from '@/lib/aipersona/respond';
import { isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  try {
    const scene = await loadScene(id);
    if (!scene) return refuse('That scene no longer exists.', 404);
    if (scene.stage === 'done') return NextResponse.json(toScene(scene));
    if (scene.stage !== 'videos') throw new PersonaStateError('There are no videos to approve yet.');
    if (!scene.takes.length || scene.takes.some((t) => t.video.status !== 'done')) {
      throw new PersonaStateError('Every character needs a finished video before they can all be approved. Take out any you are giving up on.');
    }
    await saveScene(id);
    return NextResponse.json(toScene({ ...scene, stage: 'done' }));
  } catch (err) {
    return fail('approve POST', err);
  }
}
