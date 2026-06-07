import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, toMediaUrl } from '../lib/paths.js';
import { probe, FFMPEG_DIR, ytdlp } from '../lib/exec.js';
import { createJob, runJob, saveProject } from '../lib/store.js';

const router = Router();

const VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];

function findSource(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('source.'));
  // prefer mp4
  files.sort((a, b) => (a.endsWith('.mp4') ? -1 : 1));
  const hit = files.find((f) => VIDEO_EXTS.includes(path.extname(f).toLowerCase()));
  return hit ? path.join(dir, hit) : null;
}

// POST /api/youtube/download { url }  -> { projectId, jobId }
router.post('/download', (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid YouTube URL is required.' });
  }
  const projectId = crypto.randomUUID();
  const dir = projectDir(projectId);
  const jobId = createJob('download');

  runJob(jobId, async (update) => {
    update({ logLine: 'Fetching video info…', progress: 5 });
    let meta = {};
    try {
      const { stdout } = await ytdlp([url, '--dump-single-json', '--no-playlist', '--no-warnings', '--skip-download']);
      meta = JSON.parse(stdout);
    } catch (e) {
      // non-fatal; continue to download attempt
      update({ logLine: 'Could not read metadata, downloading anyway…' });
    }

    update({ logLine: `Downloading "${meta.title || url}" in 1080p…`, progress: 20 });
    // Pull the best video up to 1080p — NOT 1440p/4K. We DON'T constrain the
    // codec/ext here (1080p on YouTube can still be VP9/AV1), we just take the best
    // ≤1080p stream and let --merge-output-format remux it to mp4. The render stage
    // re-encodes to h264 anyway, so the intermediate codec doesn't matter. Order:
    // best video+audio ≤1080 → best combined ≤1080 → best available (fallback).
    await ytdlp([
      url,
      '-o', path.join(dir, 'source.%(ext)s'),
      '-f', 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', FFMPEG_DIR,
      '--no-playlist',
      '--no-warnings',
      '--retries', '3',
    ], (pct, line) => update({ progress: 20 + Math.round(pct * 0.6), logLine: line }));

    const sourcePath = findSource(dir);
    if (!sourcePath) throw new Error('Download finished but no video file was found.');

    update({ logLine: 'Reading video properties…', progress: 90 });
    const info = await probe(sourcePath);

    const project = saveProject(projectId, {
      url,
      title: meta.title || 'Untitled',
      thumbnail: meta.thumbnail || null,
      sourcePath,
      sourceUrl: toMediaUrl(sourcePath),
      duration: info.duration,
      width: info.width,
      height: info.height,
      fps: info.fps,
    });

    update({ logLine: 'Done.', progress: 100 });
    return {
      projectId,
      sourceUrl: project.sourceUrl,
      title: project.title,
      duration: project.duration,
      width: project.width,
      height: project.height,
      fps: project.fps,
    };
  });

  res.json({ projectId, jobId });
});

export default router;
