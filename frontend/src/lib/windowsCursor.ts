// The Windows pointer as a screen recording of this PC catches it, for the
// clips drawn frame by frame (components/chatgpt/chatgpt-video.ts,
// components/trade/trade-video.ts). The arrow and the hand are the default
// scheme's own cursors: the 128px frames of C:\Windows\Cursors\aero_arrow.cur
// and aero_link.cur, saved as public/cursors/*.png. The I-beam and the
// crosshair are the built-in ones, which invert whatever is under them, so
// they read white on a dark page and black on a light one.

export type PointerKind = 'arrow' | 'hand' | 'beam' | 'cross';

/** The pointer's 32px cell, in the units of a 1000px-wide frame: Windows'
 *  pointer at 130%. A clip can draw it smaller or larger with drawPointer's
 *  `size`. */
export const POINTER_CELL = 32 * 1.3;

const BITMAP_PX = 128;
/** Hot spots in the 128px frame, from the .cur headers. */
const BITMAPS = {
  arrow: { src: '/cursors/aero_arrow.png', hot: [0, 0] },
  hand: { src: '/cursors/aero_link.png', hot: [25, 0] },
} as const;
type BitmapKind = keyof typeof BITMAPS;

/** On the 32px grid, pixel for pixel: beam_r.cur and cross_r.cur without
 *  their white edge. Hot spots sit on the pixel centre. */
const INVERTED: Record<'beam' | 'cross', { hot: [number, number]; rects: [number, number, number, number][] }> = {
  beam: { hot: [15.5, 16.5], rects: [[12, 8, 3, 1], [16, 8, 3, 1], [15, 9, 1, 14], [12, 23, 3, 1], [16, 23, 3, 1]] },
  cross: { hot: [15.5, 16.5], rects: [[15, 8, 1, 17], [7, 16, 17, 1]] },
};

const images: Partial<Record<BitmapKind, HTMLImageElement>> = {};
let loading: Promise<void> | null = null;

/** The two bitmaps, once per page. Await before the first drawPointer. */
export function loadPointers(): Promise<void> {
  loading ??= Promise.all((Object.keys(BITMAPS) as BitmapKind[]).map(kind => new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images[kind] = img; resolve(); };
    img.onerror = () => reject(new Error(`Pointer image missing: ${BITMAPS[kind].src}`));
    img.src = BITMAPS[kind].src;
  }))).then(() => undefined, err => { loading = null; throw err; });
  return loading;
}

/** The pointer with its hot spot at (x, y), in the context's current units,
 *  at `size` times POINTER_CELL. */
export function drawPointer(ctx: CanvasRenderingContext2D, kind: PointerKind, x: number, y: number, size = 1) {
  const cell = POINTER_CELL * size;
  ctx.save();
  if (kind === 'beam' || kind === 'cross') {
    const s = INVERTED[kind];
    const k = cell / 32;
    ctx.translate(x - s.hot[0] * k, y - s.hot[1] * k);
    ctx.scale(k, k);
    // One path, one fill: where the strokes cross is inverted once, not twice.
    ctx.beginPath();
    for (const [rx, ry, rw, rh] of s.rects) ctx.rect(rx, ry, rw, rh);
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fill();
  } else {
    const img = images[kind];
    if (!img) throw new Error('drawPointer ran before loadPointers finished.');
    const k = cell / BITMAP_PX;
    const hot = BITMAPS[kind].hot;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x - hot[0] * k, y - hot[1] * k, BITMAP_PX * k, BITMAP_PX * k);
  }
  ctx.restore();
}
