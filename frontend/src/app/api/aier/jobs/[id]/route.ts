import { getJob } from '@/lib/aier/store.js';

// Poll a background job (download / generate / export / render). Mirrors GET /api/jobs/:id.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
  return Response.json(job);
}
