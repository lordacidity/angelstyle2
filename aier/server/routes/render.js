import { Router } from 'express';
import fs from 'node:fs';
import { projectDir, toMediaUrl } from '../lib/paths.js';
import { probe, hasAudioStream } from '../lib/exec.js';
import { getProject, saveProject, getSettings, createJob, runJob } from '../lib/store.js';
import { renderEdl } from '../lib/render.js';
import { FPS } from '../lib/video.js';

const router = Router();

// POST /api/render { projectId, edl } -> { jobId }
// Renders a full timeline EDL (trims, splits, speed, extra clips, detached/added audio,
// gains, moves) to one final.mp4. Poll /api/jobs/:id for progress, like the other stages.
router.post('/', (req, res) => {
  const { projectId, edl } = req.body || {};
  if (!projectId || !edl) {
    return res.status(400).json({ error: 'projectId and edl are required.' });
  }
  const project = getProject(projectId);
  if (!project.id) return res.status(404).json({ error: 'Project not found.' });

  const jobId = createJob('render');
  runJob(jobId, async (update) => {
    const dir = projectDir(projectId);
    const out = await renderEdl({ project, edl, dir, update });
    saveProject(projectId, { finalPath: out.finalPath, finalUrl: out.finalUrl, edl });
    update({ logLine: 'Done.', progress: 100 });
    return { ...out, finalUrl: `${out.finalUrl}?t=${Date.now()}` };
  });

  res.json({ jobId });
});

// GET /api/render/assets/:projectId -> media the editor can drop on the timeline.
// Clips come from the project (real source + AI clip); the audio library is global (admin).
router.get('/assets/:projectId', async (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project.id) return res.status(404).json({ error: 'Project not found.' });

  const clips = [];
  const addClip = async (label, abs) => {
    if (!abs || !fs.existsSync(abs)) return;
    try {
      const info = await probe(abs);
      clips.push({
        label,
        src: toMediaUrl(abs),
        duration: info.duration,
        width: info.width,
        height: info.height,
        hasAudio: await hasAudioStream(abs),
      });
    } catch {}
  };
  await addClip('Real footage', project.sourcePath);
  await addClip('AI clip (Kling)', project.klingPath);

  const audioLibrary = (getSettings().audio || []).map((a) => ({
    id: a.id, label: a.label, src: a.url, duration: a.duration || null,
  }));

  res.json({ canvas: { fps: FPS }, clips, audioLibrary, savedEdl: project.edl || null });
});

export default router;
