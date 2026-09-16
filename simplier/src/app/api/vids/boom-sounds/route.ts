// /api/vids/boom-sounds — the sounds a BOOM can make: whatever audio is sitting
// in public/audio/booms. Listed off the disk rather than named in the code, so
// dropping a file in the folder is the whole of adding one — the same bargain
// the music library makes (see /api/charts/list-audio).
//
// The folder is its own, beside the tracks rather than among them: a BOOM sound
// is not a song anyone would lay under a video, and the track list reads
// public/audio itself without descending, so neither can turn up in the other's
// list.
import { NextResponse } from 'next/server';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { AUDIO_DIR } from '@/lib/audio-library';

export const runtime = 'nodejs';
// Never cache: a sound dropped in the folder should be there on the next look.
export const dynamic = 'force-dynamic';

const BOOMS_DIR = path.join(AUDIO_DIR, 'booms');
const PLAYABLE = /\.(mp3|m4a|aac|wav|ogg|opus|webm)$/i;

/** "vine-boom.mp3" → "Vine boom". The file name is the name: these are dropped
 *  in by hand, and what they are called is what they are called. */
function label(file: string): string {
  const stem = file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return stem ? stem[0].toUpperCase() + stem.slice(1) : file;
}

export async function GET() {
  if (!existsSync(BOOMS_DIR)) return NextResponse.json([]);
  let files: string[];
  try {
    files = readdirSync(BOOMS_DIR).filter((f) => PLAYABLE.test(f));
  } catch {
    return NextResponse.json([]);
  }
  files.sort((a, b) => a.localeCompare(b));
  return NextResponse.json(files.map((f) => ({ url: `/audio/booms/${f}`, label: label(f) })));
}
