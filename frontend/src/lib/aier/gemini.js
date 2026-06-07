import fs from 'node:fs';
import path from 'node:path';

function fileToInlineData(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : 'image/jpeg';
  return { inline_data: { mime_type: mime, data: fs.readFileSync(file).toString('base64') } };
}

/**
 * Use Gemini (vision) to draft a Kling prompt from the Admin instruction + the
 * freeze frame. The Admin prompt IS the system instruction Gemini follows.
 * @param {object} o
 * @param {string} o.framePath  absolute path to freeze frame image
 * @param {string[]} [o.refPaths] absolute paths to extra reference images (optional)
 * @param {string} [o.sceneNote] optional short user note to steer the prompt
 * @param {string} o.template   the Admin instruction text Gemini follows
 * @param {string} o.model      e.g. gemini-2.5-flash
 * @param {string} o.apiKey
 * @returns {Promise<string>} the drafted prompt
 */
export async function draftPrompt({ framePath, refPaths = [], sceneNote, template, model, apiKey, onLog }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const parts = [];
  let instruction = template;
  if (sceneNote && sceneNote.trim()) {
    instruction += `\n\nThe user also wants this to happen specifically: "${sceneNote.trim()}". Weave that in.`;
  }
  parts.push({ text: instruction });

  if (fs.existsSync(framePath)) parts.push(fileToInlineData(framePath));
  for (const r of refPaths) if (r && fs.existsSync(r)) parts.push(fileToInlineData(r));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const extractText = (data) => {
    const cand = data?.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ').trim();
    return { cand, text };
  };

  // One model call with transient-error retry/backoff. Throws on a hard error
  // (the thrown Error carries .status and .transient for the caller to branch on).
  async function call(modelName, maxOutputTokens) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const generationConfig = { temperature: 0.9, maxOutputTokens };
    // Only 2.5 Flash lets us fully disable "thinking" (budget 0). Pro requires a
    // thinking budget, and 2.0 Flash has no thinking — so only set it for flash.
    if (/2\.5-flash/.test(modelName)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig });

    const MAX_TRIES = 4;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) return res.json();

      const txt = await res.text();
      const transient = res.status === 503 || res.status === 429 || res.status === 500;
      if (transient && attempt < MAX_TRIES) {
        const waitMs = Math.min(8000, 800 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
        onLog?.(`Gemini ${modelName} ${res.status} (busy) — retry ${attempt}/${MAX_TRIES - 1} in ${(waitMs / 1000).toFixed(1)}s…`);
        await sleep(waitMs);
        continue;
      }
      const err = new Error(`Gemini ${res.status} (${modelName}): ${txt.slice(0, 300)}`);
      err.status = res.status;
      err.transient = transient;
      throw err;
    }
  }

  const whyEmpty = (data, cand) => {
    const block = data?.promptFeedback?.blockReason;
    const finish = cand?.finishReason;
    const safety = (cand?.safetyRatings || [])
      .filter((s) => s.blocked || s.probability === 'HIGH')
      .map((s) => s.category?.replace('HARM_CATEGORY_', ''))
      .join(', ');
    return [
      block && `prompt blocked: ${block}`,
      finish && finish !== 'STOP' && `finishReason: ${finish}`,
      safety && `safety flags: ${safety}`,
    ].filter(Boolean).join(' · ') || 'empty response';
  };

  // Try one model end-to-end (incl. a MAX_TOKENS bump). Returns { text, why }.
  async function tryModel(m) {
    const base = /pro/.test(m) ? 2048 : 800; // pro's thinking needs more headroom
    let data = await call(m, base);
    let { cand, text } = extractText(data);
    if (!text && cand?.finishReason === 'MAX_TOKENS') {
      data = await call(m, Math.max(4096, base * 2));
      ({ cand, text } = extractText(data));
    }
    if (text) return { text };
    console.error(`[gemini] ${m} empty response:`, JSON.stringify(data).slice(0, 600));
    return { text: null, why: whyEmpty(data, cand) };
  }

  // Ask the API which models this key can actually use (so we never depend on a
  // hardcoded name that Google later retires). Returns generateContent-capable
  // gemini text models, best-for-this-task first.
  async function discoverModels() {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || [])
        .filter((mm) => (mm.supportedGenerationMethods || []).includes('generateContent'))
        .map((mm) => mm.name.replace(/^models\//, ''))
        .filter((n) => /^gemini-/.test(n) && !/embedding|aqa|imagen|veo|tts|image|audio|live|learnlm|gemma/.test(n))
        .sort((a, b) => {
          const score = (n) => (/flash-lite/.test(n) ? 0 : /flash/.test(n) ? 1 : /pro/.test(n) ? 2 : 3);
          return score(a) - score(b) || b.localeCompare(a); // prefer flash, then newer version
        });
    } catch { return []; }
  }

  // Failsafe chain: configured model first, then fall up to higher / alternate
  // models if it's unavailable (503/429) or returns nothing usable. If the known
  // list is exhausted, fall back to whatever the API says is actually available.
  const fallbacks = process.env.GEMINI_FALLBACK_MODELS
    ? process.env.GEMINI_FALLBACK_MODELS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['gemini-2.5-pro', 'gemini-2.5-flash-lite'];

  const queue = [model, ...fallbacks].filter((m, i, a) => m && a.indexOf(m) === i);
  const tried = new Set();
  let discovered = false;
  let lastWhy = '';

  while (queue.length) {
    const m = queue.shift();
    if (!m || tried.has(m)) continue;
    tried.add(m);
    const isPrimary = m === model;
    try {
      const { text, why } = await tryModel(m);
      if (text) {
        if (!isPrimary) onLog?.(`✓ Drafted with fallback model ${m}.`);
        return text;
      }
      lastWhy = why;
      onLog?.(`Gemini ${m} returned no text (${why}) — trying another model…`);
    } catch (err) {
      // Hard error on the PRIMARY model is a real config problem (bad key) —
      // surface it. Hard errors on fallbacks just mean "not available to this
      // key", so skip on. Transient errors always skip on.
      if (!err.transient && isPrimary) throw err;
      lastWhy = err.message;
      onLog?.(`Gemini ${m} ${err.transient ? 'overloaded' : 'unavailable'} — trying another model…`);
    }

    // Known list exhausted → ask the API what's really available and queue it.
    if (queue.length === 0 && !discovered) {
      discovered = true;
      const avail = (await discoverModels()).filter((n) => !tried.has(n));
      if (avail.length) {
        onLog?.(`Trying available models: ${avail.slice(0, 4).join(', ')}…`);
        queue.push(...avail);
      }
    }
  }

  throw new Error(
    `Gemini failed for every model tried (${[...tried].join(', ')}). Last reason: ${lastWhy}. ` +
    `The API may be overloaded — wait a moment and try again.`,
  );
}
