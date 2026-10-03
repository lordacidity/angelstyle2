// The two fal.ai models behind AI Persona, and nothing else. Server-only —
// FAL_KEY never reaches the browser.
//
//   submitFrame   first frame + character photo -> GPT Image edit, queued
//   submitMotion  character first frame + clip  -> Kling motion control, queued
//   jobStatus / jobResult   where a queued job got to, and what it made
//
// Both are queued rather than awaited. A Kling video is minutes away and an
// image can be a minute or more — far past any request timeout — and a scene
// runs one of each for every persona in it. The request id is kept on the take
// (lib/aipersona/db), so a job outlives a page reload.
//
// Everything fal reads comes from a public URL in our own bucket, so nothing is
// uploaded to fal storage. Both models are called with fal's own defaults bar
// what is spelled out below.

import { fal } from '@fal-ai/client';
import { fit1080p } from './fit1080';
import { FRAME_MODEL, FRAME_QUALITY, MOTION_MODEL } from './types';

export type JobKind = 'frame' | 'video';
const MODEL: Record<JobKind, string> = { frame: FRAME_MODEL, video: MOTION_MODEL };

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!process.env.FAL_KEY) {
    throw new Error('FAL_KEY is not set. Put it in the repo-root .env and restart the dev server.');
  }
  fal.config({ credentials: process.env.FAL_KEY });
  configured = true;
}

/** fal throws ApiError with the real reason buried in `.body` — usually a
 *  moderation rejection, a validation complaint or an empty balance. Dig it out
 *  so the card shows something you can act on instead of a bare "Forbidden".
 *  (Same treatment as src/lib/aier/fal.js, which talks to Kling's other model.) */
function falError(err: unknown, label: string): Error & { status?: number } {
  const e = err as { status?: number; message?: string; body?: unknown; response?: { status?: number; data?: unknown } };
  const status = e?.status ?? e?.response?.status;
  console.error(`[fal:${label}] status=${status}`, 'body=', JSON.stringify(e?.body ?? e?.response?.data ?? null));

  const body = e?.body as { detail?: unknown; message?: unknown } | undefined;
  let detail: unknown = body?.detail ?? body?.message ?? e?.body ?? e?.response?.data;
  if (Array.isArray(detail)) {
    detail = detail.map(d => (d as { msg?: string; message?: string })?.msg || (d as { message?: string })?.message || JSON.stringify(d)).join('; ');
  }
  if (detail && typeof detail === 'object') detail = JSON.stringify(detail).slice(0, 600);

  const base = e?.message || `${label} failed`;
  let msg = base;
  if (status) msg += ` (HTTP ${status})`;
  if (detail && String(detail) !== base) msg += ` — ${detail}`;
  if (status === 403) {
    msg += '  · a 403 here is usually moderation rejecting the picture, or a fal account out of credits / a bad FAL_KEY.';
  }
  const out = new Error(msg) as Error & { status?: number };
  out.status = status;
  return out;
}

// What GPT Image will draw at: each side a multiple of 16 and no longer than
// 3840, and between these many pixels in all. It is asked for no more than
// 1080p (fit1080), so the 3840 never comes into it.
const IMAGE_STEP = 16;
const IMAGE_MAX_SIDE = 3840;
const IMAGE_MIN_PIXELS = 655_360;
const IMAGE_MAX_PIXELS = 8_294_400;

/** The size the character first frame is asked for at: the clip's own, pixel
 *  for pixel as near as the model allows. Not one of the model's named sizes,
 *  which are a fixed handful of shapes at resolutions fal doesn't publish, and
 *  not `auto`, which leaves the resolution to the model — the frame has to
 *  come back as sharp as the video it stands at the front of. */
export function imageSizeFor(width: number, height: number): { width: number; height: number } | 'auto' {
  if (!(width > 0 && height > 0)) return 'auto';
  const scale = Math.min(
    Math.max(1, Math.sqrt(IMAGE_MIN_PIXELS / (width * height))),
    IMAGE_MAX_SIDE / Math.max(width, height),
    fit1080p(width, height).width / width,
    Math.sqrt(IMAGE_MAX_PIXELS / (width * height)),
  );
  // Down to the step, not to the nearest: 1080 would otherwise round up to 1088.
  const snap = (v: number) => Math.max(IMAGE_STEP, Math.floor((v * scale) / IMAGE_STEP) * IMAGE_STEP);
  const size = { width: snap(width), height: snap(height) };
  // Rounding to the step can carry a size that sat on a limit just past it.
  const long = size.width >= size.height ? 'width' : 'height';
  while (size.width * size.height > IMAGE_MAX_PIXELS) size[long] -= IMAGE_STEP;
  while (size.width * size.height < IMAGE_MIN_PIXELS) size[long] += IMAGE_STEP;
  return size;
}

/** Queue a character first frame. The two pictures go in the order the prompt
 *  names them: the scene's first frame is #image1, the character photo #image2.
 *  Both are sent as they are — the frame a lossless PNG at the clip's own
 *  resolution, the photo the very file that was uploaded — and the answer is
 *  asked for as a PNG at the clip's size, so nothing is compressed on the way
 *  in or on the way out. */
export async function submitFrame({ frameUrl, photoUrl, prompt, width, height }: {
  frameUrl: string; photoUrl: string; prompt: string; width: number; height: number;
}): Promise<string> {
  ensureConfigured();
  try {
    const { request_id } = await fal.queue.submit(FRAME_MODEL, {
      input: {
        prompt,
        image_urls: [frameUrl, photoUrl],
        image_size: imageSizeFor(width, height),
        quality: FRAME_QUALITY,
        output_format: 'png',
      },
    });
    return request_id;
  } catch (err) {
    throw falError(err, 'image submit');
  }
}

/** Queue a video. The character always takes the video's orientation (the
 *  mode that allows up to 30 seconds), and the clip's own sound is kept. */
export async function submitMotion({ imageUrl, videoUrl, prompt }: {
  imageUrl: string; videoUrl: string; prompt: string;
}): Promise<string> {
  ensureConfigured();
  try {
    const { request_id } = await fal.queue.submit(MOTION_MODEL, {
      input: { image_url: imageUrl, video_url: videoUrl, prompt, character_orientation: 'video', keep_original_sound: true },
    });
    return request_id;
  } catch (err) {
    throw falError(err, 'kling submit');
  }
}

export interface JobState {
  /** fal has finished with it — which is not the same as it having worked;
   *  jobResult is where a failure surfaces. */
  finished: boolean;
  /** A machine has picked it up. */
  working: boolean;
  /** Its place in fal's queue, while it is still waiting for a machine. */
  queue: number | null;
}

/** Where a queued job has got to. A throw carries fal's HTTP status as
 *  `.status`, so the caller can tell a job fal has no record of from a blip. */
export async function jobStatus(kind: JobKind, requestId: string): Promise<JobState> {
  ensureConfigured();
  try {
    const s = await fal.queue.status(MODEL[kind], { requestId });
    return {
      finished: s.status === 'COMPLETED',
      working: s.status === 'IN_PROGRESS',
      queue: s.status === 'IN_QUEUE' ? s.queue_position ?? null : null,
    };
  } catch (err) {
    throw falError(err, `${kind} status`);
  }
}

/** The URL of what a finished job made, on fal's own storage. Only call this
 *  once the status says finished — a job that failed throws here, with the
 *  reason. */
export async function jobResult(kind: JobKind, requestId: string): Promise<string> {
  ensureConfigured();
  let data: { images?: { url?: string }[]; video?: { url?: string } };
  try {
    ({ data } = await fal.queue.result(MODEL[kind], { requestId }));
  } catch (err) {
    throw falError(err, `${kind} result`);
  }
  const url = kind === 'frame' ? data?.images?.[0]?.url : data?.video?.url;
  if (!url) throw new Error(`fal returned no ${kind === 'frame' ? 'image' : 'video'}. Raw: ${JSON.stringify(data).slice(0, 400)}`);
  return url;
}
