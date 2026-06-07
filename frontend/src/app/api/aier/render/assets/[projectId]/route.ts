import fs from 'node:fs';
import { toMediaUrl } from '@/lib/aier/paths.js';
import { probe, hasAudioStream } from '@/lib/aier/exec.js';
import { getProject, getSettings } from '@/lib/aier/store.js';
import { FPS } from '@/lib/aier/video.js';

// GET /api/aier/render/assets/:projectId -> media the editor can drop on the timeline.
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project.id) return Response.json({ error: 'Project not found.' }, { status: 404 });

  const clips: Array<Record<string, unknown>> = [];
  const addClip = async (label: string, abs: string | undefined) => {
    if (!abs || !fs.existsSync(abs)) return;
    try {
      const info = await probe(abs);
      clips.push({
        label,
        src: toMediaUrl(abs),
        duration: info.duration,
        width: info.width,
        height: info.height,
        hasAudio: await hasAudioStream(abs),
      });
    } catch { /* skip unreadable */ }
  };
  await addClip('Real footage', project.sourcePath);
  await addClip('AI clip (Kling)', project.klingPath);

  const audioLibrary = (getSettings().audio || []).map((a: Record<string, unknown>) => ({
    id: a.id, label: a.label, src: a.url, duration: a.duration || null,
  }));

  return Response.json({ canvas: { fps: FPS }, clips, audioLibrary, savedEdl: project.edl || null });
}
