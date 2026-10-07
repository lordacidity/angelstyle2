// /api/vids/videos/:id/lite — a clip's lighter copy, for the clipper page.
//
// The clipper build is handed this file in place of the clip's own wherever
// there is one (toVideo in lib/vids-db): the same footage, sized to what a
// build's frame shows of it, so a phone neither fetches nor decodes more than
// that. scripts/make-lite.mjs makes them and is the only caller.
//
//   POST    -> { path, url }  where to PUT the copy's bytes
//   PUT     { path, sizeBytes, width, height }  the copy is up: point the clip at it
//   DELETE  take it away again; the clipper build is back on the clip's own file
//
// The Studio's alone: not in the clipper allowlist (middleware).
import { NextRequest, NextResponse } from 'next/server';
import { clearLite, errMessage, isLitePathOf, isUuid, litePathFor, setLite, signUpload } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    return NextResponse.json(await signUpload(litePathFor(id)));
  } catch (err) {
    console.error('[vids lite POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const sizeBytes = num(body.sizeBytes);
  const width = num(body.width);
  const height = num(body.height);
  if (!isLitePathOf(id, body.path) || !sizeBytes || !width || !height) {
    return NextResponse.json({ error: 'path, sizeBytes, width and height are all needed' }, { status: 400 });
  }
  try {
    const ok = await setLite(id, { path: body.path, sizeBytes, width, height });
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'video not found' }, { status: 404 });
  } catch (err) {
    console.error('[vids lite PUT]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    const ok = await clearLite(id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'video not found' }, { status: 404 });
  } catch (err) {
    console.error('[vids lite DELETE]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
