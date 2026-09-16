// /api/vids/videos/:id — rename / move / say what the clip is showing, as a
// whole or stretch by stretch, or put it on offer to the clippers (PATCH
// { name?, folderId?, context?, marks?, clipable? }),
// swap the bytes an edit produced in over the last render (PATCH { media,
// name?, marks? } — `media.edit` is the edit they were rendered with, and the
// recording itself is kept, see replaceVideoMedia), or delete (DELETE: row +
// the bucket objects, recording included).
import { NextRequest, NextResponse } from 'next/server';
import {
  deleteVideo, errMessage, isUuid, replaceVideoMedia, updateVideo,
  type VideoMedia, type VideoPatch,
} from '@/lib/vids-db';
import { cleanEdit, cleanMarks, readClipablePatch, readContextPatch } from '@/lib/vids-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The paths a replacement may point at: the ones /sign mints for this very id,
 *  so a client can't repoint a row at somebody else's object. */
const mediaPaths = (id: string) => ({
  video: new RegExp(`^videos/${id}(-[0-9a-f]{4,16})?\\.[a-z0-9]{2,5}$`),
  thumb: new RegExp(`^thumbs/${id}(-[0-9a-f]{4,16})?\\.jpg$`),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // A media swap is its own operation: same row, new bytes, optionally a new name.
  if (body.media !== undefined) {
    const m = (body.media ?? {}) as Partial<Record<keyof VideoMedia, unknown>>;
    const paths = mediaPaths(id);
    const storagePath = typeof m.storagePath === 'string' ? m.storagePath : '';
    if (!paths.video.test(storagePath)) {
      return NextResponse.json({ error: 'storagePath does not match this id' }, { status: 400 });
    }
    const thumbPath = m.thumbPath == null ? null : String(m.thumbPath);
    if (thumbPath !== null && !paths.thumb.test(thumbPath)) {
      return NextResponse.json({ error: 'thumbPath does not match this id' }, { status: 400 });
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : undefined;
    if (name !== undefined && !name) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    const media: VideoMedia = {
      storagePath,
      thumbPath,
      mimeType: typeof m.mimeType === 'string' && m.mimeType ? m.mimeType.slice(0, 80) : 'video/mp4',
      sizeBytes: Math.max(0, Math.round(num(m.sizeBytes) ?? 0)),
      duration: num(m.duration),
      width: num(m.width) === null ? null : Math.round(num(m.width) as number),
      height: num(m.height) === null ? null : Math.round(num(m.height) as number),
      hasSfx: m.hasSfx === true,
      edit: cleanEdit(m.edit),
    };
    // An edit moves every mark, so the editor re-times them and sends them with
    // the new bytes. Absent means nothing moved — leave them alone.
    const marks = body.marks === undefined ? undefined : cleanMarks(body.marks);
    try {
      const row = await replaceVideoMedia(id, media, name, marks);
      if (!row) return NextResponse.json({ error: 'video not found' }, { status: 404 });
      return NextResponse.json(row);
    } catch (err) {
      console.error('[vids videos PATCH media]', err);
      return NextResponse.json({ error: errMessage(err) }, { status: 500 });
    }
  }

  const patch: VideoPatch = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    patch.name = name;
  }
  if (body.folderId !== undefined) {
    if (body.folderId !== null && !isUuid(body.folderId)) {
      return NextResponse.json({ error: 'folderId must be a folder id or null' }, { status: 400 });
    }
    patch.folderId = body.folderId as string | null;
  }
  readContextPatch(body, patch);
  readClipablePatch(body, patch);
  if (body.marks !== undefined) patch.marks = cleanMarks(body.marks);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }
  try {
    const row = await updateVideo(id, patch);
    if (!row) return NextResponse.json({ error: 'video not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[vids videos PATCH]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    const ok = await deleteVideo(id);
    if (!ok) return NextResponse.json({ error: 'video not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[vids videos DELETE]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
