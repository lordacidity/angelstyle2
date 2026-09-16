// Runs the finish pass. What it does to the picture and why is in
// roughen-plan.ts, which works out the treatment as pure numbers; this is only
// the part that touches files.
//
// The picture and the sound are each optional. Picture off copies Kling's video
// stream as it is; a muffled track (audio muffler mode, rendered in the browser)
// replaces Kling's audio, and without one Kling's audio is copied as it is.

import { ffmpeg, hasAudioStream, probe } from '@/lib/aier/exec.js';
import { planRoughen, type RoughenPlan } from './roughen-plan';

export { planRoughen, type RoughenPlan };

export interface FinishResult {
  seed: number;
  /** Set when the picture was treated. */
  crf: number | null;
  duration: number;
  ms: number;
}

export async function finish({ inPath, outPath, videoStrength, audioPath, seed }: {
  inPath: string;
  outPath: string;
  /** 0..1, or null to leave the picture untouched. */
  videoStrength: number | null;
  /** A replacement soundtrack, or null to keep Kling's. */
  audioPath: string | null;
  seed: number;
}): Promise<FinishResult> {
  const t0 = Date.now();
  const [{ duration }, hasAudio] = await Promise.all([probe(inPath), hasAudioStream(inPath)]);
  const plan = videoStrength === null ? null : planRoughen({ strength: videoStrength, duration, seed });

  await ffmpeg([
    '-y', '-nostdin', '-loglevel', 'error',
    '-i', inPath,
    ...(audioPath ? ['-i', audioPath] : []),
    ...(plan
      ? ['-filter_complex', plan.filter, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(plan.crf), '-pix_fmt', 'yuv420p']
      : ['-map', '0:v', '-c:v', 'copy']),
    ...(audioPath
      ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2']
      : hasAudio ? ['-map', '0:a', '-c:a', 'copy'] : []),
    '-movflags', '+faststart',
    outPath,
  ]);

  return { seed, crf: plan?.crf ?? null, duration, ms: Date.now() - t0 };
}
