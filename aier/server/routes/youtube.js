import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectDir, toMediaUrl } from '../lib/paths.js';
import { probe, FFMPEG_DIR, ytdlp } from '../lib/exec.js';
import { createJob, runJob, saveProject } from '../lib/store.js';

const router = Router();

const VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];

function safeTitle(t) {
  return (t || 'video').replace(/[^\w\s().-]/g, '').trim().slice(0, 80) || 'video';
}

// GET /youtube/grab?url=...&probe=1  -> { title, lengthSeconds }
// GET /youtube/grab?url=...          -> streams the merged <=1080p MP4 as a browser download
// Standalone "just save the file" path for the Video downloader tab — no project, no job; a
// scratch temp file streamed back then deleted. Local-only, so it runs from a residential IP
// (no datacenter bot-block) at up to 1080p.
router.get('/grab', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid YouTube URL is required.' });
  }
  let meta = {};
  try {
    const { stdout } = await ytdlp([url, '--dump-single-json', '--no-playlist', '--no-warnings', '--skip-download']);
    meta = JSON.parse(stdout);
  } catch (e) {
    return res.status(502).json({ error: `Couldn't read that video: ${String(e.message).split('\n')[0]}` });
  }
  const title = safeTitle(meta.title);

  if (req.query.probe) {
    return res.json({ title, lengthSeconds: Number(meta.duration) || null });
  }

  const tmp = path.join(os.tmpdir(), `aier-dl-${crypto.randomUUID()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* gone */ } };

  try {
    await ytdlp([
      url,
      '-o', path.join(tmp, 'video.%(ext)s'),
      '-f', 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', FFMPEG_DIR,
      '--no-playlist',
      '--no-warnings',
      '--retries', '3',
    ]);
  } catch (e) {
    cleanup();
    if (!res.headersSent) res.status(502).json({ error: `Download failed: ${String(e.message).split('\n')[0]}` });
    return;
  }

  const files = fs.readdirSync(tmp).map((f) => path.join(tmp, f));
  const file = files.find((f) => f.toLowerCase().endsWith('.mp4')) || files[0];
  if (!file) { cleanup(); return res.status(500).json({ error: 'Download finished but no file was produced.' }); }

  res.set('Content-Type', 'video/mp4');
  res.set('Content-Disposition', `attachment; filename="${title}.mp4"`);
  res.set('Cache-Control', 'no-store');
  try { res.set('Content-Length', String(fs.statSync(file).size)); } catch { /* non-fatal */ }

  const stream = fs.createReadStream(file);
  stream.on('error', () => { if (!res.headersSent) res.status(500).end(); cleanup(); });
  res.on('close', cleanup); // normal finish AND client abort
  stream.pipe(res);
});

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
