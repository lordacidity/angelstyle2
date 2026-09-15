// The "Price change" card — calls out a big move on someone's Pauv market:
// photo · wordmark + dateline · UP / DOWN lockup · name · how far they've
// moved · their chart · was / now prices. The frame (photo column, hairline,
// header, footnote) is ./card.ts; the chart is the strip's own routine from
// ./render.ts, so the line is the real Pauv history dressed with the same
// seeded noise and slope — it keeps the market's shape and direction, it just
// never draws as a dead flat line.
//
// The chart and the figure are always lifetime, and the card never names a
// timeframe: it says they're trending and how far, nothing about since when.
//
// Colour: the lockup, the change and the chart share the one accent (green
// up, red down). The change IS the news, so it is the one figure that gets
// the colour; the prices in the footnote stay grey.

import { drawDressedChart, formatPct, formatUsd, type XPhotoPoint } from './render';
import {
  beginCard, endCard, drawFootnote, drawHero, drawLockup, drawName, formatCardDate,
  type CardChrome,
} from './card';

export interface ChangeCardData extends Omit<CardChrome, 'headerRight'> {
  name: string;
  /** The lifetime change to show, in percent — already floored by displayChangePct. */
  changePct: number;
  /** Where the history starts and where it is now (USD). null → left off the footnote. */
  fromUsd: number | null;
  nowUsd: number | null;
  /** Snapshot time for the dateline, epoch ms. */
  asOf: number;
  /** Lifetime Pauv history; the chart dresses it. */
  series: XPhotoPoint[];
  /** Seed for the chart's noise (the ticker) so exports are repeatable. */
  seedKey: string;
  /** Bare "pauv.com/profile/<ticker>" — the same text the download copies. */
  profileUrl: string;
}

// Baselines, top → bottom. Tighter than the listing card because the chart
// needs the lower third of the column.
const LOCKUP_BASELINE = 214;
const NAME_BASELINE = 300;
const HERO_BASELINE = 404;
const CAPTION_BASELINE = 446;
// The chart's soft fill runs 40 below its box (drawChart's own bottom pad),
// so the box stops well short of the footnote rule at 670.
const CHART_TOP = 486;
const CHART_H = 134;

/**
 * Thick arrow-up-right / arrow-down-right, drawn to the same construction as
 * the lucide icons the app uses (diagonal shaft + open corner head).
 */
function drawDirectionArrow(ctx: CanvasRenderingContext2D, x: number, centerY: number, size: number, up: boolean, color: string) {
  // Optical nudge: a diagonal arrow's visual mass sits behind its tip, so a
  // geometrically centred up-arrow reads high and a down-arrow reads low.
  // 3 units toward the tail settles each one onto the word's cap band.
  const cy = centerY + (up ? 3 : -3);
  const half = size / 2;
  // Head-dominant proportions: a large corner head with only a short stub of
  // shaft behind it.
  const head = size * 0.74;
  const shaftStart = 0.2;
  const tipX = x + size;
  const tailY = up ? cy + half : cy - half;
  const tipY = up ? cy - half : cy + half;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(4, size * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + size * shaftStart, tailY + (tipY - tailY) * shaftStart);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // Head: an open corner at the tip, opening back down/up the shaft.
  ctx.beginPath();
  ctx.moveTo(tipX - head, tipY);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX, up ? tipY + head : tipY - head);
  ctx.stroke();
  ctx.restore();
}

/** Draws the card. Expects ctx.canvas to be CARD_W×CARD_H times any uniform scale. */
export function drawChangeCard(ctx: CanvasRenderingContext2D, d: ChangeCardData) {
  const f = beginCard(ctx, {
    theme: d.theme,
    photo: d.photo,
    logo: d.logo,
    headerRight: formatCardDate(d.asOf),
  });
  const up = d.changePct >= 0;
  const accent = up ? f.C.up : f.C.down;

  drawLockup(f, up ? 'UP' : 'DOWN', LOCKUP_BASELINE, accent, (c, x, cy, size, color) => drawDirectionArrow(c, x, cy, size, up, color));
  drawName(f, d.name, NAME_BASELINE);
  drawHero(f, formatPct(d.changePct), accent, HERO_BASELINE, 96, 'TRENDING', CAPTION_BASELINE);
  drawDressedChart(f.ctx, d.series, d.seedKey, d.changePct, f.LEFT, CHART_TOP, f.COL, CHART_H, accent);

  // At two decimals a small move can round both prices to the same figure, and
  // "Was $0.02 · Now $0.02" under "+6.77%" reads as a contradiction — so the
  // start drops out whenever it would print identically to now.
  const from = d.fromUsd != null ? formatUsd(d.fromUsd) : null;
  const now = d.nowUsd != null ? formatUsd(d.nowUsd) : null;
  const facts = [
    from && from !== now ? `Was ${from}` : null,
    now ? `Now ${now}` : null,
  ].filter(Boolean).join('   ·   ');
  drawFootnote(f, facts, d.profileUrl);
  endCard(f);
}
