import fs from 'node:fs';
import { PROJECTS_DIR, toMediaUrl } from '@/lib/aier/paths.js';
import { getProject } from '@/lib/aier/store.js';
import { FPS } from '@/lib/aier/video.js';

// GET /api/aier/dev/projects -> saved projects that have media, newest first (quick picker).
export async function GET() {
  let ids: string[] = [];
  try { ids = fs.readdirSync(PROJECTS_DIR); } catch { /* none yet */ }
  const out = [];
  for (const id of ids) {
    const p = getProject(id);
    if (!p?.sourcePath || !fs.existsSync(p.sourcePath)) continue;
    const hasKling = !!p.klingPath && fs.existsSync(p.klingPath);
    out.push({
      id,
      title: p.title || '(untitled)',
      sourceUrl: toMediaUrl(p.sourcePath),
      klingUrl: hasKling ? toMediaUrl(p.klingPath) : null,
      hasKling,
      width: p.width || 0, height: p.height || 0, fps: p.fps || FPS,
      duration: p.duration || 0, klingDuration: p.klingDuration || null,
      frameUrl: p.framePath && fs.existsSync(p.framePath) ? toMediaUrl(p.framePath) : null,
      updatedAt: p.updatedAt || '',
    });
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return Response.json({ projects: out.slice(0, 40) });
}
