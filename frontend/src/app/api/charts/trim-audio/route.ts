// POST /api/charts/trim-audio { url, start, end, mode, label? } — cut a song
// down to the stretch between start and end (seconds), from the trim editor on
// the Music page. The stretch is encoded like every track (encodeTrackMp3).
//
// mode "copy" files it as a new song beside the original: track-custom-<ms>.mp3
// with a .json that names it `label`, degen when the original is.
//
// mode "replace" writes it over the song itself, and only for songs that were
// added (track-custom-*) — the numbered tracks ship with the app. The stretch
// is encoded to a file beside the song first and renamed over it, so a failed
// encode leaves the song as it was.
import { NextRequest, NextResponse } from 'next/server';
import { rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import {
  AUDIO_DIR, encodeTrackMp3, readTrackMeta, trackFileOf, trackMetaPath, trackPathOf, trackUrl, type TrackMeta,
} from '@/lib/audio-library';
import { errMessage, listDegenTracks, setTrackDegen } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same cap as a rename (/api/vids/music). */
const MAX_TRACK_LABEL = 120;
/** Anything shorter is a slip of a handle, not a song. */
const MIN_SECONDS = 0.5;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const file = trackFileOf(url);
  const source = trackPathOf(url);
  if (!file || !source) return NextResponse.json({ error: 'no song at that url' }, { status: 404 });

  const start = Number(body.start);
  const end = Number(body.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < MIN_SECONDS) {
    return NextResponse.json({ error: 'keep at least half a second of the song' }, { status: 400 });
  }
  const mode = body.mode === 'copy' || body.mode === 'replace' ? body.mode : null;
  if (!mode) return NextResponse.json({ error: 'mode must be copy or replace' }, { status: 400 });
  const durationMs = Math.round((end - start) * 1000);

  if (mode === 'copy') {
    const filename = `track-custom-${Date.now()}.mp3`;
    const out = path.join(AUDIO_DIR, filename);
    const label = (typeof body.label === 'string' ? body.label.trim() : '').slice(0, MAX_TRACK_LABEL) || 'Trimmed song';
    try {
      await encodeTrackMp3(source, out, { start, end });
      const meta: TrackMeta = { label, durationMs };
      await writeFile(trackMetaPath(filename), JSON.stringify(meta, null, 2));
    } catch (err) {
      console.error('[trim-audio copy]', err);
      await unlink(out).catch(() => {});
      return NextResponse.json({ error: errMessage(err) }, { status: 500 });
    }
    const newUrl = trackUrl(filename);
    // Cut from the same song, so the same kind of song. Best effort: the copy
    // is filed either way, and degen is one click to set again.
    let degen = false;
    try {
      degen = (await listDegenTracks()).has(url);
      if (degen) await setTrackDegen(newUrl, true);
    } catch (err) {
      console.error('[trim-audio copy] degen not carried over:', errMessage(err));
      degen = false;
    }
    return NextResponse.json({ url: newUrl, label, durationMs, degen });
  }

  if (!file.startsWith('track-custom-')) {
    return NextResponse.json({ error: "The built-in tracks can't be replaced. Save the trim as a new song." }, { status: 400 });
  }
  // Not a track-* name, so list-audio never offers it while it is being written.
  const tmp = path.join(AUDIO_DIR, `trimming-${Date.now()}-${file}`);
  try {
    await encodeTrackMp3(source, tmp, { start, end });
    await rename(tmp, source);
  } catch (err) {
    console.error('[trim-audio replace]', err);
    await unlink(tmp).catch(() => {});
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
  // The song is shorter now; its .json says so. A saved-from-link song gets
  // its first one here, with no name in it (list-audio keeps its own).
  await writeFile(trackMetaPath(file), JSON.stringify({ ...readTrackMeta(file), durationMs }, null, 2))
    .catch((err) => console.error('[trim-audio replace] length not recorded:', errMessage(err)));
  return NextResponse.json({ url, durationMs });
}
