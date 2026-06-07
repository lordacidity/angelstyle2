import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, toMediaUrl } from '../lib/paths.js';
import { ffmpeg, hasAudioStream } from '../lib/exec.js';
import { targetDims, vfFor, cropFilter, ENC } from '../lib/video.js';
import { getProject, saveProject, createJob, runJob } from '../lib/store.js';

const router = Router();

// POST /api/export { projectId, trimStart, takeover, klingStart?, klingEnd?, crop? } -> { jobId }
// Stitches the real clip [trimStart..takeover] onto the AI clip, which now carries
// Kling's own native audio (Aiden talking). No separate lipsync stage anymore.
// `crop` (fractions per edge) trims the real footage to match the cropped freeze
// frame the AI clip was seeded from, so both halves share one framing.
router.post('/', (req, res) => {
  const { projectId, trimStart = 0, takeover, klingStart = 0, klingEnd, crop } = req.body || {};

  if (!projectId || typeof takeover !== 'number') {
    return res.status(400).json({ error: 'projectId and numeric takeover time are required.' });
  }
  if (takeover <= trimStart) {
    return res.status(400).json({ error: 'Takeover time must be after the trim start.' });
  }
  const project = getProject(projectId);
  if (!project.sourcePath) return res.status(400).json({ error: 'Missing source video.' });
  if (!project.klingPath) return res.status(400).json({ error: 'Generate the AI clip first.' });

  const jobId = createJob('export');

  runJob(jobId, async (update) => {
    const dir = projectDir(projectId);
    const { W, H } = targetDims(project, crop);
    const vf = vfFor(W, H);                       // AI clip — already cropped via its seed frame
    const cf = cropFilter(crop);
    const vf1 = cf ? `${cf},${vf}` : vf;          // real footage — crop to match the freeze frame
    const part1 = path.join(dir, 'part1.mp4'); // real footage
    const part2 = path.join(dir, 'part2.mp4'); // AI clip (Aiden talking, Kling native audio)
    const listFile = path.join(dir, 'concat.txt');
    const finalPath = path.join(dir, 'final.mp4');

    // Part 1: the real clip from trimStart up to the hand-off (frame-accurate cut + re-encode).
    update({ logLine: 'Rendering real segment…', progress: 15 });
    await ffmpeg([
      '-y', '-i', project.sourcePath,
      '-ss', String(trimStart), '-to', String(takeover),
      '-vf', vf1, '-r', '30', ...ENC, part1,
    ], (l) => update({ logLine: l }));

    // The freeze frame (screenshot) is the movie's last frame AND the Kling seed,
    // so kling[0] is a duplicate of it. Drop the very first AI frame so the
    // screenshot appears exactly once — as the end of the movie, never repeated.
    const SKIP = 1 / 30; // one frame at the export fps
    const kStart = Math.max(klingStart || 0, SKIP);
    const klingDur = typeof klingEnd === 'number' ? Math.max(0.1, klingEnd - kStart) : null;

    // Part 2: the AI clip, keeping Kling's native audio (Aiden's voice). If it
    // somehow has no audio track, pad with silence so the concat stays valid.
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
    await ffmpeg(p2, (l) => update({ logLine: l }));

    // Concatenate (both parts share identical codec params, so stream copy = seamless join).
    update({ logLine: 'Stitching final video…', progress: 88 });
    const toPosix = (p) => p.split(path.sep).join('/');
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

  res.json({ jobId });
});

// POST /api/export/movie { projectId, trimStart, trimEnd, crop? } -> { jobId }
// Renders ONLY the real movie scene — the full trim range [trimStart..trimEnd]
// (i.e. the whole scene, including everything after the AI hand-off), cropped to
// match the freeze frame and normalized to up-to-4K with its original audio. No
// stitching: the AI clip (kling.mp4) already exists, and the UI offers both for
// download so they can be edited together elsewhere.
router.post('/movie', (req, res) => {
  const { projectId, trimStart = 0, trimEnd, crop } = req.body || {};

  if (!projectId || typeof trimEnd !== 'number') {
    return res.status(400).json({ error: 'projectId and numeric trimEnd are required.' });
  }
  if (trimEnd <= trimStart) {
    return res.status(400).json({ error: 'Trim end must be after the trim start.' });
  }
  const project = getProject(projectId);
  if (!project.sourcePath) return res.status(400).json({ error: 'Missing source video.' });

  const jobId = createJob('export');

  runJob(jobId, async (update) => {
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
    ], (l) => update({ logLine: l }));

    saveProject(projectId, { moviePath, movieUrl: toMediaUrl(moviePath) });

    update({ logLine: 'Done.', progress: 100 });
    return {
      movieUrl: `${toMediaUrl(moviePath)}?t=${Date.now()}`,
      klingUrl: project.klingPath ? `${toMediaUrl(project.klingPath)}?t=${Date.now()}` : null,
      width: W, height: H,
    };
  });

  res.json({ jobId });
});

export default router;
