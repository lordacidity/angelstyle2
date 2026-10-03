// Nothing goes to fal bigger than 1080p: 1920 on the long side and 1080 on the
// short, whichever way round the picture is. New scenes are cut at that size
// (clip.ts) and the first frame is asked for at it (fal.ts), so most of what is
// sent is already there. What came before — a scene cut at 4K, a character
// first frame drawn at 4K, a character photo straight off a phone — is sent as
// a 1080p copy made the first time it is needed and kept beside the original
// in the bucket (`<name>.1080p.<ext>`), so later sends reuse it. The originals
// are never touched.
//
// Server-only.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FFPROBE, ffmpeg, run } from '@/lib/aier/exec.js';
import { publicUrl, putObject } from '@/lib/vids-db';

export const LONG_SIDE = 1920;
export const SHORT_SIDE = 1080;

export const over1080p = (width: number, height: number) =>
  Math.max(width, height) > LONG_SIDE || Math.min(width, height) > SHORT_SIDE;

/** ffmpeg's scale for "no bigger than 1080p", either way up; anything already
 *  inside it passes through. */
export const FIT_1080P =
  `scale=w='if(gte(iw,ih),min(${LONG_SIDE},iw),min(${SHORT_SIDE},iw))'`
  + `:h='if(gte(iw,ih),min(${SHORT_SIDE},ih),min(${LONG_SIDE},ih))'`
  + ':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos+accurate_rnd';

/** The size a picture of `width`×`height` comes down to inside 1080p. */
export function fit1080p(width: number, height: number): { width: number; height: number } {
  const landscape = width >= height;
  const scale = Math.min(1, (landscape ? LONG_SIDE : SHORT_SIDE) / width, (landscape ? SHORT_SIDE : LONG_SIDE) / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** One copy at a time per original in this process: every take in a scene
 *  is queued at once, and they would otherwise all make the same copy. */
const making = new Map<string, Promise<string>>();
function once(key: string, make: () => Promise<string>): Promise<string> {
  const going = making.get(key);
  if (going) return going;
  const p = make().finally(() => making.delete(key));
  making.set(key, p);
  return p;
}

const copyPath = (original: string, ext: string) => `${original.replace(/\.[a-z0-9]{2,5}$/i, '')}.1080p.${ext}`;

async function exists(storagePath: string): Promise<boolean> {
  const res = await fetch(publicUrl(storagePath), { method: 'HEAD' }).catch(() => null);
  return !!res?.ok;
}

/** The picture at `storagePath`, or a 1080p copy of it when it is bigger. The
 *  copy is turned the way the photo is meant to be seen (a phone's EXIF
 *  rotation) and kept in its own format — a JPEG stays a JPEG at top quality,
 *  anything else becomes a lossless PNG. If the picture can't be read here,
 *  the original goes as it is rather than nothing going. */
export function imageAt1080p(storagePath: string): Promise<string> {
  return once(storagePath, () => makeImage(storagePath));
}

async function makeImage(storagePath: string): Promise<string> {
  try {
    const res = await fetch(publicUrl(storagePath));
    if (!res.ok) return storagePath;
    const body = Buffer.from(await res.arrayBuffer());
    const sharp = (await import('sharp')).default;
    const meta = await sharp(body).metadata();
    // Orientations 5–8 stand the picture on its side.
    const turned = (meta.orientation ?? 1) >= 5;
    const width = (turned ? meta.height : meta.width) ?? 0;
    const height = (turned ? meta.width : meta.height) ?? 0;
    if (!width || !height || !over1080p(width, height)) return storagePath;
    const jpeg = meta.format === 'jpeg';
    const to = copyPath(storagePath, jpeg ? 'jpg' : 'png');
    if (await exists(to)) return to;
    const size = fit1080p(width, height);
    const resized = sharp(body).rotate().resize(size.width, size.height, { fit: 'inside', kernel: 'lanczos3' });
    const out = jpeg
      ? await resized.jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer()
      : await resized.png().toBuffer();
    await putObject(to, out, jpeg ? 'image/jpeg' : 'image/png');
    return to;
  } catch (err) {
    console.error('[ai-persona] could not bring a picture to 1080p, sending it as it is:', err);
    return storagePath;
  }
}

/** Kling's file limit, with room to spare, and the most any picture needs. */
const VIDEO_BUDGET_BITS = 92 * 1024 * 1024 * 8;
const MAX_VIDEO_BITRATE = 80_000_000;
const AUDIO_BITRATE = 320_000;

/** The clip at `storagePath`, or a 1080p copy of it when the scene was cut
 *  bigger. Encoded the way clip.ts cuts one — CRF 10, under Kling's 100MB — and
 *  the sound is carried over untouched. */
export async function videoAt1080p(storagePath: string, width: number, height: number, duration: number): Promise<string> {
  if (!over1080p(width, height)) return storagePath;
  return once(storagePath, () => makeVideo(storagePath, duration));
}

async function makeVideo(storagePath: string, duration: number): Promise<string> {
  const to = copyPath(storagePath, 'mp4');
  if (await exists(to)) return to;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-persona-1080p-'));
  try {
    const source = publicUrl(storagePath);
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', source]);
    const hasAudio = stdout.trim().length > 0;
    const seconds = duration > 0 ? duration : 30;
    const ceiling = Math.floor(Math.min(MAX_VIDEO_BITRATE, VIDEO_BUDGET_BITS / seconds - (hasAudio ? AUDIO_BITRATE : 0)));
    const out = path.join(dir, 'clip.mp4');
    await ffmpeg([
      '-y', '-nostdin', '-loglevel', 'error', '-i', source,
      '-map', '0:v:0', '-vf', `${FIT_1080P},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'faster', '-crf', '10', '-profile:v', 'high',
      '-maxrate', String(ceiling), '-bufsize', String(ceiling),
      ...(hasAudio ? ['-map', '0:a:0', '-c:a', 'copy'] : []),
      '-movflags', '+faststart', out,
    ]);
    await putObject(to, await readFile(out), 'video/mp4');
    return to;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
