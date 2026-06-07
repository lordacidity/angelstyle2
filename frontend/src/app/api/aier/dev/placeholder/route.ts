import path from 'node:path';
import { projectDir, toMediaUrl } from '@/lib/aier/paths.js';
import { ffmpeg, probe } from '@/lib/aier/exec.js';
import { getProject, saveProject, createJob, runJob } from '@/lib/aier/store.js';
import { targetDims, vfFor, ENC, FPS } from '@/lib/aier/video.js';

// POST /api/aier/dev/placeholder -> { jobId }
// Fakes the AI clip by slicing the real source, so Combine + the editor work without Kling.
export async function POST(req: Request) {
  const { projectId, fromTime = 0, duration = 5 } = await req.json().catch(() => ({}));
  const project = getProject(projectId);
  if (!project.sourcePath) return Response.json({ error: 'Project has no source video.' }, { status: 400 });

  const jobId = createJob('placeholder');
  runJob(jobId, async (update: (patch: Record<string, unknown>) => void) => {
    const dir = projectDir(projectId);
    const klingPath = path.join(dir, 'kling.mp4');
    const { W, H } = targetDims(project);
    const start = Math.max(0, Number(fromTime) || 0);
    const dur = Math.max(1, Number(duration) || 5);
    update({ logLine: 'Building placeholder AI clip from the source…', progress: 30 });
    await ffmpeg(['-y', '-i', project.sourcePath, '-ss', String(start), '-t', String(dur),
      '-vf', vfFor(W, H), '-r', String(FPS), ...ENC, klingPath], (l: string) => update({ logLine: l }));
    const info = await probe(klingPath);
    saveProject(projectId, {
      klingPath, klingUrl: toMediaUrl(klingPath), klingDuration: info.duration,
      lastPrompt: '(placeholder — skipped Kling)', lastModel: 'placeholder',
    });
    update({ logLine: 'Done.', progress: 100 });
    return { klingUrl: `${toMediaUrl(klingPath)}?t=${Date.now()}`, klingDuration: info.duration };
  });

  return Response.json({ jobId });
}
