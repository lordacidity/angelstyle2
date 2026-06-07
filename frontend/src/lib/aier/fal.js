import fs from 'node:fs';
import path from 'node:path';
import { fal } from '@fal-ai/client';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not set');
  fal.config({ credentials: process.env.FAL_KEY });
  configured = true;
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : ext === '.mp4' ? 'video/mp4'
    : ext === '.mp3' ? 'audio/mpeg'
    : ext === '.wav' ? 'audio/wav'
    : ext === '.m4a' ? 'audio/mp4'
    : ext === '.aac' ? 'audio/aac'
    : 'image/jpeg';
}

// fal throws ApiError with the real reason buried in `.body` (often a moderation /
// "content risk" or billing message). Surface it so the UI shows something useful
// instead of a bare "Forbidden".
function describeFalError(err, label) {
  const status = err?.status ?? err?.response?.status;
  // Raw dump to the server terminal so the exact cause is always visible.
  console.error(`[fal:${label}] status=${status}`, 'body=', JSON.stringify(err?.body ?? err?.response?.data ?? null));
  let detail = err?.body?.detail ?? err?.body?.message ?? err?.body ?? err?.response?.data;
  if (Array.isArray(detail)) detail = detail.map((d) => d?.msg || d?.message || JSON.stringify(d)).join('; ');
  if (detail && typeof detail === 'object') detail = JSON.stringify(detail).slice(0, 600);
  const base = err?.message || `${label} failed`;
  let msg = base;
  if (status) msg += ` (HTTP ${status})`;
  if (detail && String(detail) !== base) msg += ` — ${detail}`;
  if (status === 403) {
    msg += '  · 403 usually means Kling moderation rejected the seed frame or prompt, ' +
      'or your fal account is out of credits / the FAL_KEY is invalid. Try a different ' +
      'freeze frame or a tamer prompt, and check your fal.ai balance.';
  }
  const e = new Error(msg);
  e.status = status;
  // 403 from Kling is almost always a moderation/content-risk rejection — tag it so callers
  // can show a "try a different frame/prompt" hint instead of a generic failure.
  if (status === 403) e.moderation = true;
  return e;
}

/** Upload a local file to fal storage; returns a public URL Kling can read. */
export async function uploadFile(absPath) {
  ensureConfigured();
  const buf = fs.readFileSync(absPath);
  const file = new File([buf], path.basename(absPath), { type: mimeFor(absPath) });
  try {
    return await fal.storage.upload(file);
  } catch (err) {
    throw describeFalError(err, 'fal upload');
  }
}

/**
 * Run Kling v3 image-to-video. With generateAudio on, Kling natively voices the
 * scene (Aiden talking) — there is no separate lipsync pass anymore.
 * @param {object} o
 * @param {string} o.model          fal model id (standard or pro)
 * @param {string} o.startImageUrl  uploaded freeze-frame URL
 * @param {string} o.prompt
 * @param {Array}  [o.elements]     [{ frontal_image_url, reference_image_urls }]
 * @param {number} o.duration       seconds (3..15)
 * @param {boolean} o.generateAudio native audio (Kling makes Aiden talk)
 * @param {number} o.cfgScale
 * @param {string} [o.negativePrompt] things to avoid (defaults to a quality negative)
 * @param {string} [o.shotType]      Kling shot type (defaults to "customize")
 * @param {(input:object)=>void} [o.onInput] called once with the exact request body
 * @param {(msg:string)=>void} [o.onLog]
 * @returns {Promise<{videoUrl:string, raw:any}>}
 */
const KLING_TIMEOUT_MS = 12 * 60 * 1000; // give up after 12 min so the job can't hang forever

export async function runKling({ model, startImageUrl, prompt, elements, duration, generateAudio, cfgScale, negativePrompt, shotType, onInput, onLog }) {
  ensureConfigured();

  const input = {
    start_image_url: startImageUrl,
    prompt,
    duration: String(duration ?? 5),
    generate_audio: !!generateAudio,
    cfg_scale: typeof cfgScale === 'number' ? cfgScale : 0.5,
    shot_type: shotType || 'customize',
    negative_prompt: negativePrompt || 'blur, distort, and low quality',
  };
  if (elements && elements.length) input.elements = elements;

  // Hand the fully-built request body back to the caller (for UI verification)
  // before we block on the long Kling call.
  onInput?.(input);

  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 1000);
  let lastStatus = 'SUBMITTING';
  let queuePos = null;
  let requestId = null;

  // Heartbeat: fal can sit IN_QUEUE for minutes with no callbacks. Emit a
  // line every few seconds so the UI proves it's still alive and waiting.
  const heartbeat = setInterval(() => {
    const pos = queuePos != null ? `, queue #${queuePos}` : '';
    const rid = requestId ? ` · req ${String(requestId).slice(0, 8)}` : '';
    onLog?.(`⏳ still ${lastStatus} — ${secs()}s elapsed${pos}${rid}`);
  }, 5000);

  let timeoutTimer;
  const timeout = new Promise((_, reject) => {
    timeoutTimer = setTimeout(
      () => reject(new Error(
        `Kling timed out after ${Math.round(KLING_TIMEOUT_MS / 60000)} min (last status: ${lastStatus}). ` +
        `The fal queue may be backed up — retry, or switch to the pro model in /admin.`,
      )),
      KLING_TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([
      fal.subscribe(model, {
        input,
        logs: true,
        onQueueUpdate: (update) => {
          if (update.request_id) requestId = update.request_id;
          if (typeof update.queue_position === 'number') queuePos = update.queue_position;
          if (update.status && update.status !== lastStatus) {
            lastStatus = update.status;
            onLog?.(`status → ${update.status}${queuePos != null ? ` (queue #${queuePos})` : ''} @ ${secs()}s`);
          }
          if (update.status === 'IN_PROGRESS') {
            (update.logs || []).forEach((l) => l?.message && onLog?.(l.message));
          }
        },
      }),
      timeout,
    ]);

    const data = result?.data || result;
    const videoUrl = data?.video?.url;
    if (!videoUrl) throw new Error(`Kling returned no video. Raw: ${JSON.stringify(data).slice(0, 500)}`);
    onLog?.(`✓ Kling finished in ${secs()}s`);
    return { videoUrl, raw: data };
  } catch (err) {
    if (err?.message?.startsWith('Kling timed out') || err?.message?.startsWith('Kling returned no video')) throw err;
    throw describeFalError(err, 'Kling');
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeoutTimer);
  }
}
