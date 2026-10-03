// POST /api/ai-persona/scenes/:id/videos { prompt, takeId? }
//
//   without takeId  Go, the second time: the first frames are approved and the
//                   prompt is written, so Kling is queued for every persona —
//                   its character first frame, moved the way the clip moves.
//   with takeId     regenerate that one persona's video, with a prompt written
//                   for just this redo.
//
// A prompt that still has a bracket in it has not been filled in, and is turned
// away: the default is "A man [what he is doing]", and Kling is not to be run
// on the blank.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { loadScene, setStage, toScene } from '@/lib/aipersona/db';
import { PersonaStateError, fail, refuse } from '@/lib/aipersona/respond';
import { queueVideo } from '@/lib/aipersona/scenes';
import { MAX_PROMPT_CHARS, hasBlank } from '@/lib/aipersona/types';
import { isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A scene cut at 4K before the 1080p cap has its clip brought down to 1080p
// the first time a video is made from it (lib/aipersona/fit1080), which can
// take a minute or more.
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS) : '';
  if (!prompt) return refuse('The prompt is empty.');
  if (hasBlank(prompt)) return refuse('Replace the brackets with what he is doing first.');

  try {
    const scene = await loadScene(id);
    if (!scene) return refuse('That scene no longer exists.', 404);

    if (body.takeId !== undefined) {
      const take = scene.takes.find((t) => t.id === body.takeId);
      if (!take) return refuse('That character is not in this scene.', 404);
      if (scene.stage !== 'videos') throw new PersonaStateError('There is no video of this one to redo yet.');
      if (take.video.status === 'running') throw new PersonaStateError('This one is still being made.');
      await queueVideo(scene, take, prompt);
    } else {
      if (scene.stage !== 'prompt') {
        throw new PersonaStateError(scene.stage === 'frames' ? 'Approve the first frames first.' : 'The videos are already under way.');
      }
      if (!scene.takes.length || scene.takes.some((t) => t.frame.status !== 'done')) {
        throw new PersonaStateError('Every character needs a finished first frame first.');
      }
      await setStage(id, 'videos', prompt);
      await Promise.all(scene.takes.map((take) => queueVideo(scene, take, prompt)));
    }
    return NextResponse.json(toScene((await loadScene(id)) ?? scene));
  } catch (err) {
    return fail('videos POST', err);
  }
}
