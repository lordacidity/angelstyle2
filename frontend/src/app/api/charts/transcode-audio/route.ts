import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';

// Remux the video keeping H.264 video stream, re-encoding audio to AAC-LC.
// This fixes "incompatible audio codec" rejections on Twitter/X, which requires
// proper AAC audio rather than Opus-in-MP4 (what Chrome MediaRecorder produces).
async function remuxToAac(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = (await import('ffmpeg-static')).default as string;
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  ffmpeg.setFfmpegPath(ffmpegPath);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('copy')
      .audioCodec('aac')
      .audioBitrate(128)
      .outputOptions(['-movflags', 'faststart'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    const ts = Date.now();
    const tmpIn  = path.join(os.tmpdir(), `charts-in-${ts}.mp4`);
    const tmpOut = path.join(os.tmpdir(), `charts-out-${ts}.mp4`);

    await writeFile(tmpIn, Buffer.from(await file.arrayBuffer()));
    await remuxToAac(tmpIn, tmpOut);
    await unlink(tmpIn).catch(() => {});

    const outBuf = await readFile(tmpOut);
    await unlink(tmpOut).catch(() => {});

    return new NextResponse(outBuf, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${file.name}"`,
      },
    });
  } catch (err) {
    console.error('[transcode-audio]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
