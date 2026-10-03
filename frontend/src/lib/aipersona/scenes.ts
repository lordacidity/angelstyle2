// What a scene does, as opposed to where it is kept (db.ts) or who it calls
// (fal.ts): queue a character first frame or a video for a take, and — on every
// poll — move along whatever fal has finished.
//
// Nothing here waits on fal. A job is queued and its request id written on the
// take; the section polls the scene, and each poll asks fal about the jobs
// still running. One that has finished is fetched from fal and copied into our
// own bucket, because fal's file URLs are not ours to keep.
//
// Server-only.

import { errMessage, publicUrl, putObject, removeObjects } from '@/lib/vids-db';
import { fitForKling } from './clip';
import { fit1080p, imageAt1080p, videoAt1080p } from './fit1080';
import { claimJob, jobDone, jobFailed, jobQueued, jobRefused, sceneFile, type Live, type SceneRecord, type TakeRecord } from './db';
import { jobResult, jobStatus, submitFrame, submitMotion, type JobKind } from './fal';

// Everything handed to fal is 1080p at most: the pictures and the clip go as
// 1080p copies when they are bigger (fit1080), and the frame is asked for at
// the clip's size brought inside 1080p.

/** Queue this take's character first frame. A refusal is written on the take
 *  rather than thrown: one persona's rejected photo shouldn't stop the rest. */
export async function queueFrame(scene: SceneRecord, take: TakeRecord, prompt: string): Promise<void> {
  try {
    const request = await submitFrame({
      frameUrl: publicUrl(await imageAt1080p(scene.framePath)), photoUrl: publicUrl(await imageAt1080p(take.photoPath)), prompt,
      ...fit1080p(scene.width, scene.height),
    });
    await jobQueued(take, 'frame', request, prompt);
  } catch (err) {
    await jobRefused(take, 'frame', errMessage(err), prompt);
  }
}

/** Queue this take's video: its character first frame, moved the way the
 *  scene's clip moves. */
export async function queueVideo(scene: SceneRecord, take: TakeRecord, prompt: string): Promise<void> {
  try {
    if (!take.frame.path) throw new Error('This character has no first frame to animate.');
    const request = await submitMotion({
      imageUrl: publicUrl(await imageAt1080p(take.frame.path)),
      videoUrl: publicUrl(await videoAt1080p(scene.clipPath, scene.width, scene.height, scene.duration)),
      prompt,
    });
    await jobQueued(take, 'video', request, prompt);
  } catch (err) {
    await jobRefused(take, 'video', errMessage(err), prompt);
  }
}

const EXTENSION: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

/** Copy what fal made into our bucket, byte for byte. Each result gets a path
 *  of its own, so a redo is never served the last one out of a cache. The one
 *  thing ever altered is a character first frame too big for Kling to take as
 *  its image — see fitForKling. */
async function keep(url: string, scene: SceneRecord, take: TakeRecord, kind: JobKind): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fal did not serve the file (${res.status})`);
  const fallback = kind === 'frame' ? 'image/png' : 'video/mp4';
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const made = { body: Buffer.from(await res.arrayBuffer()), contentType: EXTENSION[type] ? type : fallback };
  const { body, contentType } = kind === 'frame' ? await fitForKling(made.body, made.contentType) : made;
  const path = sceneFile(scene.id, `${take.id}-${kind}-${Date.now().toString(36)}.${EXTENSION[contentType]}`);
  await putObject(path, body, contentType);
  return path;
}

/** fal has no record of the request, so waiting longer won't help. Anything
 *  else that goes wrong asking — a timeout, a 5xx, a rate limit — says nothing
 *  about the job, which is left running. */
const isGone = (err: unknown) => [404, 422].includes((err as { status?: number })?.status ?? 0);

/** Ask fal about every running job in the scene and land the ones that are
 *  finished. `changed` says a row was written, so the scene wants reading
 *  again; `live` carries what is only true right now (queue places). */
export async function advance(scene: SceneRecord): Promise<{ changed: boolean; live: Live }> {
  const live: Live = new Map();
  let changed = false;

  const jobs = scene.takes.flatMap((take) => (['frame', 'video'] as const).map((kind) => ({ take, kind })));
  await Promise.all(jobs.map(async ({ take, kind }) => {
    const { status, request } = take[kind];
    if (status !== 'running' || !request) return;
    const key = `${take.id}:${kind}`;

    let state;
    try {
      state = await jobStatus(kind, request);
    } catch (err) {
      if (isGone(err)) {
        await jobFailed(take.id, kind, request, errMessage(err));
        changed = true;
      } else {
        live.set(key, { queue: null, working: false, note: errMessage(err) });
      }
      return;
    }
    if (!state.finished) {
      live.set(key, { queue: state.queue, working: state.working });
      return;
    }
    // Finished, and another poll is already filing it.
    if (!(await claimJob(take.id, kind, request))) {
      live.set(key, { queue: null, working: true });
      return;
    }

    changed = true;
    let url: string;
    try {
      url = await jobResult(kind, request);
    } catch (err) {
      await jobFailed(take.id, kind, request, errMessage(err));
      return;
    }
    try {
      const path = await keep(url, scene, take, kind);
      if (!(await jobDone(take.id, kind, request, path))) await removeObjects([path]);
    } catch (err) {
      // It was made, and paid for — say where it is rather than lose it.
      await jobFailed(take.id, kind, request, `It was made, but could not be saved here: ${errMessage(err)}. For now it is at ${url}`);
    }
  }));

  return { changed, live };
}
