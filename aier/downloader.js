// Lightweight LOCAL "paste a link → save the MP4" server. Launched on-demand by the
// "Launch Aier server" button on the Vercel-hosted /ai-maker page (aier:// URL protocol →
// launch-aier.bat). The browser talks to THIS directly at http://localhost:3011, so:
//   • downloads run from the user's RESIDENTIAL IP — YouTube bot-blocks datacenter IPs
//     (Vercel/Railway), so the in-cloud paths get "Sign in to confirm you're not a bot";
//   • yt-dlp + the bundled ffmpeg merge true ≤1080p (the Vercel pure-JS grab is capped
//     ~720p because it can only take a single progressive stream, no merge).
//
// Single purpose: this is NOT the studio pipeline (freeze-frame → Kling → render stays on
// Railway). No projects, no jobs, no persistence — just a scratch temp file streamed back
// to the browser and deleted. Needs no API keys.
//
// Run:  node downloader.js          (the USER starts this via the button — never Claude)
//       AIER_DOWNLOADER_PORT=xxxx   (override the default 3011)

import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ytdlp, FFMPEG_DIR } from './server/lib/exec.js';

const PORT = Number(process.env.AIER_DOWNLOADER_PORT) || 3011;
const app = express();

// CORS + Private Network Access. The page is served from https://<vercel> but fetches THIS
// http://localhost server. localhost is a "potentially trustworthy" origin so it's not
// blocked as mixed content, but the browser still needs CORS on the probe fetch and Chrome
// needs the Private-Network preflight answered, or it blocks the request.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function safeTitle(t) {
  return (t || 'video').replace(/[^\w\s().-]/g, '').trim().slice(0, 80) || 'video';
}

// Lets the page tell "server is running" from "server is down" before offering Download.
app.get('/health', (_req, res) => res.json({ ok: true, service: 'aier-downloader' }));

// GET /grab?url=...&probe=1  -> { title, lengthSeconds }   (validate + show the title first)
// GET /grab?url=...          -> streams the merged ≤1080p MP4 as a browser download
app.get('/grab', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid YouTube URL is required.' });
  }

  // Metadata first — also validates the URL and surfaces YouTube errors (private/age-gated/
  // bot-block) as clean JSON before we commit to streaming bytes.
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

  // Download to a scratch temp dir, stream the result, then delete it. We DON'T constrain
  // the codec here (≤1080p on YouTube can be VP9/AV1); --merge-output-format remuxes to mp4.
  const tmp = path.join(os.tmpdir(), `aier-dl-${randomUUID()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* gone already */ } };

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
  res.on('close', cleanup); // fires on normal finish AND on client abort
  stream.pipe(res);
});

app.listen(PORT, () => {
  console.log(`\n  Aier downloader  ->  http://localhost:${PORT}`);
  console.log('  Leave this window open while you download from /ai-maker. Close it when done.\n');
});
