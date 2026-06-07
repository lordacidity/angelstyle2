import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS_DIR, projectDir, toMediaUrl } from '../lib/paths.js';
import { ffmpeg, probe } from '../lib/exec.js';
import { getProject, saveProject, createJob, runJob } from '../lib/store.js';
import { targetDims, vfFor, ENC, FPS } from '../lib/video.js';

// Testing helpers: jump straight into the editor with real media, or fake the AI clip,
// so the Kling/fal step can be skipped while iterating on the editor.
const router = Router();

// GET /api/dev/projects -> saved projects that have media, newest first (for a quick picker).
router.get('/projects', (_req, res) => {
  let ids = [];
  try { ids = fs.readdirSync(PROJECTS_DIR); } catch {}
  const out = [];
  for (const id of ids) {
    const p = getProject(id);
    if (!p?.sourcePath || !fs.existsSync(p.sourcePath)) continue;
    const hasKling = !!p.klingPath && fs.existsSync(p.klingPath);
    out.push({
      id,
      title: p.title || '(untitled)',
      sourceUrl: toMediaUrl(p.sourcePath),
      klingUrl: hasKling ? toMediaUrl(p.klingPath) : null,
      hasKling,
      width: p.width || 0, height: p.height || 0, fps: p.fps || FPS,
      duration: p.duration || 0, klingDuration: p.klingDuration || null,
      frameUrl: p.framePath && fs.existsSync(p.framePath) ? toMediaUrl(p.framePath) : null,
      updatedAt: p.updatedAt || '',
    });
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ projects: out.slice(0, 40) });
});

// POST /api/dev/placeholder { projectId, fromTime?, duration? } -> { jobId }
// Fakes the AI clip by slicing the real source (normalized to the project's target dims),
// so Combine + the editor work without calling Kling. Carries the source's own audio.
router.post('/placeholder', (req, res) => {
  const { projectId, fromTime = 0, duration = 5 } = req.body || {};
  const project = getProject(projectId);
  if (!project.sourcePath) return res.status(400).json({ error: 'Project has no source video.' });

  const jobId = createJob('placeholder');
  runJob(jobId, async (update) => {
    const dir = projectDir(projectId);
    const klingPath = path.join(dir, 'kling.mp4');
    const { W, H } = targetDims(project);
    const start = Math.max(0, Number(fromTime) || 0);
    const dur = Math.max(1, Number(duration) || 5);
    update({ logLine: 'Building placeholder AI clip from the source…', progress: 30 });
    await ffmpeg(['-y', '-i', project.sourcePath, '-ss', String(start), '-t', String(dur),
      '-vf', vfFor(W, H), '-r', String(FPS), ...ENC, klingPath], (l) => update({ logLine: l }));
    const info = await probe(klingPath);
    saveProject(projectId, {
      klingPath, klingUrl: toMediaUrl(klingPath), klingDuration: info.duration,
      lastPrompt: '(placeholder — skipped Kling)', lastModel: 'placeholder',
    });
    update({ logLine: 'Done.', progress: 100 });
    return { klingUrl: `${toMediaUrl(klingPath)}?t=${Date.now()}`, klingDuration: info.duration };
  });

  res.json({ jobId });
});

export default router;
