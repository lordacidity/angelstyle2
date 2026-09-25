// DELETE /api/hyperattention/queue/[id] — cancel one queued post. The only
// write the Hyper Attention section makes; Hyper Attention itself refuses a
// post that is no longer `queued`, and its message comes back as is.
// Studio-only: absent from middleware.ts's CLIPPER_API allowlist, so it 404s
// on the pauv.io/clipping build.
import { NextRequest, NextResponse } from 'next/server';
import { HyperAttentionError, cancelQueued } from '@/lib/hyperattention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await cancelQueued(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HyperAttentionError) {
      return NextResponse.json(
        { error: err.message, requestId: err.requestId, details: err.details },
        { status: err.status },
      );
    }
    console.error('[hyperattention queue DELETE]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
