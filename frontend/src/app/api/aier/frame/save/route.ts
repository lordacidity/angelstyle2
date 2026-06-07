import fs from 'node:fs';
import path from 'node:path';
import { projectDir, toMediaUrl } from '@/lib/aier/paths.js';
import { ffmpeg } from '@/lib/aier/exec.js';
import { saveProject } from '@/lib/aier/store.js';

// Store a frame the BROWSER decoded (canvas grab of the <video>) as the seed, so it's
// pixel-for-pixel what the user saw. Canvas exports RGBA PNG; flatten to rgb24 (lossless)
// because Kling rejects RGBA seed images (bare 403 before generation).
export async function POST(req: Request) {
  let tmp: string | undefined;
  try {
    const form = await req.formData();
    const projectId = String(form.get('projectId') || '');
    const file = form.get('image');
    if (!projectId || !(file instanceof File)) {
      return Response.json({ error: 'projectId and an image are required.' }, { status: 400 });
    }
    const t = Number(form.get('time')) || 0;
    const dir = projectDir(projectId);
    const framePath = path.join(dir, 'frame.png');

    tmp = path.join(dir, 'frame_in.png');
    fs.writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
    await ffmpeg(['-y', '-i', tmp, '-pix_fmt', 'rgb24', framePath]);

    saveProject(projectId, { frameTime: t, framePath, frameUrl: toMediaUrl(framePath) });
    return Response.json({ frameUrl: `${toMediaUrl(framePath)}?t=${Date.now()}`, time: t });
  } catch (err: unknown) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}
