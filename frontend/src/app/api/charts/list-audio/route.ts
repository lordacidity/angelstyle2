import { NextResponse } from 'next/server';
import { readdirSync } from 'fs';
import { existsSync } from 'fs';
import { AUDIO_DIR, isTrackFile, readTrackMeta, trackUrl } from '@/lib/audio-library';
import { listClipableKeys, listDegenTracks, listTrackNames } from '@/lib/vids-db';
import { CLIPPERS } from '@/lib/clipping';

export const runtime = 'nodejs';
// Never cache: tracks are saved and renamed between requests.
export const dynamic = 'force-dynamic';

const PRELOADED: Record<string, { label: string; durationMs: number }> = {
  'track-1.mp3': { label: 'Track 1', durationMs: 20033 },
  'track-4.mp3': { label: 'Track 4', durationMs: 23067 },
  'track-6.mp3': { label: 'Track 6', durationMs: 33033 },
  'track-7.mp3': { label: 'Track 7', durationMs: 28033 },
  'track-8.mp3': { label: 'Track 8', durationMs: 26033 },
  'track-custom-1780817471578.mp3': { label: 'Custom Jun 7 · 2',  durationMs: 60000 },
  'track-custom-1780820406014.mp3': { label: 'Custom Jun 7 · 4',  durationMs: 27833 },
  'track-custom-1780824798684.mp3': { label: 'Custom Jun 7 · 5',  durationMs: 23500 },
  'track-custom-1780824815067.mp3': { label: 'Custom Jun 7 · 6',  durationMs: 25500 },
  'track-custom-1780826265457.mp3': { label: 'Custom Jun 7 · 8',  durationMs: 25000 },
  'track-custom-1780827436027.mp3': { label: 'Custom Jun 7 · 9',  durationMs: 29000 },
  'track-custom-1780829352765.mp3': { label: 'Custom Jun 7 · 10', durationMs: 29500 },
  'track-custom-1788980666858.mp3': { label: 'Mimosa 2000',          durationMs: 60029 },
  'track-custom-1788980666859.mp3': { label: 'Took Her To The O',    durationMs: 60029 },
  'track-custom-1789056009934.mp3': { label: 'Yi Jian Mei (Xue hua piao piao)', durationMs: 143554 },
  'track-custom-1789065813191.mp3': { label: 'Hava Nagila',          durationMs: 157123 },
  'track-custom-1789085506045.mp3': { label: 'Ella Joanna',          durationMs: 227354 },
  'track-custom-1789085506046.mp3': { label: 'Ts Pmo',               durationMs: 168305 },
  'track-custom-1789085506047.mp3': { label: 'Hot Milk',             durationMs: 202976 },
  'track-custom-1789085506048.mp3': { label: 'Ocarina of Time Title Theme', durationMs: 78295 },
  'track-custom-1789085506049.mp3': { label: 'Sybau',                durationMs: 114171 },
  'track-custom-1789085506050.mp3': { label: 'Summer',               durationMs: 211090 },
  'track-custom-1789085506051.mp3': { label: 'Hotline Bling',        durationMs: 206585 },
};

export async function GET() {
  if (!existsSync(AUDIO_DIR)) return NextResponse.json([]);

  let files: string[];
  try {
    // Tracks only. public/audio also holds the beds the Vids builder lays under
    // a video (room-tone.mp3) — those are part of the app, not songs anyone
    // would pick, and they have no business in a track list.
    files = readdirSync(AUDIO_DIR).filter(isTrackFile);
  } catch {
    return NextResponse.json([]);
  }

  // Names given since, on the Vids Clippers page, which stand in for the ones
  // above. Best effort: the list is the list even when the database is away
  // for a moment — the charts must not lose their songs to a Vids table.
  // Which songs are degen, marked on the Music page, comes along the same way:
  // a listing made while the database is away has every song as just a song.
  const [names, degen] = await Promise.all([
    listTrackNames().catch((err) => {
      console.error('[list-audio] track names unavailable:', err instanceof Error ? err.message : err);
      return new Map<string, string>();
    }),
    listDegenTracks().catch((err) => {
      console.error('[list-audio] degen songs unavailable:', err instanceof Error ? err.message : err);
      return new Set<string>();
    }),
  ]);

  // Sort: preloaded tracks first (track-1 … track-8), then custom by filename
  files.sort((a, b) => {
    const aPreloaded = PRELOADED[a] ? 1 : 0;
    const bPreloaded = PRELOADED[b] ? 1 : 0;
    if (aPreloaded !== bPreloaded) return bPreloaded - aPreloaded;
    return a.localeCompare(b);
  });

  const tracks = files.map(filename => {
    const url = trackUrl(filename);
    const renamed = names.get(url);
    const isDegen = degen.has(url);
    // An upload from the Music page carries its name and length in a .json
    // beside it, and a song trimmed in place there gets one with its new
    // length. A song saved from a link has neither — its length is unknown at
    // list time, so it gets the placeholder.
    const meta = readTrackMeta(filename);
    if (PRELOADED[filename]) {
      const row = PRELOADED[filename];
      return { url, label: renamed ?? row.label, durationMs: meta.durationMs ?? row.durationMs, degen: isDegen };
    }
    const idx = parseInt(filename.replace('track-custom-', '').replace('.mp3', ''), 10);
    const label = renamed ?? meta.label ?? `Custom ${isNaN(idx) ? filename : new Date(idx).toLocaleDateString()}`;
    return { url, label, durationMs: meta.durationMs ?? 20000, degen: isDegen };
  });

  // The clipper deployment is offered only the songs switched on for it. The
  // Studio's own listing is untouched, and so are the charts and the carousel —
  // they run in the Studio build, where CLIPPERS is false. A listing made while
  // the database is away has no approved songs rather than all of them: silence
  // is the safe way to be wrong about what somebody else may use.
  if (!CLIPPERS) return NextResponse.json(tracks);
  const approved = await listClipableKeys('music').catch((err) => {
    console.error('[list-audio] clipable songs unavailable:', err instanceof Error ? err.message : err);
    return new Set<string>();
  });
  return NextResponse.json(tracks.filter((t) => approved.has(t.url)));
}
