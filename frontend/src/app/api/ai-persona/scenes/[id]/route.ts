// /api/ai-persona/scenes/:id
//
//   GET               -> the scene as it stands. This is the poll, and the poll
//                        is what moves things: every job still running is
//                        looked up at fal, and one that has finished is copied
//                        into our bucket and marked done before the answer goes
//                        back. Nothing advances while nobody is looking — and
//                        nothing is lost either, since fal holds the result.
//   PATCH { stage }   -> `prompt`: the character first frames are approved, on
//                        to writing the Kling prompt. `frames`: back again.
//   DELETE            -> drop a scene that was never approved, files and all.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { deleteScene, loadScene, setStage, toScene } from '@/lib/aipersona/db';
import { PersonaStateError, fail, refuse } from '@/lib/aipersona/respond';
import { advance } from '@/lib/aipersona/scenes';
import { isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A poll that lands a finished video downloads it from fal and uploads it here.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };
const GONE = 'That scene no longer exists.';

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  try {
    const scene = await loadScene(id);
    if (!scene) return refuse(GONE, 404);
    const { changed, live } = await advance(scene);
    return NextResponse.json(toScene((changed && (await loadScene(id))) || scene, live));
  } catch (err) {
    return fail('scene GET', err);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  const { stage } = (await req.json().catch(() => ({}))) as { stage?: unknown };
  if (stage !== 'prompt' && stage !== 'frames') return refuse('stage must be prompt or frames.');
  try {
    const scene = await loadScene(id);
    if (!scene) return refuse(GONE, 404);
    if (stage === 'prompt') {
      if (scene.stage !== 'frames') throw new PersonaStateError('These first frames were already approved.');
      if (!scene.takes.length || scene.takes.some((t) => t.frame.status !== 'done')) {
        throw new PersonaStateError('Every character needs a finished first frame before they can be approved.');
      }
    } else if (scene.stage !== 'prompt') {
      throw new PersonaStateError('The videos are already under way.');
    }
    await setStage(id, stage);
    return NextResponse.json(toScene({ ...scene, stage }));
  } catch (err) {
    return fail('scene PATCH', err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  try {
    const scene = await loadScene(id);
    if (!scene) return refuse(GONE, 404);
    if (scene.stage === 'done') {
      throw new PersonaStateError('This scene was approved — its videos belong to the characters now. Delete them there.');
    }
    await deleteScene(scene);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail('scene DELETE', err);
  }
}
