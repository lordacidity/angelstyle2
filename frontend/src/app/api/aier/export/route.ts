import fs from 'node:fs';
import path from 'node:path';
import { projectDir, toMediaUrl } from '@/lib/aier/paths.js';
import { ffmpeg, hasAudioStream } from '@/lib/aier/exec.js';
import { targetDims, vfFor, cropFilter, ENC } from '@/lib/aier/video.js';
import { getProject, saveProject, createJob, runJob } from '@/lib/aier/store.js';

// POST /api/aier/export -> { jobId }
// Stitches the real clip [trimStart..takeover] onto the AI clip (which carries Kling's
// native audio). `crop` trims the real footage to match the cropped freeze frame.
export async function POST(req: Request) {
  const { projectId, trimStart = 0, takeover, klingStart = 0, klingEnd, crop } = await req.json().catch(() => ({}));

  if (!projectId || typeof takeover !== 'number') {
    return Response.json({ error: 'projectId and numeric takeover time are required.' }, { status: 400 });
  }
  if (takeover <= trimStart) {
    return Response.json({ error: 'Takeover time must be after the trim start.' }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project.sourcePath) return Response.json({ error: 'Missing source video.' }, { status: 400 });
  if (!project.klingPath) return Response.json({ error: 'Generate the AI clip first.' }, { status: 400 });

  const jobId = createJob('export');

  runJob(jobId, async (update: (patch: Record<string, unknown>) => void) => {
    const dir = projectDir(projectId);
    const { W, H } = targetDims(project, crop);
    const vf = vfFor(W, H);
    const cf = cropFilter(crop);
    const vf1 = cf ? `${cf},${vf}` : vf;
    const part1 = path.join(dir, 'part1.mp4');
    const part2 = path.join(dir, 'part2.mp4');
    const listFile = path.join(dir, 'concat.txt');
    const finalPath = path.join(dir, 'final.mp4');

    update({ logLine: 'Rendering real segment…', progress: 15 });
    await ffmpeg([
      '-y', '-i', project.sourcePath,
      '-ss', String(trimStart), '-to', String(takeover),
      '-vf', vf1, '-r', '30', ...ENC, part1,
    ], (l: string) => update({ logLine: l }));

    // Drop the very first AI frame (it duplicates the freeze frame / movie's last frame).
    const SKIP = 1 / 30;
    const kStart = Math.max(klingStart || 0, SKIP);
    const klingDur = typeof klingEnd === 'number' ? Math.max(0.1, klingEnd - kStart) : null;

    update({ logLine: 'Rendering AI segment…', progress: 55 });
    const klingHasAudio = await hasAudioStream(project.klingPath);
    const p2 = ['-y', '-i', project.klingPath];
    if (!klingHasAudio) {
      p2.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    }
    p2.push('-ss', String(kStart));
    if (klingDur) p2.push('-t', String(klingDur));
    p2.push('-vf', vf, '-r', '30', '-map', '0:v:0',
      '-map', klingHasAudio ? '0:a:0' : '1:a:0', '-shortest', ...ENC, part2);
    await ffmpeg(p2, (l: string) => update({ logLine: l }));

    update({ logLine: 'Stitching final video…', progress: 88 });
    const toPosix = (p: string) => p.split(path.sep).join('/');
    fs.writeFileSync(listFile, [part1, part2].map((p) => `file '${toPosix(p)}'`).join('\n') + '\n');
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', finalPath]);

    saveProject(projectId, {
      finalPath,
      finalUrl: toMediaUrl(finalPath),
      exportSettings: { trimStart, takeover, klingStart, klingEnd: klingEnd ?? null, crop: crop || null },
    });

    update({ logLine: 'Done.', progress: 100 });
    return { finalUrl: `${toMediaUrl(finalPath)}?t=${Date.now()}`, width: W, height: H };
  });

  return Response.json({ jobId });
}
