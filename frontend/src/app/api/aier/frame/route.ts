import path from 'node:path';
import { projectDir, toMediaUrl } from '@/lib/aier/paths.js';
import { ffmpeg } from '@/lib/aier/exec.js';
import { getProject, saveProject } from '@/lib/aier/store.js';

// Extract a single, frame-accurate still at `time`. Prefer /frame/save (browser-decoded,
// pixel-perfect); this ffmpeg decode can differ slightly in YUV→RGB.
export async function POST(req: Request) {
  try {
    const { projectId, time } = await req.json().catch(() => ({}));
    if (!projectId || typeof time !== 'number') {
      return Response.json({ error: 'projectId and numeric time are required.' }, { status: 400 });
    }
    const project = getProject(projectId);
    if (!project.sourcePath) return Response.json({ error: 'Project source not found.' }, { status: 404 });

    const dir = projectDir(projectId);
    const framePath = path.join(dir, 'frame.png');
    // -ss AFTER -i = accurate (decode-to-timestamp) seek, so we hit the exact frame.
    await ffmpeg(['-y', '-i', project.sourcePath, '-ss', String(time), '-frames:v', '1', framePath]);

    saveProject(projectId, { frameTime: time, framePath, frameUrl: toMediaUrl(framePath) });
    return Response.json({ frameUrl: `${toMediaUrl(framePath)}?t=${Date.now()}`, time });
  } catch (err: unknown) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
