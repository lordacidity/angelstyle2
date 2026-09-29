// POST /api/charts/upload-audio/sign { name } — a signed address in the Vids
// bucket for the Music page to put a song file at, before upload-audio files
// it. Only the file's extension is kept from its name, so ffmpeg knows what it
// is reading.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { MUSIC_UPLOADS } from '@/lib/audio-library';
import { errMessage, signUpload } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name : '';
  const ext = (/\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? '').toLowerCase();
  try {
    return NextResponse.json(await signUpload(`${MUSIC_UPLOADS}${randomUUID()}${ext}`));
  } catch (err) {
    console.error('[upload-audio sign]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
