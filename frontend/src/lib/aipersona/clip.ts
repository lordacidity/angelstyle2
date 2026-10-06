// Cuts a scene's video down to what Kling will follow, and pulls the picture
// the image model redraws: the very first frame of the cut — after the trim,
// so the frame and the motion start in the same place.
//
// Everything here is about losing as little as possible on the way to fal:
//
//   the clip    keeps the source's frame rate, and its resolution up to 1080p
//               (fit1080 — nothing bigger goes to fal). It has to be
//               re-encoded — the trim must land on the exact frame asked for,
//               not the nearest keyframe, and a speed-up changes every frame's
//               time — so it is encoded once, at a quality past the point
//               where the difference can be seen (x264 CRF 10), and held back
//               only by Kling's 100MB a file.
//   the frame   is a lossless PNG at the same size, taken from the
//               decoded source in the same pass that makes the clip — never
//               from the encoded clip, which would hand the image model a
//               second-generation picture.
//   colour      is carried across rather than guessed at twice: an HDR
//               recording (most phones' default) is tone-mapped to SDR instead
//               of being flattened to grey, and an untagged HD source is read
//               and labelled as BT.709, which is what every player assumes.
//
// The limits are fal's, from the model's published schema.

import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { FFPROBE, ffmpeg, probe, run } from '@/lib/aier/exec.js';
import { FIT_1080P } from './fit1080';
import { PersonaInputError } from './respond';
import { MAX_CLIP_SECONDS, MIN_CLIP_SECONDS, clampSpeed, clipSeconds } from './types';

const MB = 1024 * 1024;

/** What Kling's motion control takes as its video and its image. */
const KLING_VIDEO_BYTES = 100 * MB;
const KLING_IMAGE_BYTES = 10 * MB;
const KLING_MIN_SIDE = 340;

/** x264's quality target. 18 is where most people stop seeing a difference;
 *  10 is well past it, and what the size limit leaves room for. */
const CRF = 10;
/** What the clip is steered to stay under — Kling's limit, with room for the
 *  container and for the rate control to overshoot a little. */
const CLIP_BUDGET_BYTES = 92 * MB;
const AUDIO_BITRATE = 320_000;
/** No picture needs more than this, however short the clip. */
const MAX_VIDEO_BITRATE = 80_000_000;
/** How hard x264 searches. Measured at CRF 10, the medium, faster and veryfast
 *  presets came out within half a dB of each other — the quality is set by the
 *  CRF; the preset mostly buys a smaller file, and size is not what is short
 *  here. So `faster` is used, and `veryfast` for a cut with more than this
 *  many megapixels of frames in it (4K, or a long 60fps clip), so that it
 *  finishes inside a request. */
const HEAVY_CUT_MEGAPIXELS = 2000;

export interface CutClip {
  clipPath: string;
  framePath: string;
  width: number;
  height: number;
  duration: number;
}

interface Source {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** As tagged in the file, or null where the file doesn't say. */
  transfer: string | null;
  matrix: string | null;
}

const tagged = (v: unknown) => (typeof v === 'string' && v && v !== 'unknown' ? v : null);

async function inspect(file: string): Promise<Source> {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,color_transfer,color_space:format=duration',
    '-of', 'json',
    file,
  ]);
  const info = JSON.parse(stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; color_transfer?: string; color_space?: string }[];
    format?: { duration?: string };
  };
  const video = info.streams?.find((s) => s.codec_type === 'video');
  const [num, den] = (video?.avg_frame_rate ?? '').split('/').map(Number);
  return {
    duration: parseFloat(info.format?.duration ?? '') || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: num > 0 && den > 0 ? num / den : 30,
    hasVideo: !!video,
    hasAudio: !!info.streams?.some((s) => s.codec_type === 'audio'),
    transfer: tagged(video?.color_transfer),
    matrix: tagged(video?.color_space),
  };
}

/** PQ and HLG — the two ways a recording says it is HDR. */
const HDR_TRANSFERS = ['smpte2084', 'arib-std-b67'];

// Tone-mapping needs two filters that not every ffmpeg build carries. Asked
// once per process.
let toneMapping: Promise<boolean> | undefined;
const canToneMap = () =>
  (toneMapping ??= ffmpeg(['-hide_banner', '-filters']).then(
    ({ stdout }: { stdout: string }) => / zscale /.test(stdout) && / tonemap /.test(stdout),
    () => false,
  ));

/** Download `sourceUrl` into `dir`, cut start→end at `speed`, and write
 *  clip.mp4 and frame.png beside it. */
export async function cutClip({ sourceUrl, dir, start, end, speed }: {
  sourceUrl: string; dir: string; start: number; end: number; speed: number;
}): Promise<CutClip> {
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) throw new Error(`The uploaded video could not be read back (${res.status}).`);
  const sourcePath = path.join(dir, 'source');
  await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), createWriteStream(sourcePath));

  const source = await inspect(sourcePath);
  if (!source.hasVideo || !source.duration) throw new PersonaInputError("That file doesn't read as a video.");

  const rate = clampSpeed(speed);
  const from = Math.min(Math.max(0, start), source.duration);
  const to = Math.min(Math.max(from, end), source.duration);
  const seconds = clipSeconds(from, to, rate);
  if (seconds < MIN_CLIP_SECONDS) {
    throw new PersonaInputError(`The clip runs ${seconds.toFixed(1)}s after the trim and the speed-up; Kling needs at least ${MIN_CLIP_SECONDS}s.`);
  }
  if (seconds > MAX_CLIP_SECONDS + 0.05) {
    throw new PersonaInputError(`The clip runs ${seconds.toFixed(1)}s after the trim and the speed-up; Kling takes up to ${MAX_CLIP_SECONDS}s.`);
  }

  const clipPath = path.join(dir, 'clip.mp4');
  const framePath = path.join(dir, 'frame.png');
  const hd = Math.max(source.width, source.height) >= 1280 || Math.min(source.width, source.height) >= 720;
  const megapixels = (source.width * source.height * source.fps * seconds) / 1e6;
  const preset = megapixels > HEAVY_CUT_MEGAPIXELS ? 'veryfast' : 'faster';

  /** One pass: the decoded picture is split, one copy encoded as the clip and
   *  the first frame of the other written out as the PNG. `share` scales the
   *  bitrate ceiling down for a second try. */
  const encode = async (toneMap: boolean, share: number) => {
    // An HDR picture is brought down to SDR in linear light. Without this its
    // values are simply reread as SDR, and it comes out flat and grey.
    const tone = toneMap
      ? `zscale=tin=${source.transfer}:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,`
        + 'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv444p10le,'
      : '';
    // Only a source bigger than 1080p is scaled; the rest pass through.
    const fit = FIT_1080P;
    // A file that doesn't say how its colour is stored is read the way players
    // read it — BT.709 for HD — and the clip is labelled to match.
    const assume709 = !toneMap && !source.matrix && hd;
    const still = `scale=${assume709 ? 'in_color_matrix=bt709:' : ''}flags=lanczos+accurate_rnd+full_chroma_int+full_chroma_inp,format=rgb24`;
    const graph = `[0:v:0]${tone}${fit},split[c][f];`
      + `[c]${rate === 1 ? '' : `setpts=PTS/${rate},`}format=yuv420p[v];`
      + `[f]trim=end_frame=1,${still}[png]`;

    const ceiling = Math.floor(
      Math.min(MAX_VIDEO_BITRATE, (CLIP_BUDGET_BYTES * 8) / seconds - (source.hasAudio ? AUDIO_BITRATE : 0)) * share,
    );
    await ffmpeg([
      '-y', '-nostdin', '-loglevel', 'error',
      '-ss', from.toFixed(3), '-t', (to - from).toFixed(3),
      '-i', sourcePath,
      '-filter_complex', graph,
      '-map', '[v]',
      '-c:v', 'libx264', '-preset', preset, '-crf', String(CRF), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-maxrate', String(ceiling), '-bufsize', String(ceiling),
      ...(toneMap || assume709 ? ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'] : []),
      ...(source.hasAudio
        ? ['-map', '0:a:0', ...(rate === 1 ? [] : ['-af', `atempo=${rate}`]), '-c:a', 'aac', '-b:a', String(AUDIO_BITRATE)]
        : []),
      // Sound is encoded in blocks and can run a hair past the picture; a clip
      // cut right up to Kling's limit must not be tipped over it.
      '-t', Math.min(seconds, MAX_CLIP_SECONDS - 0.05).toFixed(3),
      '-movflags', '+faststart',
      clipPath,
      '-map', '[png]', '-frames:v', '1', '-update', '1',
      framePath,
    ]);
  };

  let toneMap = HDR_TRANSFERS.includes(source.transfer ?? '') && (await canToneMap());
  try {
    await encode(toneMap, 1);
  } catch (err) {
    if (!toneMap) throw err;
    // The tone-map chain is the one part that depends on how the file was
    // tagged. A clip in flat colour beats no clip.
    console.error('[ai-persona clip] tone-mapping failed, cutting without it:', err);
    toneMap = false;
    await encode(false, 1);
  }
  // The ceiling is a steer, not a wall. If a clip still lands over Kling's
  // limit, it is encoded again with a lower one.
  if ((await stat(clipPath)).size > KLING_VIDEO_BYTES - MB) await encode(toneMap, 0.6);

  const cut = await probe(clipPath);
  if (Math.min(cut.width, cut.height) < KLING_MIN_SIDE) {
    throw new PersonaInputError(`That video is ${cut.width}×${cut.height}; Kling needs at least ${KLING_MIN_SIDE}px a side.`);
  }
  return { clipPath, framePath, width: cut.width, height: cut.height, duration: cut.duration };
}

/** A character first frame, in a form Kling will take as its image. The image
 *  model answers with a PNG, and that is passed on untouched (the same Buffer
 *  back) whenever it fits Kling's 10MB. Only a PNG too big for Kling is
 *  re-saved — as a JPEG at the highest quality that fits, with the colour at
 *  full resolution — and only in the copy sent to Kling (scenes.ts). */
export async function fitForKling(image: Buffer, contentType: string): Promise<{ body: Buffer; contentType: string }> {
  if (image.length <= KLING_IMAGE_BYTES - MB / 4) return { body: image, contentType };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-persona-'));
  try {
    const inPath = path.join(dir, 'frame-in');
    const outPath = path.join(dir, 'frame-out.jpg');
    await writeFile(inPath, image);
    for (const q of [1, 2, 3, 5, 8]) {
      await ffmpeg([
        '-y', '-nostdin', '-loglevel', 'error', '-i', inPath,
        '-frames:v', '1', '-update', '1', '-pix_fmt', 'yuvj444p', '-qmin', '1', '-q:v', String(q),
        outPath,
      ]);
      const body = await readFile(outPath);
      if (body.length <= KLING_IMAGE_BYTES - MB / 4) return { body, contentType: 'image/jpeg' };
    }
    throw new Error(`The character first frame is ${(image.length / MB).toFixed(1)}MB and could not be brought under Kling's 10MB.`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
