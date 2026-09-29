// POST /api/charts/trim-audio { url, start, end, mode, label? } — cut a song
// down to the stretch between start and end (seconds), from the trim editor on
// the Music page. The stretch is encoded like every track (encodeTrackMp3).
//
// mode "copy" files it as a new song beside the original: track-custom-<ms>.mp3
// in the Vids bucket, named `label`, degen when the original is.
//
// mode "replace" writes it over the song itself, and only for songs added on
// the Music page, which are in the bucket — the ones in public/audio ship with
// the app, and a deployment can't write to its own files. The stretch is
// encoded to the temp dir first and only then put up over the song, so a
// failed encode leaves the song as it was.
import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { encodeTrackMp3, newTrackFile, openTrack, trackUrl } from '@/lib/audio-library';
import { errMessage, listDegenTracks, saveCloudTrack, setTrackDegen } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Same cap as a rename (/api/vids/music). */
const MAX_TRACK_LABEL = 120;
/** Anything shorter is a slip of a handle, not a song. */
const MIN_SECONDS = 0.5;


type Track = NonNullable<Awaited<ReturnType<typeof openTrack>>>;

interface Cut {
  url: string;
  start: number;
  end: number;
  durationMs: number;
  label: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const start = Number(body.start);
  const end = Number(body.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < MIN_SECONDS) {
    return NextResponse.json({ error: 'keep at least half a second of the song' }, { status: 400 });
  }
  const mode = body.mode === 'copy' || body.mode === 'replace' ? body.mode : null;
  if (!mode) return NextResponse.json({ error: 'mode must be copy or replace' }, { status: 400 });
  const cut: Cut = {
    url, start, end,
    durationMs: Math.round((end - start) * 1000),
    label: (typeof body.label === 'string' ? body.label.trim() : '').slice(0, MAX_TRACK_LABEL) || 'Trimmed song',
  };

  let source: Track | null;
  try {
    source = await openTrack(url);
  } catch (err) {
    console.error('[trim-audio open]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
  if (!source) return NextResponse.json({ error: 'no song at that url' }, { status: 404 });
  if (mode === 'replace' && !source.cloud) {
    await source.done();
    return NextResponse.json({ error: "This song ships with the app and can't be replaced. Save the trim as a new song." }, { status: 400 });
  }

  const out = path.join(os.tmpdir(), `trimmed-${Date.now()}.mp3`);
  try {
    await encodeTrackMp3(source.path, out, { start, end });
    return mode === 'copy' ? await fileCopy(cut, out) : await replace(source, cut, out);
  } catch (err) {
    console.error(`[trim-audio ${mode}]`, err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  } finally {
    await source.done();
    await unlink(out).catch(() => {});
  }
}

async function fileCopy(cut: Cut, out: string): Promise<NextResponse> {
  const filename = newTrackFile();
  await saveCloudTrack(filename, out, { label: cut.label, durationMs: cut.durationMs });
  const newUrl = trackUrl(filename);
  // Cut from the same song, so the same kind of song. Best effort: the copy
  // is filed either way, and degen is one click to set again.
  let degen = false;
  try {
    degen = (await listDegenTracks()).has(cut.url);
    if (degen) await setTrackDegen(newUrl, true);
  } catch (err) {
    console.error('[trim-audio copy] degen not carried over:', errMessage(err));
    degen = false;
  }
  return NextResponse.json({ url: newUrl, label: cut.label, durationMs: cut.durationMs, degen });
}

async function replace(source: Track, cut: Cut, out: string): Promise<NextResponse> {
  // The song is shorter now, and its row says so; its name stays.
  await saveCloudTrack(source.file, out, { durationMs: cut.durationMs });
  return NextResponse.json({ url: cut.url, durationMs: cut.durationMs });
}
