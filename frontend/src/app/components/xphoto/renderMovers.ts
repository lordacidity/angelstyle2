// The "Movers this week" card — three people on one 3:2 card, faces first:
// each column leads with a big photo tile, then name · industry · a small
// sparkline · lifetime change · price. Who the movers are is an editorial
// pick in the studio; the card just presents them. The frame (hairline,
// header, footnote) is ./card.ts; the sparkline is the strip's own chart
// routine from ./render.ts drawn at a lighter weight.
//
// Colour: the headline is plain text (only NEW LISTING and UP/DOWN get the
// accent, by rule); each mover's change and line take green or red for their
// own direction. Everything else is grey.

import { drawDressedChart, formatPct, formatUsd, type XPhotoPoint } from './render';
import {
  beginCard, endCard, drawCover, drawFootnote, drawLockup, ellipsize, fillTracked, fitFontSize, font,
  formatCardDate, PAD, RIGHT, type CardChrome, type PhotoCrop, type PhotoRect,
} from './card';
import { MONO, SANS } from './shared';

export interface Mover {
  name: string;
  industry: string | null;
  /** Where the photo sits in its tile. Omitted → DEFAULT_CROP. */
  crop?: PhotoCrop;
  /** Lifetime change in percent — already floored by displayChangePct. */
  changePct: number;
  nowUsd: number | null;
  /** Lifetime Pauv history; the sparkline dresses it. */
  series: XPhotoPoint[];
  /** Seed for the sparkline's noise (the ticker) so exports are repeatable. */
  seedKey: string;
  /** Pre-loaded, CORS-clean photo. null → initials tile. */
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
const LOCKUP_BASELINE = 196;
// Three equal columns across the text width (no photo column on this card).
const GAP = 42;
const COL_W = (RIGHT - PAD - GAP * (MOVERS_MAX - 1)) / MOVERS_MAX;
// Column rhythm, top → bottom. The photo takes the top half so the three
// faces are what a reader sees first.
const PHOTO_TOP = 236;
const PHOTO_H = 216;
const NAME_BASELINE = PHOTO_TOP + PHOTO_H + 44;
const INDUSTRY_BASELINE = NAME_BASELINE + 30;
const CHART_TOP = INDUSTRY_BASELINE + 14;
const CHART_H = 48;
// Thinner stroke and marker for the small box; the figure sits under the
// sparkline, above the footnote rule at 670.
const CHART_WEIGHT = 0.6;
const FIGURE_BASELINE = 640;
const FIGURE_GAP = 16;

/** The i-th mover's photo tile — where the studio lets the user drag it. */
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

  // Plain headline, no glyph: movers go both ways, so neither arrow would be
  // honest and the accent is reserved for NEW LISTING and UP/DOWN.
  drawLockup(f, LOCKUP, LOCKUP_BASELINE, C.primary, () => undefined);

  d.movers.slice(0, MOVERS_MAX).forEach((m, i) => {
    const { x } = moverPhotoRect(i);
    const up = m.changePct >= 0;
    const accent = up ? C.up : C.down;

    // Photo tile — a landscape crop of the head shot, hairlined so it keeps
    // an edge on the light card.
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
    ctx.strokeStyle = C.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, PHOTO_TOP + 0.5, COL_W - 1, PHOTO_H - 1);

    // Name, then industry as a tracked caption.
    const nameSize = fitFontSize(ctx, m.name, SANS, 600, 30, 22, COL_W);
    ctx.font = font(600, nameSize);
    ctx.fillStyle = C.primary;
    ctx.fillText(ellipsize(ctx, m.name, COL_W), x, NAME_BASELINE);
    if (m.industry) {
      ctx.font = font(400, 16);
      ctx.fillStyle = C.muted;
      fillTracked(ctx, ellipsize(ctx, m.industry.toUpperCase(), COL_W - 40), x, INDUSTRY_BASELINE, 2);
    }

    // Sparkline in the mover's own direction colour.
    drawDressedChart(ctx, m.series, m.seedKey, m.changePct, x, CHART_TOP, COL_W, CHART_H, accent, CHART_WEIGHT);

    // The change, with the price right-aligned on the same baseline.
    const price = m.nowUsd != null ? formatUsd(m.nowUsd) : null;
    ctx.font = font(400, 22, MONO);
    const priceW = price ? ctx.measureText(price).width : 0;
    const change = formatPct(m.changePct);
    const changeSize = fitFontSize(ctx, change, MONO, 500, 36, 24, COL_W - priceW - (price ? FIGURE_GAP : 0));
    ctx.font = font(500, changeSize, MONO);
    ctx.fillStyle = accent;
    ctx.fillText(change, x, FIGURE_BASELINE);
    if (price) {
      ctx.font = font(400, 22, MONO);
      ctx.fillStyle = C.secondary;
      ctx.textAlign = 'right';
      ctx.fillText(price, x + COL_W, FIGURE_BASELINE);
      ctx.textAlign = 'left';
    }
  });

  drawFootnote(f, d.cta, 'pauv.com');
  endCard(f);
}
