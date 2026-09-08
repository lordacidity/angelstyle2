// /api/vids/folders/:id — rename (PATCH { name }) or delete (DELETE).
// Deleting cascades to sub-folders; videos inside drop back to the root.
import { NextRequest, NextResponse } from 'next/server';
import { deleteFolder, errMessage, isUuid, renameFolder } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  try {
    const folder = await renameFolder(id, name);
    if (!folder) return NextResponse.json({ error: 'folder not found' }, { status: 404 });
    return NextResponse.json(folder);
  } catch (err) {
    console.error('[vids folders PATCH]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    const ok = await deleteFolder(id);
    if (!ok) return NextResponse.json({ error: 'folder not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[vids folders DELETE]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
