import { NextResponse } from 'next/server';
import { readdirSync } from 'fs';
import path from 'path';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

const PRELOADED: Record<string, { label: string; durationMs: number }> = {
  'track-1.mp3': { label: 'Track 1', durationMs: 20033 },
  'track-2.mp3': { label: 'Track 2', durationMs: 60000 },
  'track-3.mp3': { label: 'Track 3', durationMs: 20033 },
  'track-4.mp3': { label: 'Track 4', durationMs: 23067 },
  'track-6.mp3': { label: 'Track 6', durationMs: 33033 },
  'track-7.mp3': { label: 'Track 7', durationMs: 28033 },
  'track-8.mp3': { label: 'Track 8', durationMs: 26033 },
  'track-custom-1780816237621.mp3': { label: 'Custom Jun 7 · 1',  durationMs: 60000 },
  'track-custom-1780817471578.mp3': { label: 'Custom Jun 7 · 2',  durationMs: 60000 },
  'track-custom-1780820406014.mp3': { label: 'Custom Jun 7 · 4',  durationMs: 27833 },
  'track-custom-1780824798684.mp3': { label: 'Custom Jun 7 · 5',  durationMs: 23500 },
  'track-custom-1780824815067.mp3': { label: 'Custom Jun 7 · 6',  durationMs: 25500 },
  'track-custom-1780826265457.mp3': { label: 'Custom Jun 7 · 8',  durationMs: 25000 },
  'track-custom-1780827436027.mp3': { label: 'Custom Jun 7 · 9',  durationMs: 29000 },
  'track-custom-1780829352765.mp3': { label: 'Custom Jun 7 · 10', durationMs: 29500 },
  'track-custom-1788980666858.mp3': { label: 'Mimosa 2000',          durationMs: 60029 },
  'track-custom-1788980666859.mp3': { label: 'Took Her To The O',    durationMs: 60029 },
  'track-custom-1788980666860.mp3': { label: 'worry (ultra slowed)', durationMs: 60029 },
  'track-custom-1789056009934.mp3': { label: 'Yi Jian Mei (Xue hua piao piao)', durationMs: 143554 },
  'track-custom-1789065813191.mp3': { label: 'Hava Nagila',          durationMs: 157123 },
};

export async function GET() {
  const audioDir = path.join(process.cwd(), 'public', 'audio');
  if (!existsSync(audioDir)) return NextResponse.json([]);

  let files: string[];
  try {
    // Tracks only. public/audio also holds the beds the Vids builder lays under
    // a video (room-tone.mp3) — those are part of the app, not songs anyone
    // would pick, and they have no business in a track list.
    files = readdirSync(audioDir).filter(f => f.endsWith('.mp3') && f.startsWith('track-'));
  } catch {
    return NextResponse.json([]);
  }

  // Sort: preloaded tracks first (track-1 … track-8), then custom by filename
  files.sort((a, b) => {
    const aPreloaded = PRELOADED[a] ? 1 : 0;
    const bPreloaded = PRELOADED[b] ? 1 : 0;
    if (aPreloaded !== bPreloaded) return bPreloaded - aPreloaded;
    return a.localeCompare(b);
  });

  const tracks = files.map(filename => {
    if (PRELOADED[filename]) {
      return { url: `/audio/${filename}`, ...PRELOADED[filename] };
    }
    // Future custom track — duration unknown at list time, use placeholder
    const idx = parseInt(filename.replace('track-custom-', '').replace('.mp3', ''), 10);
    const label = `Custom ${isNaN(idx) ? filename : new Date(idx).toLocaleDateString()}`;
    return { url: `/audio/${filename}`, label, durationMs: 20000 };
  });

  return NextResponse.json(tracks);
}
