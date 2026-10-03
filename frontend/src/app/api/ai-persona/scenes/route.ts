// POST /api/ai-persona/scenes { name, sourcePath, start, end, speed, prompt, personaIds }
//
// Go. The uploaded video is cut to the trim and the speed, the very first frame
// of that cut is pulled out, and a character first frame is queued at fal for
// every persona in the scene. Answers with the scene, its frames all running;
// the section polls GET /api/ai-persona/scenes/:id from there.
//
// The cut is done here, with ffmpeg, rather than in the browser: what Kling
// follows later and the frame the image model redraws now have to be the same
// file's first frame, exactly.
//
// Behind the site gate like every /api/* route.

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cutClip } from '@/lib/aipersona/clip';
import { createScene, isSourcePath, loadScene, sceneFile, toScene } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
import { queueFrame } from '@/lib/aipersona/scenes';
import { MAX_NAME_CHARS, MAX_PROMPT_CHARS, MAX_SPEED, MIN_SPEED } from '@/lib/aipersona/types';
import { isUuid, publicUrl, putObject, removeObjects } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_CHARS),
  sourcePath: z.string().refine(isSourcePath),
  start: z.number().min(0),
  end: z.number().positive(),
  speed: z.number().min(MIN_SPEED).max(MAX_SPEED),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
  personaIds: z.array(z.string().refine(isUuid)).min(1).max(100),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return refuse('A scene needs a name, an uploaded video, a trim, a speed, a prompt and at least one character.');
  }
  const { name, sourcePath, start, end, speed, prompt, personaIds } = parsed.data;

  const id = randomUUID();
  const clipPath = sceneFile(id, 'clip.mp4');
  const framePath = sceneFile(id, 'frame.png');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-persona-'));
  try {
    const cut = await cutClip({ sourceUrl: publicUrl(sourcePath), dir, start, end, speed });
    await Promise.all([
      putObject(clipPath, await readFile(cut.clipPath), 'video/mp4'),
      putObject(framePath, await readFile(cut.framePath), 'image/png'),
    ]);

    let scene;
    try {
      scene = await createScene({
        id, name, clipPath, framePath, width: cut.width, height: cut.height, duration: cut.duration,
        framePrompt: prompt, personaIds,
      });
    } catch (err) {
      await removeObjects([clipPath, framePath]);
      throw err;
    }

    await Promise.all(scene.takes.map((take) => queueFrame(scene, take, prompt)));
    // The upload has been cut; the cut is what the scene keeps.
    await removeObjects([sourcePath]);
    return NextResponse.json(toScene((await loadScene(id)) ?? scene));
  } catch (err) {
    return fail('scenes POST', err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
