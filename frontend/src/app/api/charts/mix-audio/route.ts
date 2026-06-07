import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';

async function mixAudio(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = (await import('ffmpeg-static')).default as string;
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  ffmpeg.setFfmpegPath(ffmpegPath);
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      // Copy H.264 video unchanged, encode MP3 → AAC-LC directly (no browser intermediate)
      .videoCodec('copy')
      .audioCodec('aac')
      .audioBitrate(192)
      // Map video from first input, audio from second input
      .outputOptions([
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',              // trim audio to video length
        '-movflags', 'faststart', // moov atom at front for streaming
        '-fflags', '+genpts',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const videoFile = form.get('video') as File | null;
    const audioUrl  = form.get('audioUrl') as string | null;

    if (!videoFile) return NextResponse.json({ error: 'video required' }, { status: 400 });
    if (!audioUrl)  return NextResponse.json({ error: 'audioUrl required' }, { status: 400 });

    // Resolve the local audio path from the /audio/ URL
    const audioFilename = path.basename(audioUrl);
    const audioPath     = path.join(process.cwd(), 'public', 'audio', audioFilename);
    if (!existsSync(audioPath)) {
      return NextResponse.json({ error: `Audio file not found: ${audioFilename}` }, { status: 404 });
    }

    const ts      = Date.now();
    const vidPath = path.join(os.tmpdir(), `charts-vid-${ts}.mp4`);
    const outPath = path.join(os.tmpdir(), `charts-mix-${ts}.mp4`);

    await writeFile(vidPath, Buffer.from(await videoFile.arrayBuffer()));
    await mixAudio(vidPath, audioPath, outPath);
    await unlink(vidPath).catch(() => {});

    // Stream back directly to avoid a second readFile into memory
    const { createReadStream } = await import('fs');
    const stream = createReadStream(outPath);
    const { Readable } = await import('stream');
    const webStream = Readable.toWeb(stream) as ReadableStream;

    const response = new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="charts.mp4"`,
      },
    });

    // Clean up temp file after response is consumed
    response.clone().blob().then(() => unlink(outPath).catch(() => {})).catch(() => {});

    return response;
  } catch (err) {
    console.error('[mix-audio]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
