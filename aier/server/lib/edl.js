// Edit Decision List (EDL) — the contract the timeline editor emits and the renderer consumes.
//
// Model: the VIDEO track is an ordered, gapless concat of normalized segments
// (real → AI → b-roll …); it carries NO audio of its own. ALL sound lives on AUDIO
// tracks as absolutely-positioned items — including a clip's own audio — so it can be
// detached, moved, sped, gained and mixed independently of the picture.
//
// Precision is the renderer's job, not the UI's: every time is snapped to the 30fps grid
// before anything is rendered, so seams always land on a whole frame.

import fs from 'node:fs';
import path from 'node:path';
import { STORAGE } from './paths.js';
import { FPS } from './video.js';

// Snap a time (seconds) to the nearest frame boundary so cuts land on whole frames.
export const snap = (t) => Math.round((Number(t) || 0) * FPS) / FPS;

// Clamp a speed multiplier to a sane editing range (1/8x … 8x); blanks → 1.
function clampSpeed(v) {
  const s = Number(v);
  if (!s || s <= 0) return 1;
  return Math.min(8, Math.max(0.125, s));
}

// Resolve an EDL `src` (a /media URL or a storage-relative path) to an absolute file,
// refusing anything that escapes storage/ (path-traversal guard) or doesn't exist.
export function resolveMediaPath(src) {
  let rel = String(src || '').trim();
  // Tolerate absolute media URLs. The Vercel-hosted /ai-maker SPA talks to this server
  // cross-origin, so the EDL it sends back carries http://localhost:PORT/media/... — reduce
  // any absolute URL to its /media/ path before resolving under storage.
  if (/^https?:\/\//i.test(rel)) {
    const i = rel.indexOf('/media/');
    if (i >= 0) rel = rel.slice(i);
  }
  if (rel.startsWith('/media/')) rel = rel.slice('/media/'.length);
  rel = rel.replace(/^[\\/]+/, '');
  const root = path.resolve(STORAGE);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`EDL src escapes storage: ${src}`);
  }
  if (!fs.existsSync(abs)) throw new Error(`EDL src not found: ${src}`);
  return abs;
}

// atempo only accepts a factor in 0.5..2.0, so an arbitrary speed becomes a chain of them.
export function atempoChain(speed) {
  let s = Number(speed) || 1;
  if (!(s > 0)) s = 1;
  const parts = [];
  while (s > 2.0 + 1e-9) { parts.push('atempo=2.0'); s /= 2.0; }
  while (s < 0.5 - 1e-9) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) parts.push(`atempo=${s.toFixed(6)}`);
  return parts;
}

// Validate + normalize a raw EDL into a clean, frame-snapped shape the renderer can trust.
export function normalizeEdl(raw) {
  const e = raw || {};

  const videoTrack = (Array.isArray(e.videoTrack) ? e.videoTrack : []).map((c, i) => {
    const inP = Math.max(0, snap(c.in));
    const out = snap(c.out);
    if (!(out > inP)) throw new Error(`videoTrack[${i}]: out must be greater than in.`);
    const speed = clampSpeed(c.speed);
    return {
      src: c.src,
      in: inP,
      out,
      speed,
      crop: c.crop || null,
      outDur: snap((out - inP) / speed), // rendered (output) duration of this segment
    };
  });
  if (!videoTrack.length) throw new Error('EDL has no video clips.');

  const audioTracks = (Array.isArray(e.audioTracks) ? e.audioTracks : []).map((a, i) => {
    const inP = Math.max(0, snap(a.in));
    const out = snap(a.out);
    if (!(out > inP)) throw new Error(`audioTracks[${i}]: out must be greater than in.`);
    const speed = clampSpeed(a.speed);
    return {
      src: a.src,
      in: inP,
      out,
      speed,
      start: Math.max(0, snap(a.start)),
      gain: a.gain == null ? 1 : Math.max(0, Number(a.gain)),
      outDur: snap((out - inP) / speed),
    };
  });

  const duration = snap(videoTrack.reduce((s, c) => s + c.outDur, 0));
  return { fps: FPS, crop: e.crop || null, videoTrack, audioTracks, duration };
}
