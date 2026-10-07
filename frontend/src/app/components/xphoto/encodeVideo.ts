// Canvas → MP4, frame by frame, entirely in the browser (WebCodecs through
// mediabunny). The same reasoning as lib/simpler/vidsCompose.ts: no server
// ffmpeg, so localhost and Vercel behave identically.
//
// Offline rather than recorded — MediaRecorder would capture a canvas in real
// time and drop frames when the tab is busy. Here the draw and the encode take
// turns, so a 15-second file is 450 drawn frames however long they take.

/** Bits per pixel per frame. Flat graphics with sharp type and a thin line
 *  show every bit of banding, so this sits above the footage default (0.16). */
const TARGET_BPP = 0.2;

export interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Paints frame `i` onto the canvas the encoder then reads. */
  draw: (ctx: CanvasRenderingContext2D, frame: number) => void;
  onProgress?: (frac: number) => void;
  signal?: AbortSignal;
}

export async function encodeCanvasVideo(opts: EncodeOptions): Promise<Blob> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, canEncodeVideo } = await import('mediabunny');
  const { width, height, fps, frames, signal } = opts;
  const report = opts.onProgress ?? (() => {});
  const stopIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };

  if (typeof VideoEncoder === 'undefined') {
    throw new Error('This browser has no WebCodecs support — export from Chrome or Edge.');
  }
  if (!(await canEncodeVideo('avc', { width, height }))) {
    throw new Error(`This browser can't encode H.264 at ${width}×${height}.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: Math.round(width * height * fps * TARGET_BPP),
  });
  output.addVideoTrack(source, { frameRate: fps });

  await output.start();
  try {
    for (let f = 0; f < frames; f++) {
      stopIfAborted();
      opts.draw(ctx, f);
      await source.add(f / fps, 1 / fps);
      if (f % 5 === 0 || f === frames - 1) report(((f + 1) / frames) * 0.97);
    }
    source.close();
    report(0.99);
    await output.finalize();
  } catch (e) {
    if (output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {});
    }
    throw e;
  } finally {
    // Let the bitmap go now rather than when the collector gets to it — a
    // browser short of canvas memory starts drawing the next ones in software.
    canvas.width = 0;
    canvas.height = 0;
  }

  const buf = output.target.buffer;
  if (!buf) throw new Error('Encoder produced no output.');
  report(1);
  return new Blob([buf], { type: 'video/mp4' });
}
