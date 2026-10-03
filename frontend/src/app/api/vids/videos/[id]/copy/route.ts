// POST /api/vids/videos/:id/copy { name, folderId } — a second clip with the
// same footage as this one, copied inside the bucket (see copyVideo). For a
// clip that would otherwise be rendered and uploaded again to come out the
// same: "use previous edits" in Make persona video.
import { NextRequest, NextResponse } from 'next/server';
import { copyVideo, errMessage, isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; folderId?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
  if (body.folderId != null && !isUuid(body.folderId)) {
    return NextResponse.json({ error: 'folderId must be a folder id or null' }, { status: 400 });
  }
  try {
    const row = await copyVideo(id, name, (body.folderId as string | null | undefined) ?? null);
    if (!row) return NextResponse.json({ error: 'video not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[vids videos copy POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
