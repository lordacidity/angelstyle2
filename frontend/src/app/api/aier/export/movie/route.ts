import path from 'node:path';
import { projectDir, toMediaUrl } from '@/lib/aier/paths.js';
import { ffmpeg } from '@/lib/aier/exec.js';
import { targetDims, vfFor, cropFilter, ENC } from '@/lib/aier/video.js';
import { getProject, saveProject, createJob, runJob } from '@/lib/aier/store.js';

// POST /api/aier/export/movie -> { jobId }
// Renders ONLY the real movie scene [trimStart..trimEnd], cropped to match the freeze frame
// and normalized to up-to-4K with its original audio. No stitching.
export async function POST(req: Request) {
  const { projectId, trimStart = 0, trimEnd, crop } = await req.json().catch(() => ({}));

  if (!projectId || typeof trimEnd !== 'number') {
    return Response.json({ error: 'projectId and numeric trimEnd are required.' }, { status: 400 });
  }
  if (trimEnd <= trimStart) {
    return Response.json({ error: 'Trim end must be after the trim start.' }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project.sourcePath) return Response.json({ error: 'Missing source video.' }, { status: 400 });

  const jobId = createJob('export');

  runJob(jobId, async (update: (patch: Record<string, unknown>) => void) => {
    const dir = projectDir(projectId);
    const { W, H } = targetDims(project, crop);
    const vf = vfFor(W, H);
    const cf = cropFilter(crop);
    const vfMovie = cf ? `${cf},${vf}` : vf;
    const moviePath = path.join(dir, 'movie.mp4');

    update({ logLine: 'Rendering movie scene…', progress: 20 });
    await ffmpeg([
      '-y', '-i', project.sourcePath,
      '-ss', String(trimStart), '-to', String(trimEnd),
      '-vf', vfMovie, '-r', '30', ...ENC, moviePath,
    ], (l: string) => update({ logLine: l }));

    saveProject(projectId, { moviePath, movieUrl: toMediaUrl(moviePath) });

    update({ logLine: 'Done.', progress: 100 });
    return {
      movieUrl: `${toMediaUrl(moviePath)}?t=${Date.now()}`,
      klingUrl: project.klingPath ? `${toMediaUrl(project.klingPath)}?t=${Date.now()}` : null,
      width: W, height: H,
    };
  });

  return Response.json({ jobId });
}
