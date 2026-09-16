// The three fal.ai calls behind AI Persona, and nothing else. Server-only —
// FAL_KEY never reaches the browser.
//
//   upload        the portrait, or an uploaded voice -> fal storage, so Kling has a URL to read
//   speak         the script   -> ElevenLabs v3, one mp3 back (skipped when a voice is uploaded)
//   submitAvatar  photo + mp3  -> Kling AI Avatar, queued (it takes minutes)
//   avatarStatus / avatarResult   where that job got to, and the mp4
//
// Kling is queued rather than awaited because a finished video can be several
// minutes away — far past any request timeout. The section polls instead, so a
// job survives a page reload and a slow queue can't hang a route handler.
//
// Both models are called with fal's own defaults. The only two departures are
// deliberate and spelled out below: the voice is Liam, and Kling gets no prompt.

import { fal } from '@fal-ai/client';
import { AVATAR_MODEL, TTS_MODEL, VOICE } from './types';

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
function falError(err: unknown, label: string): Error {
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
    msg += '  · a 403 here is usually moderation rejecting the photo, or a fal account out of credits / a bad FAL_KEY.';
  }
  const out = new Error(msg) as Error & { status?: number };
  out.status = status;
  return out;
}

/** Put an uploaded file — the portrait, or a recording of the voice — on fal
 *  storage and hand back its public URL. */
export async function upload(file: File, label = 'upload'): Promise<string> {
  ensureConfigured();
  try {
    return await fal.storage.upload(file);
  } catch (err) {
    throw falError(err, label);
  }
}

/** Read `text` aloud as Liam. Everything else is ElevenLabs' default: the
 *  stability, the normalisation, the language — we send the text and the voice
 *  and nothing more. */
export async function speak(text: string): Promise<{ audioUrl: string; ms: number }> {
  ensureConfigured();
  const t0 = Date.now();
  try {
    const { data } = await fal.subscribe(TTS_MODEL, { input: { text, voice: VOICE } });
    const audioUrl = data?.audio?.url;
    if (!audioUrl) throw new Error(`ElevenLabs returned no audio. Raw: ${JSON.stringify(data).slice(0, 400)}`);
    return { audioUrl, ms: Date.now() - t0 };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('ElevenLabs returned no audio')) throw err;
    throw falError(err, 'elevenlabs');
  }
}

/** Queue the video. No prompt is sent at all — the field is optional, and left
 *  out Kling just animates the portrait to the audio rather than acting on a
 *  description of a scene. That is the whole point of this section: the mp3
 *  drives the performance, nothing else. */
export async function submitAvatar(imageUrl: string, audioUrl: string): Promise<string> {
  ensureConfigured();
  try {
    const { request_id } = await fal.queue.submit(AVATAR_MODEL, {
      input: { image_url: imageUrl, audio_url: audioUrl },
    });
    return request_id;
  } catch (err) {
    throw falError(err, 'kling submit');
  }
}

/** Where a queued job has got to. Logs come back so the card can show Kling's
 *  own lines while it works. */
export async function avatarStatus(requestId: string) {
  ensureConfigured();
  try {
    return await fal.queue.status(AVATAR_MODEL, { requestId, logs: true });
  } catch (err) {
    throw falError(err, 'kling status');
  }
}

/** The finished mp4. Only call this once the status says COMPLETED — a job that
 *  failed throws here, with the reason. */
export async function avatarResult(requestId: string): Promise<{ videoUrl: string; duration: number }> {
  ensureConfigured();
  try {
    const { data } = await fal.queue.result(AVATAR_MODEL, { requestId });
    const videoUrl = data?.video?.url;
    if (!videoUrl) throw new Error(`Kling returned no video. Raw: ${JSON.stringify(data).slice(0, 400)}`);
    return { videoUrl, duration: data.duration };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Kling returned no video')) throw err;
    throw falError(err, 'kling result');
  }
}
