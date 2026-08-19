// Minimal Gemini (generative language) client — multimodal, server-side only.
// Mirrors the proven call/retry pattern from the AI-maker project: configured
// model first, fall up to alternates on transient errors or empty responses.

export interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  file_data?: { mime_type: string; file_uri: string };
}

const API_BASE = 'https://generativelanguage.googleapis.com';

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
  safetyRatings?: Array<{ blocked?: boolean; probability?: string; category?: string }>;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// generateContent with a hard per-attempt timeout so a single stalled request
// can't hold a route open. Aborts and surfaces as a normal fetch failure, which
// the callers' retry loops treat as transient.
const GEMINI_TIMEOUT_MS = 45_000;
async function fetchGemini(url: string, init: RequestInit, timeoutMs = GEMINI_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function extractText(data: GeminiResponse): { cand?: GeminiCandidate; text: string } {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map(p => p.text).filter(Boolean).join(' ').trim();
  return { cand, text };
}

function whyEmpty(data: GeminiResponse, cand?: GeminiCandidate): string {
  const block = data?.promptFeedback?.blockReason;
  const finish = cand?.finishReason;
  const safety = (cand?.safetyRatings ?? [])
    .filter(s => s.blocked || s.probability === 'HIGH')
    .map(s => s.category?.replace('HARM_CATEGORY_', ''))
    .join(', ');
  return [
    block && `prompt blocked: ${block}`,
    finish && finish !== 'STOP' && `finishReason: ${finish}`,
    safety && `safety flags: ${safety}`,
  ].filter(Boolean).join(' · ') || 'empty response';
}

/**
 * One Gemini generateContent call against `parts`, with transient-error backoff
 * and fall-up to a couple of alternate models. Returns the drafted text.
 */
export async function geminiGenerate(parts: GeminiPart[], opts: {
  temperature?: number;
  maxOutputTokens?: number;
} = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const maxOutputTokens = opts.maxOutputTokens ?? 800;

  async function call(modelName: string): Promise<GeminiResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens,
    };
    // Only 2.5 Flash lets us fully disable "thinking" (budget 0) — keeps it fast.
    if (/2\.5-flash/.test(modelName)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig });

    const MAX_TRIES = 4;
    for (let attempt = 1; ; attempt++) {
      const res = await fetchGemini(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) return res.json() as Promise<GeminiResponse>;
      const txt = await res.text();
      const transient = res.status === 503 || res.status === 429 || res.status === 500;
      if (transient && attempt < MAX_TRIES) {
        await sleep(Math.min(8000, 800 * 2 ** (attempt - 1)));
        continue;
      }
      const err = new Error(`Gemini ${res.status} (${modelName}): ${txt.slice(0, 300)}`) as Error & { transient?: boolean };
      err.transient = transient;
      throw err;
    }
  }

  const queue = [primary, 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
    .filter((m, i, a) => m && a.indexOf(m) === i);
  let lastWhy = '';
  for (const m of queue) {
    const isPrimary = m === primary;
    try {
      const data = await call(m);
      const { cand, text } = extractText(data);
      if (text) return text;
      lastWhy = whyEmpty(data, cand);
    } catch (e) {
      const err = e as Error & { transient?: boolean };
      if (!err.transient && isPrimary) throw err; // hard error on primary = real config problem
      lastWhy = err.message;
    }
  }
  throw new Error(`Gemini returned no usable text (tried ${queue.join(', ')}). Last reason: ${lastWhy}`);
}

// ── Search-grounded generation ───────────────────────────────────────────────
// For routes that need REAL current facts (trending-pick, carousel-copy): the
// google_search tool grounds the output in live results. JSON response_mime_type
// is unreliable alongside the search tool, so callers ask for JSON in the prompt
// and parse it out with extractGeminiJson.

export async function geminiWithSearch(prompt: string, opts: { temperature?: number; maxOutputTokens?: number } = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetchGemini(`${API_BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) {
      const data = await res.json() as GeminiResponse;
      const { text } = extractText(data);
      if (text) return text;
      // A 200 with no text part happens intermittently with google_search
      // grounding (the model returns only grounding metadata, or nothing). Treat
      // it as transient and retry instead of failing the whole request outright.
      if (attempt < 4) { await sleep(Math.min(8000, 800 * 2 ** (attempt - 1))); continue; }
      throw new Error('Gemini returned empty response');
    }
    const txt = await res.text();
    const transient = res.status === 503 || res.status === 429 || res.status === 500;
    if (transient && attempt < 4) { await sleep(Math.min(8000, 800 * 2 ** (attempt - 1))); continue; }
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  throw new Error('Gemini: max retries exceeded');
}

// Pull the first balanced JSON object out of a model response that may be
// wrapped in ```json fences or have grounding prose around it.
export function extractGeminiJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  if (start === -1) throw new Error('No JSON object in response');
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return body.slice(start, i + 1); }
  }
  throw new Error('Unterminated JSON object in response');
}

// ── Files API ────────────────────────────────────────────────────────────────
// For clips too big to send inline (inline requests cap at ~20MB total). Upload
// the bytes once, wait until Gemini finishes processing, then reference the file
// by URI in generateContent. Handles videos up to 2GB.

function requireKey(): string {
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return apiKey;
}

// Resumable upload (start → upload+finalize). Returns the file's uri + name.
export async function uploadFileToGemini(data: ArrayBuffer, mimeType: string, displayName = 'clip'): Promise<{ uri: string; name: string }> {
  const apiKey = requireKey();
  const numBytes = data.byteLength;

  const start = await fetch(`${API_BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(numBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!start.ok) throw new Error(`Gemini upload start ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini upload: no resumable URL returned');

  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    // Blob is a valid BodyInit (passing a Uint8Array trips the DOM fetch types);
    // the runtime sets Content-Length from the blob.
    body: new Blob([data], { type: mimeType }),
  });
  if (!up.ok) throw new Error(`Gemini upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const json = await up.json() as { file?: { uri?: string; name?: string } };
  const uri = json.file?.uri, name = json.file?.name;
  if (!uri || !name) throw new Error('Gemini upload: missing file uri/name');
  return { uri, name };
}

// Poll an uploaded file until it leaves PROCESSING. Throws on FAILED/timeout.
export async function waitForFileActive(name: string, timeoutMs = 45000): Promise<void> {
  const apiKey = requireKey();
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${API_BASE}/v1beta/${name}?key=${apiKey}`);
    if (res.ok) {
      const json = await res.json() as { state?: string };
      if (json.state === 'ACTIVE') return;
      if (json.state === 'FAILED') throw new Error('Gemini could not process the video');
    }
    if (Date.now() - start > timeoutMs) throw new Error('Gemini file processing timed out');
    await sleep(1500);
  }
}

// Best-effort cleanup — uploaded files expire after 48h anyway.
export async function deleteGeminiFile(name: string): Promise<void> {
  try { await fetch(`${API_BASE}/v1beta/${name}?key=${requireKey()}`, { method: 'DELETE' }); } catch { /* ignore */ }
}
