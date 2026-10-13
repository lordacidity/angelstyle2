// POST /api/ai-persona/personas/:id/scenes { savedIds, prompt, useLocation?, locationPrompt? }
//
// "Make scenes", from a character's page: New scene the other way round. There
// one video takes every character picked; here one character takes every saved
// scene picked. Each saved scene becomes a scene of its own with this one
// character in it — its clip and first frame copied across inside the bucket,
// so the saved scene is left as it was — and its character first frame is
// queued at fal. From there each is an ordinary scene: reviewed, given its
// Kling prompt, approved (SceneReview).
//
// A scene takes its saved scene's name, and that name is what files the video
// on the character's page: "trading" in it makes a Trading video, "end" an End,
// anything else a Hook (sceneKind).
//
// One saved scene failing does not stop the rest: the answer lists the scenes
// that were made and, by name, the ones that were not.
//
// Behind the site gate like every /api/* route.

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createScene, loadSaved, loadScene, sceneFile, toScene } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
import { queueFrame } from '@/lib/aipersona/scenes';
import { MAX_FRAME_PROMPT_CHARS, motionPrompt, type Scene } from '@/lib/aipersona/types';
import { copyObject, errMessage, isUuid, removeObjects } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  savedIds: z.array(z.string().refine(isUuid)).min(1).max(100),
  prompt: z.string().trim().min(1).max(MAX_FRAME_PROMPT_CHARS),
  useLocation: z.boolean().default(false),
  locationPrompt: z.string().trim().max(MAX_FRAME_PROMPT_CHARS).default(''),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: personaId } = await params;
  if (!isUuid(personaId)) return refuse('bad id');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse('Making scenes needs at least one saved scene and a prompt.');
  const { savedIds, prompt, useLocation, locationPrompt } = parsed.data;
  if (useLocation && !locationPrompt) return refuse('The first-frame prompt with location is empty.');

  try {
    const saved = await loadSaved(savedIds);
    if (!saved.length) return refuse('None of those saved scenes exist any more.', 404);

    const made: Scene[] = [];
    const failed: { name: string; error: string }[] = [];
    await Promise.all(saved.map(async (s) => {
      const id = randomUUID();
      const clipPath = sceneFile(id, 'clip.mp4');
      const framePath = sceneFile(id, 'frame.png');
      try {
        await Promise.all([copyObject(s.clipPath, clipPath), copyObject(s.framePath, framePath)]);
        const scene = await createScene({
          id, name: s.name, clipPath, framePath, width: s.width, height: s.height, duration: s.duration,
          framePrompt: prompt, personaIds: [personaId],
          // The sentence written on the saved scene: the Kling prompt arrives
          // filled in. Without one it arrives with the blank, as ever.
          videoPrompt: s.action ? motionPrompt(s.action) : '',
          locationPrompt: useLocation ? locationPrompt : '', locationIds: useLocation ? [personaId] : [],
        });
        // A character with no room is made the ordinary way — see createScene.
        await Promise.all(scene.takes.map((take) => queueFrame(scene, take, take.useRoom ? locationPrompt : prompt)));
        made.push(toScene((await loadScene(id)) ?? scene));
      } catch (err) {
        await removeObjects([clipPath, framePath]);
        failed.push({ name: s.name, error: errMessage(err) });
      }
    }));

    if (!made.length) return refuse(failed[0]?.error ?? 'No scene could be made.', 500);
    // In the order they were saved, whichever finished first.
    const order = new Map(saved.map((s, i) => [s.name, i]));
    made.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
    return NextResponse.json({ scenes: made, failed });
  } catch (err) {
    return fail('persona scenes POST', err);
  }
}
