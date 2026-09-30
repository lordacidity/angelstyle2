// /api/vids/ig-audio — the Instagram sounds a published video can go out on,
// kept on the Music page and offered in Vids 2's Publish panel (Hyper
// Attention alone: its operator picks the sound natively in the app, and
// api/hyperattention/push names it to every post as `audioUrl`).
//   GET                          → IgAudio[]        newest first
//   POST   { name, url }         → IgAudio
//   PATCH  { id, name?, url? }   → IgAudio          a field left out keeps its value
//   DELETE ?id=                  → { ok: true }
//
// `url` is whatever Hyper Attention takes for a sound — a link to the audio
// page (instagram.com/reels/audio/…), the audio's id, or the track's name —
// so it is held to being non-empty and short, nothing more. Studio-only: not
// in middleware.ts's clipper allowlist.
import { NextRequest, NextResponse } from 'next/server';
import { createIgAudio, deleteIgAudio, errMessage, isUuid, listIgAudio, updateIgAudio } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAME = 120;
const MAX_URL = 500;

/** A string field off the body, trimmed and cut to length — or null when it
 *  wasn't sent, or '' when it was sent empty. */
const field = (body: Record<string, unknown>, key: string, max: number): string | null =>
  (key in body ? (typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, max) : '') : null);

export async function GET() {
  try {
    return NextResponse.json(await listIgAudio());
  } catch (err) {
    console.error('[vids ig-audio GET]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = field(body, 'name', MAX_NAME);
  const url = field(body, 'url', MAX_URL);
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!url) return NextResponse.json({ error: 'the audio link is required' }, { status: 400 });
  try {
    return NextResponse.json(await createIgAudio(name, url));
  } catch (err) {
    console.error('[vids ig-audio POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isUuid(body.id)) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const name = field(body, 'name', MAX_NAME);
  const url = field(body, 'url', MAX_URL);
  if (name === null && url === null) return NextResponse.json({ error: 'name or url required' }, { status: 400 });
  if (name === '') return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
  if (url === '') return NextResponse.json({ error: 'the audio link cannot be empty' }, { status: 400 });
  try {
    const row = await updateIgAudio(body.id, { ...(name !== null ? { name } : {}), ...(url !== null ? { url } : {}) });
    if (!row) return NextResponse.json({ error: 'no such sound' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[vids ig-audio PATCH]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!isUuid(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  try {
    if (!(await deleteIgAudio(id))) return NextResponse.json({ error: 'no such sound' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[vids ig-audio DELETE]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
