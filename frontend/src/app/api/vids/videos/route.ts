// POST /api/vids/videos — register a clip whose bytes are already in the bucket
// (see /sign). The paths must be the ones we minted for that id, so a client
// can't point a row at somebody else's object.
import { NextRequest, NextResponse } from 'next/server';
import { createVideo, errMessage, isUuid } from '@/lib/vids-db';
import type { CreateVideoInput } from '@/lib/vids-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Partial<Record<keyof CreateVideoInput, unknown>>;
  const id = b.id;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 200) : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : '';
  if (!new RegExp(`^videos/${id}\\.[a-z0-9]{2,5}$`).test(storagePath)) {
    return NextResponse.json({ error: 'storagePath does not match this id' }, { status: 400 });
  }
  const thumbPath = b.thumbPath == null ? null : b.thumbPath;
  if (thumbPath !== null && thumbPath !== `thumbs/${id}.jpg`) {
    return NextResponse.json({ error: 'thumbPath does not match this id' }, { status: 400 });
  }
  const folderId = b.folderId == null ? null : b.folderId;
  if (folderId !== null && !isUuid(folderId)) {
    return NextResponse.json({ error: 'folderId must be a folder id' }, { status: 400 });
  }

  const input: CreateVideoInput = {
    id,
    folderId,
    name,
    storagePath,
    thumbPath,
    mimeType: typeof b.mimeType === 'string' && b.mimeType ? b.mimeType.slice(0, 80) : 'video/mp4',
    sizeBytes: Math.max(0, Math.round(num(b.sizeBytes) ?? 0)),
    duration: num(b.duration),
    width: num(b.width) === null ? null : Math.round(num(b.width) as number),
    height: num(b.height) === null ? null : Math.round(num(b.height) as number),
  };
  try {
    return NextResponse.json(await createVideo(input));
  } catch (err) {
    console.error('[vids videos POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
