import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const PRELOADED: Record<string, { label: string; durationMs: number }> = {
  'track-1.mp3': { label: 'Track 1', durationMs: 20033 },
  'track-2.mp3': { label: 'Track 2', durationMs: 15033 },
  'track-3.mp3': { label: 'Track 3', durationMs: 20033 },
  'track-4.mp3': { label: 'Track 4', durationMs: 23067 },
  'track-5.mp3': { label: 'Track 5', durationMs: 26067 },
  'track-6.mp3': { label: 'Track 6', durationMs: 33033 },
  'track-7.mp3': { label: 'Track 7', durationMs: 28033 },
  'track-8.mp3': { label: 'Track 8', durationMs: 26033 },
};

export async function GET() {
  const audioDir = path.join(process.cwd(), 'public', 'audio');
  if (!existsSync(audioDir)) return NextResponse.json([]);

  let files: string[];
  try {
    files = readdirSync(audioDir).filter(f => f.endsWith('.mp3'));
  } catch {
    return NextResponse.json([]);
  }

  // Sort: preloaded tracks first (track-1 … track-8), then custom by timestamp
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
    // Custom track — read sidecar json
    const sidecar = path.join(audioDir, filename.replace('.mp3', '.json'));
    let durationMs = 20000;
    if (existsSync(sidecar)) {
      try {
        const data = JSON.parse(readFileSync(sidecar, 'utf-8')) as { durationMs?: number };
        if (data.durationMs) durationMs = data.durationMs;
      } catch { /* use default */ }
    }
    const idx = parseInt(filename.replace('track-custom-', '').replace('.mp3', ''), 10);
    const label = `Custom ${isNaN(idx) ? filename : new Date(idx).toLocaleDateString()}`;
    return { url: `/audio/${filename}`, label, durationMs };
  });

  return NextResponse.json(tracks);
}
