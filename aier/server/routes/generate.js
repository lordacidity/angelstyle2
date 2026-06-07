import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, toMediaUrl, resolveStoragePath } from '../lib/paths.js';
import { probe } from '../lib/exec.js';
import { getProject, saveProject, getSettings, createJob, runJob } from '../lib/store.js';
import { uploadFile, runKling } from '../lib/fal.js';
import { canGenerate, recordGeneration } from '../lib/spend.js';

const router = Router();

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated video (${res.status}).`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// POST /api/generate { projectId, prompt, duration?, model? } -> { jobId }
router.post('/', (req, res) => {
  const { projectId, prompt, duration, model } = req.body || {};
  if (!projectId || !prompt) {
    return res.status(400).json({ error: 'projectId and prompt are required.' });
  }
  const project = getProject(projectId);
  if (!project.framePath) return res.status(400).json({ error: 'No freeze frame for this project.' });

  // Hard daily cap on paid Kling generations (backstop vs. a leaked site password).
  if (!canGenerate()) {
    return res.status(429).json({ error: 'Daily generation limit reached. Please try again tomorrow.' });
  }

  const settings = getSettings();
  const jobId = createJob('generate');

  runJob(jobId, async (update) => {
    update({ logLine: 'Uploading freeze frame…', progress: 10 });
    const startImageUrl = await uploadFile(project.framePath);

    // Build Aiden as @Element1 from the admin reference images.
    let elements;
    const refs = settings.refs || [];
    if (refs.length) {
      update({ logLine: `Uploading ${refs.length} reference image(s)…`, progress: 25 });
      const refUrls = [];
      for (const r of refs) {
        const abs = resolveStoragePath(r);
        if (abs) refUrls.push(await uploadFile(abs));
        else update({ logLine: `⚠ reference image missing on disk (${r.label || r.id}) — skipped.` });
      }
      if (refUrls.length) {
        elements = [{ frontal_image_url: refUrls[0], reference_image_urls: refUrls.slice(1) }];
        update({ logLine: `Built @Element1 from ${refUrls.length} reference image(s).` });
      }
    } else {
      update({ logLine: 'No reference images set in /admin — generating without Aiden element.' });
    }

    const activeModel = model || settings.klingModel;
    recordGeneration(); // count it against today's cap right before we spend money
    update({ logLine: `Calling Kling (${activeModel})… this can take a few minutes.`, progress: 40 });

    // Kling gives no fine-grained progress, so creep the bar 40→80 slowly
    // while we wait. It just signals "alive", not real completion %.
    let creep = 40;
    const creepTimer = setInterval(() => {
      creep = Math.min(80, creep + 1);
      update({ progress: creep });
    }, 3000);

    // Kling natively voices the scene (audio on). The exact request body sent to
    // the API is published onto the job (klingInput) so the UI can show it for
    // verification while the clip generates.
    let videoUrl;
    try {
      ({ videoUrl } = await runKling({
        model: activeModel,
        startImageUrl,
        prompt,
        elements,
        duration: duration || settings.defaultDuration,
        generateAudio: true,
        cfgScale: settings.cfgScale,
        negativePrompt: settings.negativePrompt,
        shotType: settings.shotType,
        onInput: (input) => update({ klingInput: { model: activeModel, input } }),
        onLog: (m) => update({ logLine: m }),
      }));
    } finally {
      clearInterval(creepTimer);
    }

    update({ logLine: 'Downloading generated clip…', progress: 85 });
    const dir = projectDir(projectId);
    const klingPath = path.join(dir, 'kling.mp4');
    await downloadTo(videoUrl, klingPath);
    const info = await probe(klingPath);

    saveProject(projectId, {
      klingPath,
      klingUrl: toMediaUrl(klingPath),
      klingDuration: info.duration,
      lastPrompt: prompt,
      lastModel: activeModel,
    });

    update({ logLine: 'Done.', progress: 100 });
    return { klingUrl: `${toMediaUrl(klingPath)}?t=${Date.now()}`, klingDuration: info.duration };
  });

  res.json({ jobId });
});

export default router;
