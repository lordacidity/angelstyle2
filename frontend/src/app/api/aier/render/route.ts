import { projectDir } from '@/lib/aier/paths.js';
import { getProject, saveProject, createJob, runJob } from '@/lib/aier/store.js';
import { renderEdl } from '@/lib/aier/render.js';

// POST /api/aier/render { projectId, edl } -> { jobId }
// Renders a full timeline EDL (trims, splits, speed, extra clips, detached/added audio,
// gains, moves) to one final.mp4. Poll /api/aier/jobs/:id for progress.
export async function POST(req: Request) {
  const { projectId, edl } = await req.json().catch(() => ({}));
  if (!projectId || !edl) {
    return Response.json({ error: 'projectId and edl are required.' }, { status: 400 });
  }
  const project = getProject(projectId);
  if (!project.id) return Response.json({ error: 'Project not found.' }, { status: 404 });

  const jobId = createJob('render');
  // update is the patch callback from store.runJob; renderEdl's default-typed `update` param
  // (inferred () => void from its JS default) needs the looser type here.
  runJob(jobId, async (update: (patch: Record<string, unknown>) => void) => {
    const dir = projectDir(projectId);
    const out = await renderEdl({ project, edl, dir, update: update as () => void });
    saveProject(projectId, { finalPath: out.finalPath, finalUrl: out.finalUrl, edl });
    update({ logLine: 'Done.', progress: 100 });
    return { ...out, finalUrl: `${out.finalUrl}?t=${Date.now()}` };
  });

  return Response.json({ jobId });
}
