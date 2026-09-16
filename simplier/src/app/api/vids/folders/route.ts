// POST /api/vids/folders { name, parentId } — create a folder (parentId null =
// top level). With { name, ensure: true } it instead gets-or-creates the
// top-level folder of that name, which is how the four fixed folders are made
// sure of without two simultaneous visitors creating two of each.
import { NextRequest, NextResponse } from 'next/server';
import { createFolder, ensureTopFolder, errMessage, isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; parentId?: unknown; ensure?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (body.ensure === true) {
    try {
      return NextResponse.json(await ensureTopFolder(name));
    } catch (err) {
      console.error('[vids folders ensure]', err);
      return NextResponse.json({ error: errMessage(err) }, { status: 500 });
    }
  }
  const parentId = body.parentId == null ? null : body.parentId;
  if (parentId !== null && !isUuid(parentId)) {
    return NextResponse.json({ error: 'parentId must be a folder id' }, { status: 400 });
  }
  try {
    return NextResponse.json(await createFolder(name, parentId));
  } catch (err) {
    console.error('[vids folders POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
