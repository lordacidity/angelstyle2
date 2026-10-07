// The "Price video" generator — a 15-second MP4 of one person's Pauv market,
// drawn in the shape of a trading app's profile screen: avatar · name / big
// price · change / Pauv wordmark / the lifetime chart with its value grid and
// date axis.
//
// It is one shot with two halves. For the first 1.5 seconds the line sweeps in
// from the left, slow out of the gate and racing by the end, and the readout
// above it is live while it travels: the price is the value under the leading
// edge, the percentage and the dollar change are that value against where the
// line started. From 1.5s to the end nothing moves but the marker on the end
// of the line, which keeps breathing.
//
// The readout doesn't follow the line frame by frame — it takes a new value
// eight times a second, the way a price moves when a trade lands, and each
// tick flashes the way the Pauv app's numbers do: the change row snaps to the
// flash colour and fades back over 550ms. That is useFlash, from the app's
// components/sx/SXOpenPosition.tsx, ported here; the colours are its
// flash-positive / flash-negative tokens (see ./shared). The price itself
// stays white throughout — it rolls, it doesn't pulse. Digits that changed on
// the tick are smeared for the frames after it — the odometer blur.
//
// React-free like the rest of X Photo, and a pure function of (card, t): the
// preview loop and the encoder call the same draw, so the file is the preview.
//
// The line is the strip's own dressed history (./render.ts) — real Pauv
// trades, re-spaced and given seeded noise, so a quiet market still draws a
// living line — scaled so its last point lands exactly on the price now.
// Someone with no history at all gets the synthesized line that dressing
// already makes for a flat series.

import { dressedSeries, type XPhotoPoint } from './render';
import { PALETTES, SANS, type CardPalette, type CardTheme } from './shared';
import { ellipsize, fitFontSize, font } from './card';

/** Design units — the 820×1020 shape of the app's screen, at 1080 wide. */
export const VIDEO_W = 1080;
export const VIDEO_H = 1344;
export const VIDEO_FPS = 30;
export const VIDEO_SECONDS = 15;
/** How long the line takes to cross. The rest of the video is the end marker. */
export const VIDEO_SWEEP = 1.5;
export const VIDEO_FRAMES = VIDEO_FPS * VIDEO_SECONDS;

/** The sweep's shape: progress = (elapsed / sweep) ^ this. Above 1 the line
 *  creeps out of the left and then runs, which is the point — the move only
 *  resolves in the last few frames before it settles. */
const SWEEP_EASE = 3;
/** How often the readout takes a new value while the line travels. Prod's
 *  numbers move when a trade lands, not every frame, and the flash is built
 *  around that: a tick, then the fade back. Divides the sweep exactly, so the
 *  last tick lands on the frame the line arrives. */
const TICK_SECONDS = 0.125;
/** useFlash: `transition: color 550ms ease-out`. */
const FLASH_SECONDS = 0.55;
/** How long a digit stays smeared after the tick that changed it. */
const ROLL_SECONDS = 0.09;

// ── Layout, in design units ────────────────────────────────────────────────
const PAD_L = 100;
const RIGHT = 1010;
const AV_X = 100;
const AV_D = 96;
const AV_CY = 190;
const NAME_X = AV_X + AV_D + 30;
const NAME_SIZE = 54;
const NAME_MIN = 34;
const PRICE_BASELINE = 330;
const PRICE_SIZE = 76;
const TICKER_SIZE = 46;
const TICKER_GAP = 18;
const CHG_BASELINE = 400;
const CHG_SIZE = 32;
const TRI_W = 24;
const TRI_H = 19;
const TRI_GAP = 18;
const LOGO_H = 40;
// The wordmark sits out on the change row, the way the app's does.
const LOGO_CY = CHG_BASELINE - 11;
// The value grid: five dotted rules, the top and bottom ones the axis ends.
const GRID_TOP = 478;
const GRID_BOTTOM = 1198;
const GRID_ROWS = 5;
const GRID_L = 58;
/** The rules run past the line's box, then stop short of their own labels. */
const GRID_R_MAX = 924;
const VALUE_SIZE = 22;
const VALUE_MIN_SIZE = 15;
/** Widest a grid label may be before its font gives way. */
const VALUE_MAX_W = 96;
const VALUE_GAP = 24;
const PLOT_L = 66;
const PLOT_R = 880;
const DATE_BASELINE = 1286;
const DATE_SIZE = 22;
// The axis holds the data in its middle ~59%, so the line never touches the
// top or bottom rule — the same breathing room the app leaves.
const AXIS_PAD = 1.7;
const LINE_W = 5;
const DOT_R = 9;
const SWEEP_DOT_R = 5;
const PULSE_SECONDS = 1.4;

export interface VideoCardInput {
  theme: CardTheme;
  name: string;
  ticker: string;
  /** Pre-loaded, CORS-clean photo for the avatar. null → initials. */
  avatar: HTMLImageElement | null;
  /** Pre-loaded /pauvlogo.png. null → no wordmark. */
  logo: HTMLImageElement | null;
  /** Lifetime Pauv history, raw. Dressed and scaled here. */
  series: XPhotoPoint[];
  /** The % the line should tell — already floored by displayChangePct. */
  pct: number;
  /** Price now (USD). The line's last point is scaled onto it exactly. */
  nowUsd: number | null;
  /** profiles.created_at, for the date axis when there is no history. */
  listedAt: number | null;
}

interface Pt { x: number; y: number }

/** Everything a frame needs, worked out once: the line in design units, the
 *  value grid, the date axis and how the numbers are written. */
export interface VideoCard {
  input: VideoCardInput;
  C: CardPalette;
  pts: Pt[];
  values: number[];
  /** Top → bottom, one per grid rule. */
  gridLabels: string[];
  dateLabels: { x: number; text: string }[];
  startValue: number;
  endValue: number;
  /** Where the whole move ends up — the line's one colour, fixed from the
   *  first frame even while the readout is still at zero. */
  up: boolean;
  priceDecimals: number;
  deltaDecimals: number;
}

const DAY = 86_400_000;
const HALF_YEAR = 180 * DAY;
/** Epoch ms are ~1.7e12; anything under this is an index, not a date. */
const PLAUSIBLE_MS = 9.4e11;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function fixed(n: number, decimals: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "$14.47" — the big figure and the grid's labels share these decimals. */
function money(n: number, decimals: number): string {
  return `${n < 0 ? '-' : ''}$${fixed(Math.abs(n), decimals)}`;
}

function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** `#RRGGBB` a → b, `f` of the way. The flash is a colour transition, and
 *  canvas has none of its own. */
function mixHex(a: string, b: string, f: number): string {
  const x = parseInt(a.slice(1, 7), 16);
  const y = parseInt(b.slice(1, 7), 16);
  const k = clamp01(f);
  const mix = (sh: number) => Math.round((((x >> sh) & 255) * (1 - k)) + (((y >> sh) & 255) * k));
  return `rgb(${mix(16)},${mix(8)},${mix(0)})`;
}

/**
 * Works the card out once. Everything that could move between frames — the
 * line's geometry, the axis, the labels — is settled here, so the sweep only
 * ever reveals more of a picture that was decided before the first frame.
 */
export function prepareVideoCard(input: VideoCardInput): VideoCard {
  const C = PALETTES[input.theme];
  // A history of one trade (or none) dresses into the same synthesized line
  // the strip draws while it is still loading.
  const dressed = dressedSeries(input.series.length >= 2 ? input.series : [], input.ticker, input.pct);

  // Land the line exactly on the price now: dressing adds noise and slope, so
  // its last point is near the real one, not on it. Scaling is multiplicative,
  // so the shape it drew is untouched.
  const last = dressed.length ? dressed[dressed.length - 1].value : 0;
  const k = input.nowUsd != null && Number.isFinite(input.nowUsd) && last > 0 ? input.nowUsd / last : 1;
  const values = dressed.map(p => p.value * k);
  while (values.length < 2) values.push(values[values.length - 1] ?? 1);

  const n = values.length;
  let vMin = Infinity, vMax = -Infinity;
  for (const v of values) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
  const mid = (vMin + vMax) / 2;
  const span = Math.max((vMax - vMin) * AXIS_PAD, Math.abs(mid) * 0.01, 1e-6);
  const axisMax = mid + span / 2;
  const axisMin = mid - span / 2;

  // The line is plotted by index. Dressing already re-spaced a real history
  // evenly in time (see evenInTime in ./render), so index IS time here — and
  // a synthesized line has no real times to honour anyway.
  const pts: Pt[] = values.map((v, i) => ({
    x: PLOT_L + (i / (n - 1)) * (PLOT_R - PLOT_L),
    y: GRID_BOTTOM - ((v - axisMin) / (axisMax - axisMin)) * (GRID_BOTTOM - GRID_TOP),
  }));

  const step = span / (GRID_ROWS - 1);
  let decimals = 2;
  while (decimals < 6 && step < Math.pow(10, -decimals) * 5) decimals++;
  const gridLabels = Array.from({ length: GRID_ROWS }, (_, i) => fixed(axisMax - step * i, decimals));

  // Dates for the axis. Without a usable history the line is invented, so the
  // span is too: from the day they listed (or half a year back) to today.
  const rawFrom = dressed.length ? dressed[0].timestamp : 0;
  const rawTo = dressed.length ? dressed[dressed.length - 1].timestamp : 0;
  const real = rawFrom > PLAUSIBLE_MS && rawTo > rawFrom;
  const now = Date.now();
  const from = real ? rawFrom : (input.listedAt && input.listedAt > PLAUSIBLE_MS ? input.listedAt : now - HALF_YEAR);
  const to = real ? rawTo : now;
  const dateLabels = Array.from({ length: 5 }, (_, i) => {
    const f = i / 4;
    return { x: PLOT_L + f * (PLOT_R - PLOT_L), text: shortDate(from + (to - from) * f) };
  });

  const startValue = values[0];
  const endValue = values[n - 1];
  const priceDecimals = Math.abs(endValue) >= 1 ? 2 : Math.abs(endValue) >= 0.1 ? 3 : 4;

  return {
    input,
    C,
    pts,
    values,
    gridLabels,
    dateLabels,
    startValue,
    endValue,
    up: endValue >= startValue,
    priceDecimals,
    // The move itself is small against the price, so it always gets a digit
    // more than the price does — the way the app writes it.
    deltaDecimals: Math.max(3, priceDecimals + 1),
  };
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
}

function drawAvatar(ctx: CanvasRenderingContext2D, C: CardPalette, img: HTMLImageElement | null, name: string, cx: number, cy: number, d: number) {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = C.hairline;
  ctx.fillRect(cx - r, cy - r, d, d);
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const scale = Math.max(d / img.naturalWidth, d / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    // Biased upward: these are head shots, and dead centre clips the head.
    ctx.drawImage(img, cx - dw / 2, cy - dh * 0.42, dw, dh);
  } else {
    ctx.fillStyle = C.muted;
    ctx.font = font(600, d * 0.36);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initialsFor(name), cx, cy + d * 0.02);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.hairline;
  ctx.stroke();
}

// The still cards tint the wordmark into a fresh offscreen canvas per draw
// (drawTintedLogo in ./shared). This one draws 30 frames a second for as long
// as the preview is open, so the tinted copy is kept: same wordmark, same
// colour, same pixel size — same canvas.
let tintedCache: { logo: HTMLImageElement; color: string; w: number; h: number; canvas: HTMLCanvasElement } | null = null;

function tintedLogo(logo: HTMLImageElement, w: number, h: number, color: string): HTMLCanvasElement | null {
  const pw = Math.max(1, Math.round(w));
  const ph = Math.max(1, Math.round(h));
  const hit = tintedCache;
  if (hit && hit.logo === logo && hit.color === color && hit.w === pw && hit.h === ph) return hit.canvas;
  const off = document.createElement('canvas');
  off.width = pw;
  off.height = ph;
  const octx = off.getContext('2d');
  if (!octx) return null;
  octx.drawImage(logo, 0, 0, pw, ph);
  // Only the wordmark's own pixels take the tint.
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = color;
  octx.fillRect(0, 0, pw, ph);
  tintedCache = { logo, color, w: pw, h: ph, canvas: off };
  return off;
}

function drawTriangle(ctx: CanvasRenderingContext2D, x: number, cy: number, w: number, h: number, up: boolean, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x + w / 2, cy - h / 2);
    ctx.lineTo(x + w, cy + h / 2);
    ctx.lineTo(x, cy + h / 2);
  } else {
    ctx.moveTo(x + w / 2, cy + h / 2);
    ctx.lineTo(x + w, cy - h / 2);
    ctx.lineTo(x, cy - h / 2);
  }
  ctx.closePath();
  ctx.fill();
}

/** The widest digit at the current font — every digit is then drawn in a cell
 *  this wide, so a rolling figure never shuffles sideways under itself. */
function digitCell(ctx: CanvasRenderingContext2D): number {
  let w = 0;
  for (const d of '0123456789') w = Math.max(w, ctx.measureText(d).width);
  return w;
}

function figureWidth(ctx: CanvasRenderingContext2D, text: string, cell: number): number {
  let w = 0;
  for (const ch of text) w += /\d/.test(ch) ? cell : ctx.measureText(ch).width;
  return w;
}

/**
 * The big figure, drawn a character at a time so a digit that changed on the
 * last tick can be drawn mid-roll: the digit it is leaving sits above, smeared
 * into the one taking its place. The characters that didn't change stay sharp,
 * which is what makes it read as an odometer rather than a flicker. `roll`
 * fades the smear out over the frames after the tick.
 */
function drawFigure(
  ctx: CanvasRenderingContext2D, text: string, previous: string | null, roll: number,
  x: number, baseline: number, size: number, cell: number, color: string,
) {
  const rolling = roll > 0 && !!previous && previous.length === text.length;
  const rise = size * 0.52 * roll;
  let cx = x;
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const adv = /\d/.test(ch) ? cell : ctx.measureText(ch).width;
    const put = (c: string, dy: number, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.fillText(c, cx + (adv - ctx.measureText(c).width) / 2, baseline + dy);
    };
    const was = rolling ? previous![i] : ch;
    if (was !== ch) {
      for (let k = 1; k <= 4; k++) put(ch, -rise * (k / 5), 0.13 * roll);
      put(was, -rise, 0.28 * roll);
      put(ch, 0, 1 - 0.08 * roll);
    } else {
      put(ch, 0, 1);
    }
    cx += adv;
  }
  ctx.globalAlpha = 1;
}

/** The line as far as `upto` (a float index), smoothed the same way the
 *  strip's chart is: each point steered through to the midpoint of the next. */
function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[], upto: number, lead: Pt) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  const whole = Math.min(Math.floor(upto), pts.length - 1);
  for (let i = 1; i < whole && i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  ctx.lineTo(lead.x, lead.y);
}

/** How far across the line is at `t` — slow out of the gate, racing by the end. */
function sweepProgress(t: number): number {
  return Math.pow(clamp01(t / VIDEO_SWEEP), SWEEP_EASE);
}

/** Where the line has got to at `t`, and the value under its leading edge. */
function leadingAt(card: VideoCard, t: number) {
  const upto = sweepProgress(t) * (card.pts.length - 1);
  const i = Math.min(card.pts.length - 2, Math.floor(upto));
  const f = upto - i;
  return {
    upto,
    point: {
      x: card.pts[i].x + (card.pts[i + 1].x - card.pts[i].x) * f,
      y: card.pts[i].y + (card.pts[i + 1].y - card.pts[i].y) * f,
    },
    value: card.values[i] + (card.values[i + 1] - card.values[i]) * f,
  };
}

/**
 * What the numbers say at `t`. They don't follow the line frame by frame: they
 * take its value on a tick, hold it until the next one, and carry the flash
 * from the tick that last moved them. Once the line has arrived every tick
 * reads the same value, so the last flash fades out and nothing moves again.
 */
function readoutAt(card: VideoCard, t: number) {
  const tick = Math.floor(t / TICK_SECONDS);
  const value = leadingAt(card, tick * TICK_SECONDS).value;
  const previous = tick > 0 ? leadingAt(card, (tick - 1) * TICK_SECONDS).value : value;
  const age = t - tick * TICK_SECONDS;
  const moved = value !== previous;
  return {
    value,
    previous,
    /** Up on this tick — not the same thing as up over the whole move. */
    tickUp: value > previous,
    /** 1 the instant it ticks → 0 at 550ms, on CSS ease-out's shape. */
    flash: moved ? Math.pow(1 - clamp01(age / FLASH_SECONDS), 2) : 0,
    roll: moved ? clamp01(1 - age / ROLL_SECONDS) : 0,
  };
}

/**
 * One frame, at `t` seconds. Expects ctx.canvas to be VIDEO_W×VIDEO_H times
 * any uniform scale.
 */
export function drawVideoFrame(ctx: CanvasRenderingContext2D, card: VideoCard, t: number) {
  const { canvas } = ctx;
  const s = canvas.width / VIDEO_W;
  const { C, input } = card;
  const lineColor = card.up ? C.up : C.down;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.card;
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);

  const lead = leadingAt(card, t);
  const read = readoutAt(card, t);
  const arrived = t >= VIDEO_SWEEP;

  // ── Who ──────────────────────────────────────────────────────────────────
  drawAvatar(ctx, C, input.avatar, input.name, AV_X + AV_D / 2, AV_CY, AV_D);

  const nameMax = RIGHT - NAME_X;
  const nameSize = fitFontSize(ctx, input.name, SANS, 700, NAME_SIZE, NAME_MIN, nameMax);
  ctx.font = font(700, nameSize);
  ctx.fillStyle = C.primary;
  ctx.fillText(ellipsize(ctx, input.name, nameMax), NAME_X, AV_CY + nameSize * 0.35);

  // ── The price, on the tick ───────────────────────────────────────────────
  // It rolls with every tick but never takes the flash colour: white the whole
  // way through, so the change row below is the only thing that pulses.
  ctx.font = font(700, PRICE_SIZE);
  const cell = digitCell(ctx);
  const priceText = money(read.value, card.priceDecimals);
  const priceWas = money(read.previous, card.priceDecimals);
  drawFigure(ctx, priceText, priceWas, read.roll, PAD_L, PRICE_BASELINE, PRICE_SIZE, cell, C.primary);
  // Measured here, while the figure's own font is still set.
  const priceW = figureWidth(ctx, priceText, cell);

  ctx.font = font(500, TICKER_SIZE);
  ctx.fillStyle = C.secondary;
  ctx.fillText(input.ticker.toUpperCase(), PAD_L + priceW + TICKER_GAP, PRICE_BASELINE);

  // ── The change, against where the line started ───────────────────────────
  const delta = read.value - card.startValue;
  const pct = card.startValue > 0 ? (delta / card.startValue) * 100 : 0;
  // Dead flat reads as a gain, the way a market screen's does at the open.
  const rising = delta >= 0;
  // useFlash, on the P&L: it pulses to flash-positive / flash-negative and
  // settles back to its own up / down colour, not to the primary.
  const base = rising ? C.up : C.down;
  const accent = mixHex(base, read.tickUp ? C.flashUp : C.flashDown, read.flash);
  drawTriangle(ctx, PAD_L, CHG_BASELINE - CHG_SIZE * 0.35, TRI_W, TRI_H, rising, accent);
  ctx.fillStyle = accent;
  let cx = PAD_L + TRI_W + TRI_GAP;
  ctx.font = font(600, CHG_SIZE);
  const pctText = `${fixed(Math.abs(pct), 2)}%`;
  ctx.fillText(pctText, cx, CHG_BASELINE);
  cx += ctx.measureText(pctText).width + 14;
  ctx.font = font(500, CHG_SIZE);
  ctx.fillText(`(${rising ? '+' : '-'}${money(Math.abs(delta), card.deltaDecimals)})`, cx, CHG_BASELINE);

  if (input.logo && input.logo.naturalWidth > 0 && input.logo.naturalHeight > 0) {
    const logoW = LOGO_H * (input.logo.naturalWidth / input.logo.naturalHeight);
    const tinted = tintedLogo(input.logo, logoW * s, LOGO_H * s, C.logo);
    if (tinted) ctx.drawImage(tinted, RIGHT - logoW, LOGO_CY - LOGO_H / 2, logoW, LOGO_H);
  }

  // ── The value grid ───────────────────────────────────────────────────────
  // The labels are measured first: a four-figure price writes a far wider one
  // than a penny stock, and the rules have to stop short of whatever it is.
  let valueSize = VALUE_SIZE;
  const widest = () => card.gridLabels.reduce((w, l) => Math.max(w, ctx.measureText(l).width), 0);
  ctx.font = font(400, valueSize);
  let labelW = widest();
  while (valueSize > VALUE_MIN_SIZE && labelW > VALUE_MAX_W) {
    valueSize -= 1;
    ctx.font = font(400, valueSize);
    labelW = widest();
  }
  const gridRight = Math.max(PLOT_R + 20, Math.min(GRID_R_MAX, RIGHT - labelW - VALUE_GAP));

  const rowGap = (GRID_BOTTOM - GRID_TOP) / (GRID_ROWS - 1);
  ctx.save();
  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 9]);
  for (let i = 0; i < GRID_ROWS; i++) {
    const y = GRID_TOP + rowGap * i;
    ctx.beginPath();
    ctx.moveTo(GRID_L, y);
    ctx.lineTo(gridRight, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  card.gridLabels.forEach((label, i) => ctx.fillText(label, RIGHT, GRID_TOP + rowGap * i + valueSize * 0.36));
  ctx.textAlign = 'left';

  // ── The line ─────────────────────────────────────────────────────────────
  ctx.save();
  tracePath(ctx, card.pts, lead.upto, lead.point);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = LINE_W;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  // The marker: a small bead while the line is travelling, then the breathing
  // halo that is the whole back half of the video. Both follow the clock, not
  // the eased progress, so the marker swells steadily while the line races.
  const settled = Math.max(0, t - VIDEO_SWEEP);
  const pulse = arrived ? 0.5 + 0.5 * Math.cos((settled / PULSE_SECONDS) * Math.PI * 2) : 0;
  const arrival = clamp01(t / VIDEO_SWEEP);
  if (arrived || arrival > 0.8) {
    // Fades in over the last fifth of the sweep so the marker doesn't appear.
    const halo = arrived ? 1 : (arrival - 0.8) / 0.2;
    ctx.beginPath();
    ctx.arc(lead.point.x, lead.point.y, (18 + 14 * pulse) * halo, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.globalAlpha = (0.1 + 0.22 * pulse) * halo;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(lead.point.x, lead.point.y, arrived ? DOT_R + pulse * 1.5 : SWEEP_DOT_R + (DOT_R - SWEEP_DOT_R) * arrival, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();

  // ── The date axis ────────────────────────────────────────────────────────
  ctx.font = font(400, DATE_SIZE);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  for (const d of card.dateLabels) {
    const half = ctx.measureText(d.text).width / 2;
    ctx.fillText(d.text, Math.min(Math.max(d.x, GRID_L + half), RIGHT - half), DATE_BASELINE);
  }
  ctx.textAlign = 'left';

  ctx.restore();
}
