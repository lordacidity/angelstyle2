// POST /api/charts/upload-audio { path, name } — put a song from this computer
// in the library, from the Music page. The file itself never comes through
// here: Vercel turns away a request body over 4.5 MB, and a WAV or a video is
// often bigger, so the page asks upload-audio/sign for a bucket address, puts
// the file there, and then sends its path. Whatever it is (an MP3, a WAV, the
// sound off a video) is filed the way every added song is: track-custom-<ms>.mp3
// in the Vids bucket, 44.1 kHz stereo 192k with its tags and cover art stripped
// (encodeTrackMp3), named after the file it came in as and with its real
// length (vids_tracks). The upload it was made from is then thrown away. A
// rename later goes through PATCH /api/vids/music like any other song's.
import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import path from 'path';
import os from 'os';
import { MUSIC_UPLOADS, encodeTrackMp3, newTrackFile, trackUrl } from '@/lib/audio-library';
import { downloadObject, errMessage, removeObjects, saveCloudTrack } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Same cap as a rename (/api/vids/music). */
const MAX_TRACK_LABEL = 120;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const upload = typeof body.path === 'string' ? body.path : '';
  const name = typeof body.name === 'string' ? body.name : '';
  // Only a path sign handed out, so this can't be pointed at the library's
  // videos or anything else in the bucket.
  if (!upload.startsWith(MUSIC_UPLOADS) || upload.includes('..')) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  const filename = newTrackFile();
  const ts = Date.now();
  const tmpIn = path.join(os.tmpdir(), `music-upload-${ts}${path.extname(upload).slice(0, 10)}`);
  const tmpOut = path.join(os.tmpdir(), `music-encoded-${ts}.mp3`);

  try {
    await downloadObject(upload, tmpIn);
    const durationMs = await encodeTrackMp3(tmpIn, tmpOut);
    const label = (name.replace(/\.[^.]+$/, '').trim() || 'Untitled').slice(0, MAX_TRACK_LABEL);
    await saveCloudTrack(filename, tmpOut, { label, durationMs });
    return NextResponse.json({ url: trackUrl(filename), label, durationMs: durationMs ?? null });
  } catch (err) {
    console.error('[upload-audio]', err);
    const msg = errMessage(err);
    const unreadable = /invalid data|does not contain any stream|output file #0 does not contain/i.test(msg);
    return NextResponse.json(
      { error: unreadable ? `Couldn't read ${name || 'that file'} as audio.` : msg },
      { status: unreadable ? 400 : 500 },
    );
  } finally {
    await unlink(tmpIn).catch(() => {});
    await unlink(tmpOut).catch(() => {});
    await removeObjects([upload]);
  }
}
