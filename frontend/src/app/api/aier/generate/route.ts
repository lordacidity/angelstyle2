import fs from 'node:fs';
import path from 'node:path';
import { projectDir, toMediaUrl, resolveStoragePath } from '@/lib/aier/paths.js';
import { probe } from '@/lib/aier/exec.js';
import { getProject, saveProject, getSettings, createJob, runJob } from '@/lib/aier/store.js';
import { uploadFile, runKling } from '@/lib/aier/fal.js';
import { canGenerate, recordGeneration } from '@/lib/aier/spend.js';

async function downloadTo(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated video (${res.status}).`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// POST /api/aier/generate { projectId, prompt, duration?, model? } -> { jobId }
export async function POST(req: Request) {
  const { projectId, prompt, duration, model } = await req.json().catch(() => ({}));
  if (!projectId || !prompt) {
    return Response.json({ error: 'projectId and prompt are required.' }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project.framePath) return Response.json({ error: 'No freeze frame for this project.' }, { status: 400 });

  // Hard daily cap on paid Kling generations (backstop vs. a leaked access token).
  if (!canGenerate()) {
    return Response.json({ error: 'Daily generation limit reached. Please try again tomorrow.' }, { status: 429 });
  }

  const settings = await getSettings();
  const jobId = createJob('generate');

  runJob(jobId, async (update: (patch: Record<string, unknown>) => void) => {
    update({ logLine: 'Uploading freeze frame…', progress: 10 });
    const startImageUrl = await uploadFile(project.framePath);

    // Build Aiden as @Element1 from the admin reference images.
    let elements;
    const refs = settings.refs || [];
    if (refs.length) {
      update({ logLine: `Uploading ${refs.length} reference image(s)…`, progress: 25 });
      const refUrls: string[] = [];
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

    // Kling gives no fine-grained progress, so creep the bar 40→80 while we wait.
    let creep = 40;
    const creepTimer = setInterval(() => {
      creep = Math.min(80, creep + 1);
      update({ progress: creep });
    }, 3000);

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
        onInput: (input: unknown) => update({ klingInput: { model: activeModel, input } }),
        onLog: (m: string) => update({ logLine: m }),
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

  return Response.json({ jobId });
}
