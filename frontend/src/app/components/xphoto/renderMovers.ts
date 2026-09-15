// The "Movers this week" card — three people on one 3:2 card, faces first:
// three tall photo columns (each reads like the photo column on the other
// cards, not a thumbnail), and under each a compact name · industry ·
// lifetime change · price. A small heading and a small footer leave the
// height to the photos. Who the movers are is an editorial pick in the
// studio; the card just presents them. The frame (hairline, header,
// footnote) is ./card.ts.
//
// Colour: the heading is plain text (only NEW LISTING and UP/DOWN get the
// accent, by rule); each mover's change takes green or red for their own
// direction. Everything else is grey.

import { formatPct, formatUsd } from './render';
import {
  beginCard, endCard, drawCover, drawFootnote, drawLockup, ellipsize, fillTracked, fitFontSize, font,
  formatCardDate, PAD, RIGHT, type CardChrome, type PhotoCrop, type PhotoRect,
} from './card';
import { MONO, SANS } from './shared';

export interface Mover {
  name: string;
  industry: string | null;
  /** Where the photo sits in its column. Omitted → DEFAULT_CROP. */
  crop?: PhotoCrop;
  /** Lifetime change in percent — already floored by displayChangePct. */
  changePct: number;
  nowUsd: number | null;
  /** Pre-loaded, CORS-clean photo. null → initials column. */
  photo: HTMLImageElement | null;
}

export interface MoversCardData extends Omit<CardChrome, 'headerRight' | 'photo'> {
  /** Up to MOVERS_MAX, in the order they should read left → right. */
  movers: Mover[];
  /** Snapshot time for the dateline, epoch ms. */
  asOf: number;
  /** Footnote call to action, left of pauv.com. Blank → omitted. */
  cta: string;
}

export const MOVERS_MAX = 3;
const LOCKUP = 'MOVERS THIS WEEK';
// A small heading tucked under the wordmark row, so the photos get the height.
const LOCKUP_SIZE = 26;
const LOCKUP_BASELINE = 160;
// Three portrait columns — 300×440 is close to the other cards' photo
// column (480×800), so each reads as a column, not a tile.
const COL_W = 300;
const GAP = (RIGHT - PAD - COL_W * MOVERS_MAX) / (MOVERS_MAX - 1);
const PHOTO_TOP = 188;
const PHOTO_H = 440;
const PHOTO_BOTTOM = PHOTO_TOP + PHOTO_H;
// Compact text block under each column.
const NAME_BASELINE = PHOTO_BOTTOM + 36;
const INDUSTRY_BASELINE = NAME_BASELINE + 22;
const FIGURE_BASELINE = INDUSTRY_BASELINE + 34;
const FIGURE_GAP = 14;
// A much smaller footer than the other cards: one hairline and an 18px line
// close to the bottom edge.
const FOOT_RULE_Y = 744;
const FOOT_BASELINE = 772;

/** The i-th mover's photo column — where the studio lets the user drag it. */
export function moverPhotoRect(i: number): PhotoRect {
  return { x: PAD + i * (COL_W + GAP), y: PHOTO_TOP, w: COL_W, h: PHOTO_H };
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

/** Draws the card. Expects ctx.canvas to be CARD_W×CARD_H times any uniform scale. */
export function drawMoversCard(ctx: CanvasRenderingContext2D, d: MoversCardData) {
  const f = beginCard(ctx, {
    theme: d.theme,
    photo: null,
    logo: d.logo,
    headerRight: formatCardDate(d.asOf),
  });
  const { C } = f;

  // Plain heading, no glyph: movers go both ways, so neither arrow would be
  // honest, and the accent is reserved for NEW LISTING and UP/DOWN.
  drawLockup(f, LOCKUP, LOCKUP_BASELINE, C.primary, () => undefined, LOCKUP_SIZE);

  d.movers.slice(0, MOVERS_MAX).forEach((m, i) => {
    const { x } = moverPhotoRect(i);
    const accent = m.changePct >= 0 ? C.up : C.down;

    // Photo column — a portrait crop of the head shot, nothing drawn round it.
    if (m.photo && m.photo.naturalWidth > 0 && m.photo.naturalHeight > 0) {
      drawCover(ctx, m.photo, x, PHOTO_TOP, COL_W, PHOTO_H, m.crop);
    } else {
      ctx.fillStyle = C.hairline;
      ctx.fillRect(x, PHOTO_TOP, COL_W, PHOTO_H);
      ctx.fillStyle = C.muted;
      ctx.font = font(600, 72);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initialsFor(m.name), x + COL_W / 2, PHOTO_TOP + PHOTO_H / 2 + 4);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // Name, then industry as a tracked caption.
    const nameSize = fitFontSize(ctx, m.name, SANS, 600, 26, 20, COL_W);
    ctx.font = font(600, nameSize);
    ctx.fillStyle = C.primary;
    ctx.fillText(ellipsize(ctx, m.name, COL_W), x, NAME_BASELINE);
    if (m.industry) {
      ctx.font = font(400, 14);
      ctx.fillStyle = C.muted;
      fillTracked(ctx, ellipsize(ctx, m.industry.toUpperCase(), COL_W - 30), x, INDUSTRY_BASELINE, 2);
    }

    // The change, with the price right-aligned on the same baseline.
    const price = m.nowUsd != null ? formatUsd(m.nowUsd) : null;
    ctx.font = font(400, 18, MONO);
    const priceW = price ? ctx.measureText(price).width : 0;
    const change = formatPct(m.changePct);
    const changeSize = fitFontSize(ctx, change, MONO, 500, 28, 20, COL_W - priceW - (price ? FIGURE_GAP : 0));
    ctx.font = font(500, changeSize, MONO);
    ctx.fillStyle = accent;
    ctx.fillText(change, x, FIGURE_BASELINE);
    if (price) {
      ctx.font = font(400, 18, MONO);
      ctx.fillStyle = C.secondary;
      ctx.textAlign = 'right';
      ctx.fillText(price, x + COL_W, FIGURE_BASELINE);
      ctx.textAlign = 'left';
    }
  });

  drawFootnote(f, d.cta, 'pauv.com', { ruleY: FOOT_RULE_Y, baseline: FOOT_BASELINE, size: 18, minSize: 15 });
  endCard(f);
}
