// The audio library on disk — public/audio — as the server sees it. Songs are
// the `track-*.mp3` files there; the beds the Vids builder lays under a video
// (room-tone.mp3, keyboard-typing.wav) live beside them but are part of the
// app, not songs anyone picks, so they are never tracks.
//
// Server-only (node fs). Shared by /api/charts/list-audio, which lists the
// tracks, and the Vids routes that take a track by its url — its clipable
// flag, its name — and have to check it is one.

import { existsSync, readFileSync } from 'fs';
import path from 'path';

export const AUDIO_DIR = path.join(process.cwd(), 'public', 'audio');

/** A song's url, as list-audio hands it over: /audio/<track file>. */
const TRACK_URL_RE = /^\/audio\/(track-[A-Za-z0-9_-]+\.mp3)$/;

export const isTrackFile = (name: string): boolean => name.startsWith('track-') && name.endsWith('.mp3');

export const trackUrl = (file: string): string => `/audio/${file}`;

/** The file a track url names, or null when the url isn't a track's. */
export function trackFileOf(url: string): string | null {
  const m = TRACK_URL_RE.exec(url);
  return m ? m[1] : null;
}

/** Whether this url is a track that is actually in the library right now. */
export function trackExists(url: string): boolean {
  const file = trackFileOf(url);
  return !!file && existsSync(path.join(AUDIO_DIR, file));
}

/** What an uploaded song says about itself, in a <track>.json beside it: the
 *  name of the file it came in as, and how long it really runs. Songs filed by
 *  hand have a PRELOADED row in list-audio instead, and one saved from a link
 *  has neither. delete-audio takes the .json away with the song. */
export interface TrackMeta {
  label?: string;
  durationMs?: number;
}

export const trackMetaPath = (file: string): string =>
  path.join(AUDIO_DIR, file.replace(/\.mp3$/, '.json'));

/** A track's .json, or nothing when it has none or it can't be read. */
export function readTrackMeta(file: string): TrackMeta {
  try {
    const raw = JSON.parse(readFileSync(trackMetaPath(file), 'utf8')) as Record<string, unknown>;
    return {
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined,
      durationMs: typeof raw.durationMs === 'number' && raw.durationMs > 0 ? Math.round(raw.durationMs) : undefined,
    };
  } catch {
    return {};
  }
}

/** Where a track file is, when the url names one that is in the library. */
export function trackPathOf(url: string): string | null {
  const file = trackFileOf(url);
  return file && existsSync(path.join(AUDIO_DIR, file)) ? path.join(AUDIO_DIR, file) : null;
}

/** "00:03:22.97" → ms, or undefined for "N/A" and anything else unreadable. */
function clockToMs(clock: string | undefined): number | undefined {
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(clock?.trim() ?? '');
  if (!m) return undefined;
  const ms = Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  return ms > 0 ? ms : undefined;
}

/** Encode anything ffmpeg can read as a library MP3, the way every track is
 *  filed: 44.1 kHz stereo 192k with its tags and cover art stripped. With
 *  `trim` (seconds), only that stretch, with a 15 ms fade at each cut so it
 *  doesn't click. Resolves to the input's length as ffmpeg read it, when it
 *  could. Used by upload-audio and trim-audio. */
export async function encodeTrackMp3(
  inputPath: string,
  outputPath: string,
  trim?: { start: number; end: number },
): Promise<number | undefined> {
  const ffmpegPath = (await import('ffmpeg-static')).default as string;
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  ffmpeg.setFfmpegPath(ffmpegPath);
  let durationMs: number | undefined;
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath);
    if (trim) {
      const length = trim.end - trim.start;
      const fade = Math.min(0.015, length / 4);
      cmd
        .seekInput(trim.start)
        .duration(length)
        .audioFilters([`afade=t=in:d=${fade}`, `afade=t=out:st=${(length - fade).toFixed(3)}:d=${fade}`]);
    }
    cmd
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate(192)
      .audioFrequency(44100)
      .audioChannels(2)
      .outputOptions(['-map_metadata', '-1'])
      .output(outputPath)
      .on('codecData', (data) => { durationMs = clockToMs(data.duration); })
      .on('end', () => resolve(durationMs))
      .on('error', (err: Error) => reject(err))
      .run();
  });
}
