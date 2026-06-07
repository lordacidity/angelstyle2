import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// repo root = .../AI-maker
export const ROOT = path.resolve(__dirname, '..', '..');
// Persistence root. Defaults to ./storage for local dev; set STORAGE_ROOT to a mounted
// volume path (e.g. /data on Railway) in production so projects/refs/audio/settings survive
// redeploys. Every path below derives from this, so this one line redirects ALL writes.
export const STORAGE = process.env.STORAGE_ROOT || path.join(ROOT, 'storage');
export const PROJECTS_DIR = path.join(STORAGE, 'projects');
export const REFS_DIR = path.join(STORAGE, 'refs');
export const AUDIO_DIR = path.join(STORAGE, 'audio'); // admin sound library (music/sfx/voice)
export const SETTINGS_FILE = path.join(STORAGE, 'settings.json');

export function ensureDirs() {
  for (const d of [STORAGE, PROJECTS_DIR, REFS_DIR, AUDIO_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function projectDir(id) {
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Convert an absolute path inside STORAGE into a browser URL under /media
export function toMediaUrl(absPath) {
  const rel = path.relative(STORAGE, absPath).split(path.sep).join('/');
  return `/media/${rel}`;
}

// Given a stored asset reference ({ file, url } or a path/URL string), return an
// absolute path that actually EXISTS under the CURRENT storage dir. Stored `file`
// paths are absolute and break the moment the project folder is moved/renamed
// (e.g. "AI-maker - Copy" → "aier"); the `/media/...` url is storage-relative and
// survives the move, so we remap it onto THIS storage dir as the fallback.
export function resolveStoragePath(ref) {
  if (!ref) return null;
  const file = typeof ref === 'string' ? ref : ref.file;
  const url = typeof ref === 'string' ? (ref.startsWith('/media/') ? ref : null) : ref.url;
  if (file && fs.existsSync(file)) return file;
  if (url && url.startsWith('/media/')) {
    const remapped = path.join(STORAGE, url.slice('/media/'.length).split('/').join(path.sep));
    if (fs.existsSync(remapped)) return remapped;
  }
  // last resort: same filename under refs/ then audio/
  if (file) {
    for (const d of [REFS_DIR, AUDIO_DIR]) {
      const p = path.join(d, path.basename(file));
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
