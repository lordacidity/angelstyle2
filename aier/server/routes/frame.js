import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { projectDir, toMediaUrl } from '../lib/paths.js';
import { ffmpeg } from '../lib/exec.js';
import { getProject, saveProject } from '../lib/store.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/frame { projectId, time }  -> { frameUrl, time }
// Extracts a single, frame-accurate still at `time` (seconds, may be fractional).
// NOTE: ffmpeg's YUV→RGB decode can differ pixel-wise from the browser's, so the
// preview may not be identical to the <video>. Prefer /api/frame/save (below),
// which stores the browser's own decoded frame for a pixel-perfect match.
router.post('/', async (req, res) => {
  try {
    const { projectId, time } = req.body || {};
    if (!projectId || typeof time !== 'number') {
      return res.status(400).json({ error: 'projectId and numeric time are required.' });
    }
    const project = getProject(projectId);
    if (!project.sourcePath) return res.status(404).json({ error: 'Project source not found.' });

    const dir = projectDir(projectId);
    const framePath = path.join(dir, 'frame.png');

    // -ss AFTER -i = accurate (decode-to-timestamp) seek, so we hit the exact frame.
    await ffmpeg([
      '-y',
      '-i', project.sourcePath,
      '-ss', String(time),
      '-frames:v', '1',
      framePath,
    ]);

    saveProject(projectId, { frameTime: time, framePath, frameUrl: toMediaUrl(framePath) });
    // cache-bust so the <img> refreshes when the time changes
    res.json({ frameUrl: `${toMediaUrl(framePath)}?t=${Date.now()}`, time });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/frame/save  (multipart: image=PNG blob, projectId, time)
// Stores a frame the BROWSER decoded (canvas grab of the <video>) as the seed,
// so the captured still is pixel-for-pixel what the user saw in the player.
// Canvas exports 32-bit RGBA PNGs; we flatten to rgb24 (lossless — the alpha is
// fully opaque, so RGB is untouched) because Kling rejects RGBA seed images
// (surfaces as a bare 403 before generation runs).
router.post('/save', upload.single('image'), async (req, res) => {
  let tmp;
  try {
    const { projectId, time } = req.body || {};
    if (!projectId || !req.file) {
      return res.status(400).json({ error: 'projectId and an image are required.' });
    }
    const t = Number(time) || 0;
    const dir = projectDir(projectId);
    const framePath = path.join(dir, 'frame.png');

    tmp = path.join(dir, 'frame_in.png');
    fs.writeFileSync(tmp, req.file.buffer);
    // PNG → PNG, strip alpha. Lossless: identical RGB, no re-compression artifacts.
    await ffmpeg(['-y', '-i', tmp, '-pix_fmt', 'rgb24', framePath]);

    saveProject(projectId, { frameTime: t, framePath, frameUrl: toMediaUrl(framePath) });
    res.json({ frameUrl: `${toMediaUrl(framePath)}?t=${Date.now()}`, time: t });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch {} }
  }
});

export default router;
