// POST /api/charts/upload-audio (multipart, field "file") — put a song from
// this computer in the library, from the Music page. Whatever comes in (an MP3,
// a WAV, the sound off a video) is filed the way every track is filed:
// public/audio/track-custom-<ms>.mp3, 44.1 kHz stereo 192k with its tags and
// cover art stripped (encodeTrackMp3). Beside it goes a .json with the file's
// own name as the song's name and its real length, which list-audio reads
// (lib/audio-library). A rename later goes through PATCH /api/vids/music like
// any other song's.
import { NextRequest, NextResponse } from 'next/server';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { AUDIO_DIR, encodeTrackMp3, trackMetaPath, trackUrl, type TrackMeta } from '@/lib/audio-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same cap as a rename (/api/vids/music). */
const MAX_TRACK_LABEL = 120;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  const ts = Date.now();
  const filename = `track-custom-${ts}.mp3`;
  const outMp3 = path.join(AUDIO_DIR, filename);
  const tmpIn = path.join(os.tmpdir(), `music-upload-${ts}${path.extname(file.name).slice(0, 10)}`);

  try {
    await mkdir(AUDIO_DIR, { recursive: true });
    await writeFile(tmpIn, Buffer.from(await file.arrayBuffer()));
    const durationMs = await encodeTrackMp3(tmpIn, outMp3);

    const label = (file.name.replace(/\.[^.]+$/, '').trim() || 'Untitled').slice(0, MAX_TRACK_LABEL);
    const meta: TrackMeta = { label, ...(durationMs ? { durationMs } : {}) };
    await writeFile(trackMetaPath(filename), JSON.stringify(meta, null, 2));

    return NextResponse.json({ url: trackUrl(filename), label, durationMs: durationMs ?? null });
  } catch (err) {
    console.error('[upload-audio]', err);
    // Half an MP3 is no song — don't leave one in the library.
    await unlink(outMp3).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    const unreadable = /invalid data|does not contain any stream|output file #0 does not contain/i.test(msg);
    return NextResponse.json(
      { error: unreadable ? `Couldn't read ${file.name} as audio.` : msg },
      { status: unreadable ? 400 : 500 },
    );
  } finally {
    await unlink(tmpIn).catch(() => {});
  }
}
