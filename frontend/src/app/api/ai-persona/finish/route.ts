// POST /api/ai-persona/finish — the last step: rough up Kling's render so it
// reads as a recording rather than a generation.
//
// Multipart in:
//   videoUrl        Kling's render, on fal.media
//   videoStrength   0–100 to treat the picture; left out, it is copied untouched
//   seed            the picture's take — same seed, same grain; left out, a new one
//   audio           a replacement soundtrack (WAV): audio muffler mode, rendered
//                   in the browser, because that is where the muffler runs. Left
//                   out, Kling's own audio is copied untouched.
// The finished mp4 comes back as bytes. The numbers that were used come back in
// X-Persona-* headers so the card can show them.
//
// The bytes are returned rather than parked on disk: the browser turns them into
// a blob URL, which plays and saves without a serving route or anything to clean
// up. Costs nothing to re-run — this is local ffmpeg, not fal — so both halves
// are knobs in the UI rather than decisions made once.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { finish } from '@/lib/aipersona/roughen';
import { MAX_MUFFLED_BYTES } from '@/lib/aipersona/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Fields = z.object({
  videoUrl: z.string().url().refine(u => {
    try {
      return /(^|\.)fal\.(media|ai|run)$/.test(new URL(u).hostname);
    } catch {
      return false;
    }
  }, 'expected a fal.media URL'),
  videoStrength: z.coerce.number().min(0).max(100).optional(),
  seed: z.coerce.number().int().min(0).optional(),
});

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form.' }, { status: 400 });
  }
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' && v !== '' ? v : undefined;
  };
  const parsed = Fields.safeParse({ videoUrl: field('videoUrl'), videoStrength: field('videoStrength'), seed: field('seed') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Need the rendered video URL, and a video strength of 0 to 100 if the picture is on.' }, { status: 400 });
  }
  const audio = form.get('audio');
  if (audio !== null && (!(audio instanceof File) || audio.size === 0)) {
    return NextResponse.json({ error: 'The muffled audio arrived empty.' }, { status: 400 });
  }
  if (audio && audio.size > MAX_MUFFLED_BYTES) {
    return NextResponse.json({ error: `The muffled audio is ${(audio.size / 1024 / 1024).toFixed(1)}MB; the limit is ${(MAX_MUFFLED_BYTES / 1024 / 1024).toFixed(1)}MB.` }, { status: 413 });
  }

  const { videoUrl, videoStrength } = parsed.data;
  const seed = parsed.data.seed ?? Math.floor(Math.random() * 2 ** 31);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-persona-'));
  try {
    const upstream = await fetch(videoUrl);
    if (!upstream.ok) {
      return NextResponse.json({ error: `fal did not serve the render (${upstream.status}).` }, { status: 502 });
    }
    const inPath = path.join(dir, 'kling.mp4');
    const outPath = path.join(dir, 'finished.mp4');
    const audioPath = audio ? path.join(dir, 'muffled.wav') : null;
    await Promise.all([
      writeFile(inPath, Buffer.from(await upstream.arrayBuffer())),
      audio && audioPath ? writeFile(audioPath, Buffer.from(await audio.arrayBuffer())) : null,
    ]);

    const result = await finish({
      inPath, outPath, audioPath, seed,
      videoStrength: videoStrength === undefined ? null : videoStrength / 100,
    });
    const bytes = await readFile(outPath);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
        'X-Persona-Seed': String(result.seed),
        ...(result.crf !== null ? { 'X-Persona-Crf': String(result.crf) } : {}),
        'X-Persona-Ms': String(result.ms),
      },
    });
  } catch (err) {
    console.error('[ai-persona/finish]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
