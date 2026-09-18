// Cuts free photos to the exact boxes a News page gives them, in the browser,
// before the page is drawn (the result goes into the page as a JPEG data URL).
//
// The person's photo is placed so their face sits in the middle of the box.
// When the photo would have to be blown up too far, or is too tall and narrow
// for the box, it's shown whole at full height over a blurred, darkened copy
// of itself filling the sides, the way news sites and TV show portrait shots.
// Thumbnails are simply cropped to fill.

import { withBase } from '@/lib/clipping';
import type { NewsPhoto, PersonPhoto } from './types';
import type { PhotoSize } from './templates';

/** Furthest a photo is enlarged before it's shown over blurred sides instead. */
const MAX_UPSCALE = 2;
/** Narrower than this share of the box's shape and cropping would cut off too much. */
const MIN_SHAPE = 0.7;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load the photo."));
    // Same-origin through the proxy, so the canvas can be exported.
    img.src = withBase(`/api/charts/image-proxy?url=${encodeURIComponent(url)}`);
  });
}

function canvasFor(size: PhotoSize, scale: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx, W: canvas.width, H: canvas.height };
}

/** Offset that puts `focus` (0–1 across the drawn length) at the middle of the
 *  box, without letting the photo leave a gap at either edge. */
function place(box: number, drawn: number, focus: number): number {
  const want = box / 2 - focus * drawn;
  return drawn >= box ? Math.min(0, Math.max(box - drawn, want)) : Math.min(box - drawn, Math.max(0, want));
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, fx: number, fy: number, grow = 1) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * grow;
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, place(W, dw, fx), place(H, dh, fy), dw, dh);
}

function drawBlurredBackdrop(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, fx: number, fy: number) {
  if (typeof ctx.filter === 'string') {
    ctx.save();
    ctx.filter = `blur(${Math.round(W / 36)}px)`;
    drawCover(ctx, img, W, H, fx, fy, 1.15); // oversized so the blur has no soft edge
    ctx.restore();
  } else {
    // No canvas filters (Safari): shrink hard and scale back up in two steps.
    const tiny = document.createElement('canvas');
    tiny.width = Math.max(8, Math.round(W / 24));
    tiny.height = Math.max(8, Math.round(H / 24));
    drawCover(tiny.getContext('2d')!, img, tiny.width, tiny.height, fx, fy, 1.15);
    const mid = document.createElement('canvas');
    mid.width = tiny.width * 4;
    mid.height = tiny.height * 4;
    const m = mid.getContext('2d')!;
    m.imageSmoothingQuality = 'high';
    m.drawImage(tiny, 0, 0, mid.width, mid.height);
    ctx.drawImage(mid, 0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, W, H);
}

/** The person's photo cut to `size`, face in the middle. `scale` matches the
 *  page's drawing scale so the photo stays sharp. */
export async function framePersonPhoto(photo: PersonPhoto, size: PhotoSize, scale = 1.5): Promise<string> {
  const img = await load(photo.url);
  const { canvas, ctx, W, H } = canvasFor(size, scale);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const fx = photo.face ? photo.face.x + photo.face.w / 2 : 0.5;
  const fy = photo.face ? photo.face.y + photo.face.h / 2 : 0.4;

  const cover = Math.max(W / iw, H / ih);
  const tooSmall = cover > MAX_UPSCALE;
  const tooNarrow = iw / ih < (W / H) * MIN_SHAPE;
  if (!tooSmall && !tooNarrow) {
    drawCover(ctx, img, W, H, fx, fy);
  } else {
    drawBlurredBackdrop(ctx, img, W, H, fx, fy);
    const s = Math.min(H / ih, W / iw, MAX_UPSCALE);
    const dw = iw * s;
    const dh = ih * s;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = Math.round(W / 60);
    ctx.drawImage(img, place(W, dw, fx), place(H, dh, fy), dw, dh);
    ctx.restore();
  }
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** A thumbnail cropped to fill `size`. Pauv's square headshots keep the face,
 *  which sits a little above the middle. */
export async function frameThumb(photo: NewsPhoto, size: PhotoSize, scale = 1.5): Promise<string> {
  const img = await load(photo.url);
  const { canvas, ctx, W, H } = canvasFor(size, scale);
  drawCover(ctx, img, W, H, 0.5, photo.source === 'pauv' ? 0.42 : 0.5);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** The credit line printed under the photo: author, where it's from, licence. */
export function photoCredit(photo: NewsPhoto): string {
  const who = photo.creator && !/^(unknown|anonymous)/i.test(photo.creator) ? `${photo.creator} / ` : '';
  const free = /^(cc0|public domain|pd\b)/i.test(photo.license);
  return `${who}Wikimedia Commons${free ? '' : ` (${photo.license})`}`;
}
