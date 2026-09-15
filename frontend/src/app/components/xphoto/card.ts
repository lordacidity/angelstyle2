// Shared frame for the 3:2 X Photo cards — the newly-listed announcement
// (./renderListed.ts) and the price-change call-out (./renderChange.ts).
// Canvas setup, the photo column, the inset hairline, the header and the
// footnote live here so the cards can't drift apart; each card draws only
// its own middle. React-free like ./render.ts, so the preview and the export
// come from the same draw and are pixel-identical.
//
// Layout follows the Pauv app's share card: 72-unit padding, a flat
// background with no gradient, an optional full-height photo column on the
// left, exactly one accent colour (the lockup, plus the figure when the
// figure IS the news), and one quiet footnote line with the facts on the
// left and the profile URL on the right.

import { MONO, PALETTES, SANS, drawTintedLogo, type CardPalette, type CardTheme } from './shared';

// Design units — 3:2, landscape but well short of 16:9, so X shows it whole
// without it reading as a banner. The canvas can be any uniform multiple;
// beginCard scales.
export const CARD_W = 1200;
export const CARD_H = 800;
/** 1× is the design size; 2× (2400×1600) is the sharp export for X. */
export const CARD_EXPORT_SCALES = [1, 2] as const;
export type CardExportScale = typeof CARD_EXPORT_SCALES[number];

export const PAD = 72;
export const TOP = PAD;
export const BOTTOM = CARD_H - PAD;
export const RIGHT = CARD_W - PAD;
// Full-height photo column on the left; without a usable photo the text
// simply starts at PAD. 480 keeps a square head shot's face inside the crop
// at this height (the crop takes the middle 60% of the width).
const PHOTO_W = 480;
const PHOTO_GAP = 56;
const LOGO_H = 40;
const FOOT_RULE_Y = BOTTOM - 58;
const FOOT_GAP = 40;
const ELLIPSIS = '…';

export interface CardFrame {
  ctx: CanvasRenderingContext2D;
  C: CardPalette;
  /** Left edge of the text column — the one place that knows about the photo split. */
  LEFT: number;
  /** Width of the text column. */
  COL: number;
}

/** What every card has around its middle. */
export interface CardChrome {
  theme: CardTheme;
  /** Pre-loaded, CORS-clean photo. null → full-width text layout. */
  photo: HTMLImageElement | null;
  /** Pre-loaded /pauvlogo.png (white wordmark on transparent). null → no wordmark. */
  logo: HTMLImageElement | null;
  /** Small right-aligned line beside the wordmark (a dateline). null → none. */
  headerRight: string | null;
}

/** "Sep 11, 2026" — datelines on the cards and the row hints in the picker. */
export function formatCardDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function font(weight: number, size: number, family: string = SANS) {
  return `${weight} ${size}px ${family}`;
}

// Letter-spaced text. ctx.letterSpacing is newer than the browsers this has
// to run in, so the tracking is applied per glyph.
export function fillTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

export function trackedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}

/** Largest size in [min, max] at which `text` fits `maxWidth`. */
export function fitFontSize(
  ctx: CanvasRenderingContext2D, text: string, family: string, weight: number, max: number, min: number, maxWidth: number,
): number {
  for (let size = max; size > min; size -= 2) {
    ctx.font = font(weight, size, family);
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return min;
}

// Fit first (fitFontSize), then ellipsize as the last resort.
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + ELLIPSIS).width > maxWidth) out = out.slice(0, -1);
  return out.trimEnd() + ELLIPSIS;
}

function usable(img: HTMLImageElement | null): img is HTMLImageElement {
  return !!img && img.naturalWidth > 0 && img.naturalHeight > 0;
}

/** Cover-crop `img` into the box, biased upward — these are head shots, and a
 *  dead-centre crop tends to cut the top of the head. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x - (dw - w) / 2, y - (dh - h) * 0.35, dw, dh);
  ctx.restore();
}

/**
 * Clears the canvas, scales to design units and draws everything around the
 * card's middle: background, photo column, inset hairline, wordmark and
 * dateline. Returns the frame the card draws its middle into; finish with
 * endCard().
 */
export function beginCard(ctx: CanvasRenderingContext2D, chrome: CardChrome): CardFrame {
  const { canvas } = ctx;
  const s = canvas.width / CARD_W;
  const C = PALETTES[chrome.theme];

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const photo = usable(chrome.photo) ? chrome.photo : null;
  // With a photo the text lives in a column beside it; without one it takes
  // the whole card. Every x in every card derives from these two.
  const LEFT = photo ? PHOTO_W + PHOTO_GAP : PAD;
  const COL = RIGHT - LEFT;

  ctx.fillStyle = C.card;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  if (photo) {
    drawCover(ctx, photo, 0, 0, PHOTO_W, CARD_H);
    ctx.fillStyle = C.hairline;
    ctx.fillRect(PHOTO_W, 0, 1, CARD_H);
  }

  // Inset hairline: the PNG lands on a timeline close to its own background
  // (black on X's dark theme, white on light), so give it an edge.
  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_W - 2, CARD_H - 2);

  if (usable(chrome.logo)) {
    const logoW = LOGO_H * (chrome.logo.naturalWidth / chrome.logo.naturalHeight);
    drawTintedLogo(ctx, chrome.logo, LEFT, TOP, logoW, LOGO_H, C.logo);
  }
  if (chrome.headerRight) {
    ctx.font = font(500, 28);
    ctx.fillStyle = C.secondary;
    ctx.textAlign = 'right';
    // Optically centred on the wordmark's box rather than its baseline.
    ctx.fillText(ellipsize(ctx, chrome.headerRight, COL * 0.6), RIGHT, TOP + LOGO_H / 2 + 10);
    ctx.textAlign = 'left';
  }

  return { ctx, C, LEFT, COL };
}

export function endCard(f: CardFrame) {
  f.ctx.restore();
}

/** Draws a glyph whose left edge is `x`, centred on `cy`, filling a `size` box. */
export type LockupGlyph = (ctx: CanvasRenderingContext2D, x: number, cy: number, size: number, color: string) => void;

/**
 * The accent lockup — the news itself, read before anything else. Sized like
 * a headline (no pill, no fill, no qualifiers), with the glyph drawn to the
 * word's cap height and centred on its cap band, so word and glyph read as
 * one lockup rather than an icon parked next to text.
 */
export function drawLockup(f: CardFrame, label: string, baseline: number, color: string, glyph: LockupGlyph) {
  const { ctx, LEFT } = f;
  ctx.font = font(700, 46);
  ctx.fillStyle = color;
  fillTracked(ctx, label, LEFT, baseline, 3);
  const caps = ctx.measureText(label).actualBoundingBoxAscent;
  glyph(ctx, LEFT + trackedWidth(ctx, label, 3) + 20, baseline - caps / 2, caps, color);
}

/** The person's name: 600 54→32, fit to the column, then ellipsized. */
export function drawName(f: CardFrame, name: string, baseline: number) {
  const { ctx, LEFT, COL } = f;
  const size = fitFontSize(ctx, name, SANS, 600, 54, 32, COL);
  ctx.font = font(600, size);
  ctx.fillStyle = f.C.primary;
  ctx.fillText(ellipsize(ctx, name, COL), LEFT, baseline);
}

/** The hero figure in mono, with its tracked caption underneath. */
export function drawHero(
  f: CardFrame, text: string, color: string, baseline: number, maxSize: number, caption: string, captionBaseline: number,
) {
  const { ctx, LEFT, COL } = f;
  const size = fitFontSize(ctx, text, MONO, 500, maxSize, 56, COL);
  ctx.font = font(500, size, MONO);
  ctx.fillStyle = color;
  ctx.fillText(text, LEFT, baseline);
  ctx.font = font(400, 19);
  ctx.fillStyle = f.C.muted;
  fillTracked(ctx, caption, LEFT, captionBaseline, 2.4);
}

/**
 * Footnote: `left` (facts or a call to action) and `right` (the profile URL)
 * on one quiet line above the bottom padding. Both ends share ONE size and
 * tone so they read as a single baseline-aligned line; when the pair is too
 * wide for the column the whole row steps down together before the left
 * side gets ellipsized.
 */
export function drawFootnote(f: CardFrame, left: string, right: string) {
  const { ctx, LEFT, COL } = f;
  ctx.fillStyle = f.C.hairline;
  ctx.fillRect(LEFT, FOOT_RULE_Y, COL, 1);
  const l = left.trim();
  const rowWidth = (size: number) => {
    ctx.font = font(400, size);
    return ctx.measureText(right).width + (l ? FOOT_GAP + ctx.measureText(l).width : 0);
  };
  let size = 22;
  while (rowWidth(size) > COL && size > 18) size -= 1;
  ctx.font = font(400, size);
  ctx.fillStyle = f.C.secondary;
  const rightW = ctx.measureText(right).width;
  ctx.textAlign = 'right';
  ctx.fillText(right, RIGHT, BOTTOM);
  ctx.textAlign = 'left';
  if (l) ctx.fillText(ellipsize(ctx, l, COL - rightW - FOOT_GAP), LEFT, BOTTOM);
}
