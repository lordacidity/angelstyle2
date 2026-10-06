// Nothing goes to fal bigger than 1080p — 1920 on the long side and 1080 on the
// short, whichever way round the picture is — except the character photo, which
// goes at its full size (photoAsTaken): it is usually a reference sheet of a
// dozen small views, and shrinking it shrinks every face on it. New scenes are cut at that size
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
 *  inside it passes through. The commas inside the expressions are escaped
 *  with backslashes, not wrapped in quotes: a quote that goes missing on the
 *  way to ffmpeg leaves the first comma ending the filter ("No such filter:
 *  'ih)'"), and an escaped comma reads the same on every build.
 *
 *  Built with join(), not template literals joined with `+`: the production
 *  minifier folds `\`…${x}…\` + \`…\`` wrongly and drops the end of the first
 *  one, which is what cut this string short in the deployed build. */
const fit = (a: number, b: number, dim: 'iw' | 'ih') =>
  ['if(gte(iw\\,ih)\\,min(', a, '\\,', dim, ')\\,min(', b, '\\,', dim, '))'].join('');
export const FIT_1080P = [
  'scale=w=', fit(LONG_SIDE, SHORT_SIDE, 'iw'),
  ':h=', fit(SHORT_SIDE, LONG_SIDE, 'ih'),
  ':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos+accurate_rnd',
].join('');

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

/** A character photo for the image model at its full size, losing nothing:
 *  the very file that was uploaded, byte for byte. The one exception is a
 *  phone photo stored on its side (EXIF orientation 2–8), which is sent as a
 *  copy turned upright at full size — a PNG stays lossless, a JPEG is re-saved
 *  at quality 100 with the colour at full resolution — kept beside the original
 *  (`<name>.upright.<ext>`) so later sends reuse it. */
//
// fal turns away any input over 25,000,000 bytes (HTTP 422), and a character
// photo may be up to 50MB. One that is too big goes as a full-size JPEG at
// quality 100 with the colour at full resolution, which is a fraction of a
// PNG's size and looks the same; only if even that is over does the quality
// step down, and only after that the size. Kept as `<name>.fal.jpg`.
export const FAL_MAX_BYTES = 24_000_000;

export function photoAsTaken(storagePath: string): Promise<string> {
  return once(`upright:${storagePath}`, async () => {
    try {
      const res = await fetch(publicUrl(storagePath));
      if (!res.ok) return storagePath;
      const body = Buffer.from(await res.arrayBuffer());
      const sharp = (await import('sharp')).default;
      const meta = await sharp(body).metadata();
      const base = storagePath.replace(/\.[a-z0-9]{2,5}$/i, '');
      if (body.length > FAL_MAX_BYTES) {
        const to = `${base}.fal.jpg`;
        if (await exists(to)) return to;
        const width = ((meta.orientation ?? 1) >= 5 ? meta.height : meta.width) ?? 0;
        let out: Buffer | null = null;
        for (const [scale, quality] of [[1, 100], [1, 97], [1, 94], [1, 90], [0.85, 95], [0.7, 95], [0.55, 95], [0.4, 92]] as const) {
          let img = sharp(body).rotate();
          if (scale < 1 && width) img = img.resize({ width: Math.round(width * scale), kernel: 'lanczos3' });
          out = await img.jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer();
          if (out.length <= FAL_MAX_BYTES) break;
        }
        await putObject(to, out!, 'image/jpeg');
        return to;
      }
      if ((meta.orientation ?? 1) <= 1) return storagePath;
      const jpeg = meta.format === 'jpeg';
      const to = `${base}.upright.${jpeg ? 'jpg' : 'png'}`;
      if (await exists(to)) return to;
      const upright = sharp(body).rotate();
      const out = jpeg
        ? await upright.jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer()
        : await upright.png().toBuffer();
      if (out.length > FAL_MAX_BYTES) {
        const small = await sharp(body).rotate().jpeg({ quality: 97, chromaSubsampling: '4:4:4' }).toBuffer();
        await putObject(`${base}.fal.jpg`, small, 'image/jpeg');
        return `${base}.fal.jpg`;
      }
      await putObject(to, out, jpeg ? 'image/jpeg' : 'image/png');
      return to;
    } catch (err) {
      console.error('[ai-persona] could not read the photo, sending it as it is:', err);
      return storagePath;
    }
  });
}

/** A small JPEG of the picture at `storagePath`, for showing it in a list: a
 *  character photo can be tens of megabytes, and a screen of them at full size
 *  is what made the front screen crawl. Made once and kept beside the original
 *  (`<name>.thumb.jpg`); the original is never touched. Falls back to the
 *  original if the picture can't be read here. */
export const THUMB_SIDE = 480;
export function imageThumb(storagePath: string): Promise<string> {
  return once(`thumb:${storagePath}`, async () => {
    const to = `${storagePath.replace(/\.[a-z0-9]{2,5}$/i, '')}.thumb.jpg`;
    try {
      if (await exists(to)) return to;
      const res = await fetch(publicUrl(storagePath));
      if (!res.ok) return storagePath;
      const sharp = (await import('sharp')).default;
      const out = await sharp(Buffer.from(await res.arrayBuffer()))
        .rotate()
        .resize(THUMB_SIDE, THUMB_SIDE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      await putObject(to, out, 'image/jpeg');
      return to;
    } catch (err) {
      console.error('[ai-persona] could not make a thumbnail, showing the original:', err);
      return storagePath;
    }
  });
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
