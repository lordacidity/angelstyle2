import fs from 'node:fs';
import path from 'node:path';
import { SETTINGS_FILE, projectDir } from './paths.js';

// ---------- Settings ----------
const TESTING_MODEL = 'fal-ai/kling-video/v3/standard/image-to-video';
const PROD_MODEL = 'fal-ai/kling-video/v3/pro/image-to-video';

const DEFAULT_SETTINGS = {
  // reference images (relative media URLs), filled by admin uploads.
  // Aiden is sent to Kling as a single element ("@Element1"): refs[0] = frontal/face,
  // the rest become reference_image_urls (extra angles, full body, etc.)
  refs: [], // [{ id, label, url, file }]

  // Admin sound library available to the timeline editor (music beds, sfx, voice).
  audio: [], // [{ id, label, url, file, duration }]

  // Kling generation
  klingModel: process.env.KLING_MODEL || TESTING_MODEL, // swap to PROD in admin
  defaultDuration: 5, // seconds, Kling v3 allows 3..15
  cfgScale: 0.5, // prompt adherence
  negativePrompt: 'blur, distort, and low quality', // sent as Kling's negative_prompt

  // The instruction Gemini follows. Gemini sees THIS text + the freeze frame, and
  // outputs the final Kling prompt. Kling v3 reference tokens it should use:
  // #start_image = the seed frame, #Element1 = the reference-image character.
  promptTemplate:
    'You are writing a prompt for the Kling AI video generator. The image provided is ' +
    'the final frame of a real video — the scene Kling must continue. Write a single ' +
    'vivid prompt (2-4 sentences) describing one continuous, natural continuation of ' +
    'that scene. Refer to the seed frame as #start_image and to the inserted person as ' +
    '#Element1 (supplied separately as reference images). #Element1 should appear ' +
    'seamlessly in the same location, matching the lighting, color grade, camera angle, ' +
    'and environment of #start_image; he looks into the camera and speaks naturally to ' +
    'the viewer. Describe his motion and the camera movement. Do not mention that these ' +
    'are images or references. Output ONLY the final prompt text.',
};

export const KLING_MODELS = { testing: TESTING_MODEL, prod: PROD_MODEL };

export function getSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

// ---------- Projects ----------
export function getProject(id) {
  const file = path.join(projectDir(id), 'project.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { id };
  }
}

export function saveProject(id, patch) {
  const file = path.join(projectDir(id), 'project.json');
  const next = { ...getProject(id), ...patch, id, updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

// ---------- Jobs (in-memory async task tracking) ----------
const jobs = new Map();

export function createJob(type) {
  const id = crypto.randomUUID();
  jobs.set(id, { id, type, status: 'queued', progress: 0, log: [], result: null, error: null, createdAt: Date.now() });
  return id;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  if (patch.logLine) {
    job.log.push(patch.logLine);
    if (job.log.length > 200) job.log.shift();
    delete job.logLine;
  }
}

export function getJob(id) {
  return jobs.get(id) || null;
}

/** Run an async worker bound to a job; never throws (errors land on the job). */
export function runJob(id, worker) {
  updateJob(id, { status: 'running' });
  Promise.resolve()
    .then(() => worker((patch) => updateJob(id, patch)))
    .then((result) => updateJob(id, { status: 'done', progress: 100, result }))
    .catch((err) => {
      console.error(`[job ${id}]`, err);
      updateJob(id, { status: 'error', error: err.message || String(err) });
    });
}
