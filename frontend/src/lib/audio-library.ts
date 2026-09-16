// The audio library on disk — public/audio — as the server sees it. Songs are
// the `track-*.mp3` files there; the beds the Vids builder lays under a video
// (room-tone.mp3, keyboard-typing.wav) live beside them but are part of the
// app, not songs anyone picks, so they are never tracks.
//
// Server-only (node fs). Shared by /api/charts/list-audio, which lists the
// tracks, and the Vids routes that take a track by its url — its clipable
// flag, its name — and have to check it is one.

import { existsSync } from 'fs';
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
