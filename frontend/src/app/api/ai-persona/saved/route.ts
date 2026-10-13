// /api/ai-persona/saved
//
//   POST { name, action?, sourcePath, start, end, speed }  -> a saved scene.
//         `action` is the sentence saying what happens in it, which the Kling
//         prompt of every scene made from it will open with. The
//         uploaded video is cut to the trim and the speed and its first frame
//         pulled out, exactly as Go does for a new scene (lib/aipersona/clip) —
//         and that is all: no character is drawn and nothing goes to fal. It
//         is kept to be made into a scene for any character later, from that
//         character's page (POST /api/ai-persona/personas/:id/scenes).
//
// The saved scenes are listed with everything else, by GET
// /api/ai-persona/personas.
//
// Behind the site gate like every /api/* route.

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cutClip } from '@/lib/aipersona/clip';
import { createSaved, isSourcePath, savedFile } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
import { MAX_NAME_CHARS, MAX_SPEED, MIN_SPEED, cleanAction } from '@/lib/aipersona/types';
import { publicUrl, putObject, removeObjects } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_CHARS),
  action: z.string().max(2000).default(''),
  sourcePath: z.string().refine(isSourcePath),
  start: z.number().min(0),
  end: z.number().positive(),
  speed: z.number().min(MIN_SPEED).max(MAX_SPEED),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse('A saved scene needs a name, an uploaded video, a trim and a speed.');
  const { name, sourcePath, start, end, speed } = parsed.data;
  const action = cleanAction(parsed.data.action);

  const id = randomUUID();
  const clipPath = savedFile(id, 'clip.mp4');
  const framePath = savedFile(id, 'frame.png');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-persona-'));
  try {
    const cut = await cutClip({ sourceUrl: publicUrl(sourcePath), dir, start, end, speed });
    await Promise.all([
      putObject(clipPath, await readFile(cut.clipPath), 'video/mp4'),
      putObject(framePath, await readFile(cut.framePath), 'image/png'),
    ]);
    let saved;
    try {
      saved = await createSaved({ id, name, action, clipPath, framePath, width: cut.width, height: cut.height, duration: cut.duration });
    } catch (err) {
      await removeObjects([clipPath, framePath]);
      throw err;
    }
    // The upload has been cut; the cut is what is kept.
    await removeObjects([sourcePath]);
    return NextResponse.json(saved);
  } catch (err) {
    return fail('saved POST', err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
