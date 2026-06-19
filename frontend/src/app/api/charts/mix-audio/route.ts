import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink, readFile } from 'fs/promises';
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
      // RE-ENCODE the video — do NOT `-c copy`. MediaRecorder (Chrome) emits a
      // FRAGMENTED MP4 whose moov/mvhd carries no valid duration; the real timing
      // lives scattered across fragments. A stream copy preserves that broken
      // header, so the file plays full-length on desktop (players rescan frames)
      // but Android's MediaStore trusts the bogus mvhd duration and shows ~3 s.
      // Re-encoding rebuilds a clean, non-fragmented MP4 with a correct mvhd
      // duration and constant 30 fps — fixing the Android 3-second bug and the
      // glitchy seeking on desktop. CFR output (-r 30) also smooths the variable
      // frame rate produced by manual requestFrame() pumping.
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate(192)
      .outputOptions([
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-shortest',
        '-movflags', '+faststart',
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
    // audioUrl passed as query param; video sent as raw binary body to avoid multipart 10MB limit
    const { searchParams } = new URL(req.url);
    const audioUrl = searchParams.get('audioUrl');
    if (!audioUrl) return NextResponse.json({ error: 'audioUrl query param required' }, { status: 400 });

    const audioFilename = path.basename(audioUrl);
    const audioPath     = path.join(process.cwd(), 'public', 'audio', audioFilename);
    if (!existsSync(audioPath)) {
      return NextResponse.json({ error: `Audio file not found: ${audioFilename}` }, { status: 404 });
    }

    const ts      = Date.now();
    const vidPath = path.join(os.tmpdir(), `charts-vid-${ts}.mp4`);
    const outPath = path.join(os.tmpdir(), `charts-mix-${ts}.mp4`);

    await writeFile(vidPath, Buffer.from(await req.arrayBuffer()));
    await mixAudio(vidPath, audioPath, outPath);
    await unlink(vidPath).catch(() => {});

    const outBuf = await readFile(outPath);
    await unlink(outPath).catch(() => {});

    return new NextResponse(outBuf, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="charts.mp4"`,
      },
    });
  } catch (err) {
    console.error('[mix-audio]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
