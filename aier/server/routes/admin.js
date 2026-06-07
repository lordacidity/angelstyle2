import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { REFS_DIR, AUDIO_DIR, toMediaUrl } from '../lib/paths.js';
import { probe } from '../lib/exec.js';
import { getSettings, saveSettings, KLING_MODELS } from '../lib/store.js';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, REFS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

const audioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const uploadAudio = multer({ storage: audioStorage, limits: { fileSize: 50 * 1024 * 1024 } });

function publicState() {
  return {
    settings: getSettings(),
    env: {
      fal: !!process.env.FAL_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    klingModels: KLING_MODELS,
  };
}

// GET /api/admin/settings
router.get('/settings', (_req, res) => res.json(publicState()));

// PUT /api/admin/settings  (partial update of allowed fields)
router.put('/settings', (req, res) => {
  // No audio / no lipsync: generateAudio + voiceScript are gone from the AI flow.
  const allowed = ['klingModel', 'defaultDuration', 'cfgScale', 'promptTemplate', 'negativePrompt'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if ('defaultDuration' in patch) {
    const d = Math.round(Number(patch.defaultDuration));
    patch.defaultDuration = Math.min(15, Math.max(3, d || 5));
  }
  if ('cfgScale' in patch) patch.cfgScale = Math.min(1, Math.max(0, Number(patch.cfgScale) || 0.5));
  saveSettings(patch);
  res.json(publicState());
});

// POST /api/admin/refs  (multipart: image, label)
router.post('/refs', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
  const settings = getSettings();
  const ref = {
    id: crypto.randomUUID(),
    label: (req.body.label || '').trim() || `Reference ${(settings.refs?.length || 0) + 1}`,
    file: req.file.path,
    url: toMediaUrl(req.file.path),
  };
  saveSettings({ refs: [...(settings.refs || []), ref] });
  res.json(publicState());
});

// DELETE /api/admin/refs/:id
router.delete('/refs/:id', (req, res) => {
  const settings = getSettings();
  const ref = (settings.refs || []).find((r) => r.id === req.params.id);
  if (ref?.file) { try { fs.unlinkSync(ref.file); } catch {} }
  saveSettings({ refs: (settings.refs || []).filter((r) => r.id !== req.params.id) });
  res.json(publicState());
});

// POST /api/admin/refs/reorder { ids: [...] }  (first = frontal "@Element1")
router.post('/refs/reorder', (req, res) => {
  const { ids } = req.body || {};
  const settings = getSettings();
  const byId = new Map((settings.refs || []).map((r) => [r.id, r]));
  const reordered = (ids || []).map((id) => byId.get(id)).filter(Boolean);
  // append any not mentioned, to avoid data loss
  for (const r of settings.refs || []) if (!ids?.includes(r.id)) reordered.push(r);
  saveSettings({ refs: reordered });
  res.json(publicState());
});

// ---------- Audio library (music / sfx / voice for the timeline editor) ----------

// POST /api/admin/audio  (multipart: audio, label)
router.post('/audio', uploadAudio.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded.' });
  const settings = getSettings();
  let duration = null;
  try { duration = (await probe(req.file.path)).duration || null; } catch {}
  const clip = {
    id: crypto.randomUUID(),
    label: (req.body.label || '').trim()
      || path.parse(req.file.originalname).name
      || `Audio ${(settings.audio?.length || 0) + 1}`,
    file: req.file.path,
    url: toMediaUrl(req.file.path),
    duration,
  };
  saveSettings({ audio: [...(settings.audio || []), clip] });
  res.json(publicState());
});

// DELETE /api/admin/audio/:id
router.delete('/audio/:id', (req, res) => {
  const settings = getSettings();
  const clip = (settings.audio || []).find((a) => a.id === req.params.id);
  if (clip?.file) { try { fs.unlinkSync(clip.file); } catch {} }
  saveSettings({ audio: (settings.audio || []).filter((a) => a.id !== req.params.id) });
  res.json(publicState());
});

export default router;
