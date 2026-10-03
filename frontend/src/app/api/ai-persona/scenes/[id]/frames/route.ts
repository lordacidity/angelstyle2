// POST /api/ai-persona/scenes/:id/frames { takeId, prompt }
//
// Regenerate one persona's character first frame, with a prompt written for
// just this redo. The scene's own prompt is left as it was. Also how a frame
// that failed is tried again.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { loadScene, toScene } from '@/lib/aipersona/db';
import { PersonaStateError, fail, refuse } from '@/lib/aipersona/respond';
import { queueFrame } from '@/lib/aipersona/scenes';
import { MAX_PROMPT_CHARS } from '@/lib/aipersona/types';
import { isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS) : '';
  if (!prompt) return refuse('The prompt is empty.');

  try {
    const scene = await loadScene(id);
    if (!scene) return refuse('That scene no longer exists.', 404);
    const take = scene.takes.find((t) => t.id === body.takeId);
    if (!take) return refuse('That character is not in this scene.', 404);
    if (scene.stage !== 'frames' && scene.stage !== 'prompt') {
      throw new PersonaStateError('The videos are already under way — the first frames are settled.');
    }
    if (take.frame.status === 'running') throw new PersonaStateError('This one is still being made.');

    await queueFrame(scene, take, prompt);
    return NextResponse.json(toScene((await loadScene(id)) ?? scene));
  } catch (err) {
    return fail('frames POST', err);
  }
}
