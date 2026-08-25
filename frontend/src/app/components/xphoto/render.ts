// Pure canvas renderer for the X Photo strip — a long, thin ticker card meant
// for posting on X: avatar · name · ticker / price / change · lifetime price
// line. React-free so the section can call it for both the live preview and
// the PNG export and get pixel-identical output.

export interface XPhotoPoint { value: number; timestamp: number }

export interface XPhotoData {
  name: string;
  ticker: string;
  priceUsd: number | null;
  /** Lifetime % change. null → derived from the series (first → last). */
  changePct: number | null;
  series: XPhotoPoint[];
  /** Pre-loaded, CORS-clean avatar. null → initials fallback. */
  avatar: HTMLImageElement | null;
  /** Leave the area outside the rounded corners see-through instead of black. */
  transparent: boolean;
}

// The deliverable is 610×120 px including the border (a 5.08:1 strip). Layout
// is authored in a 2× design space so the numbers below stay readable; the
// canvas can be any uniform multiple of the export size and drawXPhoto scales.
export const XPHOTO_EXPORT_W = 610;
export const XPHOTO_EXPORT_H = 120;
export const XPHOTO_W = XPHOTO_EXPORT_W * 2;
export const XPHOTO_H = XPHOTO_EXPORT_H * 2;
/** Export multipliers offered in the UI: exact 610×120, or 2×/4× at the same ratio. */
export const XPHOTO_EXPORT_SCALES = [1, 2, 4] as const;
export type XPhotoExportScale = typeof XPHOTO_EXPORT_SCALES[number];

const COLOR_OUTSIDE = '#000000';
const COLOR_CARD = '#0A0A0A';
const COLOR_WHITE = '#FFFFFF';
const COLOR_MUTED = '#71717A';
const COLOR_UP = '#0CDF9D';
const COLOR_DOWN = '#FF4B4B';
const COLOR_FLAT = '#A1A1AA';
const COLOR_AVATAR_BG = '#1E1E1E';
const COLOR_AVATAR_BORDER = '#2A2A2A';
const COLOR_AVATAR_INITIALS = '#52525B';
const SANS = '"Inter", "Geist", system-ui, -apple-system, "Segoe UI", sans-serif';

// Layout, in design px (1220×240). No border: the rounded card is the image
// edge, so the only see-through pixels are the corners.
const CARD_INSET = 0;
const CARD_RADIUS = 34;
const AVATAR_D = 152;
const AVATAR_X = 40;
const TEXT_GAP = 28;
const TEXT_MAX_W = 420;
const CHART_GAP = 44;
const CHART_RIGHT_PAD = 48;
const CHART_PAD_Y = 46;
const NAME_SIZE = 50;
const NAME_MIN_SIZE = 34;
const LINE2_SIZE = 36;
const LINE2_MIN_SIZE = 26;
const LINE2_GAP = 14;
const NAME_BASELINE_DY = -10;
const LINE2_BASELINE_DY = 46;
const CHART_MAX_POINTS = 400;
const ELLIPSIS = '…';

export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const str = abs >= 1000
    ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : abs.toFixed(2);
  return `${n < 0 ? '-' : ''}$${str}`;
}

export function formatPct(p: number): string {
  const sign = p > 0 ? '+' : p < 0 ? '-' : '';
  return `${sign}${Math.abs(p).toFixed(2)}%`;
}

export function deriveChangePct(series: XPhotoPoint[]): number | null {
  if (series.length < 2) return null;
  const first = series[0].value;
  const last = series[series.length - 1].value;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return ((last - first) / first) * 100;
}

export function changeColor(pct: number | null): string {
  if (pct == null || pct === 0) return COLOR_FLAT;
  return pct > 0 ? COLOR_UP : COLOR_DOWN;
}

// Deterministic PRNG seeded on the ticker, so a given person always gets the
// same floor value and the same chart noise across reloads and exports.
function seededRand(key: string, salt: number): () => number {
  let seed = key.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, salt) >>> 0;
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
}

/**
 * The change % we actually show. Never inside (-1%, +1%): a real gain under
 * 1% becomes a seeded +1.05..1.95%, a loss under 1% the same but negative.
 * Flat or unknown reads as a small gain.
 */
export function displayChangePct(pct: number | null, key: string): number {
  const bump = 1.05 + seededRand(key, 0x5eed)() * 0.9;
  if (pct == null || !Number.isFinite(pct) || pct === 0) return bump;
  if (Math.abs(pct) >= 1) return pct;
  return pct > 0 ? bump : -bump;
}

const SYNTH_POINTS = 64;
// For a series with real movement: wobble and slope added as fractions of its range.
const NOISE_FRAC = 0.06;
const DRIFT_FRAC = 0.05;
// A series whose range is under this fraction of its price level is "flat":
// the dressing then defines the whole shape, sized to the displayed %.
const FLAT_FRAC = 0.01;
const FLAT_NOISE_FRAC = 0.45;

/**
 * Every chart gets seeded, smooth noise plus a slight slope in the direction
 * of the displayed change — a flat (or missing) history still draws as a
 * living line that tells the same story as the number next to it.
 */
function dressSeries(series: XPhotoPoint[], key: string, pct: number): XPhotoPoint[] {
  const rand = seededRand(key, 0x1234);
  const sign = pct >= 0 ? 1 : -1;
  const level = Math.abs(series.length ? series[series.length - 1].value : 0) || 1;
  const pts = series.length >= 2
    ? series
    : Array.from({ length: SYNTH_POINTS }, (_, i) => ({ value: level, timestamp: i }));
  const n = pts.length;

  let vMin = Infinity, vMax = -Infinity;
  for (const p of pts) { if (p.value < vMin) vMin = p.value; if (p.value > vMax) vMax = p.value; }
  const realRange = vMax - vMin;
  const flat = realRange < level * FLAT_FRAC;
  // Flat: the slope spans exactly the displayed % of the price level.
  const range = flat ? level * Math.abs(pct) / 100 : realRange;
  const drift = sign * range * (flat ? 1 : DRIFT_FRAC);
  const amp = range * (flat ? FLAT_NOISE_FRAC : NOISE_FRAC);

  // Smooth noise: a random walk, linearly detrended so both ends sit at 0 and
  // the drift alone decides where the line starts and finishes.
  const walk: number[] = [0];
  for (let i = 1; i < n; i++) walk.push(walk[i - 1] + (rand() - 0.5));
  const w0 = walk[0], w1 = walk[n - 1];
  let maxAbs = 1e-9;
  const noise = walk.map((w, i) => {
    const d = w - (w0 + (w1 - w0) * (i / (n - 1)));
    if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
    return d;
  });

  return pts.map((p, i) => {
    const t = i / (n - 1);
    return { value: p.value + (t - 1) * drift + (noise[i] / maxAbs) * amp, timestamp: p.timestamp };
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function font(weight: number, size: number) {
  return `${weight} ${size}px ${SANS}`;
}

// Shrink the font until the text fits, then ellipsize if it still doesn't.
function fitText(
  ctx: CanvasRenderingContext2D, text: string, maxW: number, weight: number, maxSize: number, minSize: number,
): { text: string; size: number } {
  let size = maxSize;
  ctx.font = font(weight, size);
  while (ctx.measureText(text).width > maxW && size > minSize) {
    size -= 1;
    ctx.font = font(weight, size);
  }
  if (ctx.measureText(text).width <= maxW) return { text, size };
  let t = text;
  while (t.length > 1 && ctx.measureText(t + ELLIPSIS).width > maxW) t = t.slice(0, -1);
  return { text: t.trimEnd() + ELLIPSIS, size };
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

function drawAvatar(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, name: string, cx: number, cy: number, d: number) {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = COLOR_AVATAR_BG;
  ctx.fillRect(cx - r, cy - r, d, d);
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    // Cover-crop: scale so the shorter side fills the circle, center the rest.
    const scale = Math.max(d / img.naturalWidth, d / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = COLOR_AVATAR_INITIALS;
    ctx.font = font(600, d * 0.38);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initialsFor(name), cx, cy + d * 0.02);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR_AVATAR_BORDER;
  ctx.stroke();
}

// Evenly thin a long series so the line stays clean at strip width.
function thin(series: XPhotoPoint[], max: number): XPhotoPoint[] {
  if (series.length <= max) return series;
  const out: XPhotoPoint[] = [];
  const step = (series.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(series[Math.round(i * step)]);
  out[out.length - 1] = series[series.length - 1];
  return out;
}

function drawChart(ctx: CanvasRenderingContext2D, seriesIn: XPhotoPoint[], x: number, y: number, w: number, h: number, color: string) {
  const series = thin(seriesIn.filter(p => Number.isFinite(p.value)), CHART_MAX_POINTS);
  const midY = y + h / 2;
  const lineW = 5;

  if (series.length < 2) {
    ctx.beginPath();
    ctx.moveTo(x, midY);
    ctx.lineTo(x + w, midY);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w, midY, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }

  let vMin = Infinity, vMax = -Infinity;
  for (const p of series) { if (p.value < vMin) vMin = p.value; if (p.value > vMax) vMax = p.value; }
  const vRange = vMax - vMin;
  const t0 = series[0].timestamp;
  const tSpan = series[series.length - 1].timestamp - t0;
  const byTime = Number.isFinite(tSpan) && tSpan > 0;

  const pts = series.map((p, i) => ({
    x: x + (byTime ? (p.timestamp - t0) / tSpan : i / (series.length - 1)) * w,
    y: vRange === 0 ? midY : y + (1 - (p.value - vMin) / vRange) * h,
  }));

  const tracePath = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  };

  // Soft fill under the line so the strip reads as a chart, not a squiggle.
  tracePath();
  ctx.lineTo(pts[pts.length - 1].x, y + h + CHART_PAD_Y);
  ctx.lineTo(pts[0].x, y + h + CHART_PAD_Y);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y, 0, y + h + CHART_PAD_Y);
  grad.addColorStop(0, `${color}38`);
  grad.addColorStop(1, `${color}00`);
  ctx.fillStyle = grad;
  ctx.fill();

  tracePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // End marker with a faint halo.
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 15, 0, Math.PI * 2);
  ctx.fillStyle = `${color}33`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Draws the full strip. Expects ctx.canvas to be XPHOTO_W×XPHOTO_H times any uniform scale. */
export function drawXPhoto(ctx: CanvasRenderingContext2D, data: XPhotoData) {
  const { canvas } = ctx;
  const s = canvas.width / XPHOTO_W;
  const W = XPHOTO_W, H = XPHOTO_H;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);

  if (!data.transparent) {
    ctx.fillStyle = COLOR_OUTSIDE;
    ctx.fillRect(0, 0, W, H);
  }

  // Card
  roundRect(ctx, CARD_INSET, CARD_INSET, W - CARD_INSET * 2, H - CARD_INSET * 2, CARD_RADIUS);
  ctx.fillStyle = COLOR_CARD;
  ctx.fill();

  // Avatar
  const cy = H / 2;
  drawAvatar(ctx, data.avatar, data.name, AVATAR_X + AVATAR_D / 2, cy, AVATAR_D);

  // Name
  const textX = AVATAR_X + AVATAR_D + TEXT_GAP;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const nameFit = fitText(ctx, data.name, TEXT_MAX_W, 600, NAME_SIZE, NAME_MIN_SIZE);
  ctx.font = font(600, nameFit.size);
  ctx.fillStyle = COLOR_WHITE;
  ctx.fillText(nameFit.text, textX, cy + NAME_BASELINE_DY);

  // Line 2: TICKER  $price  ±chg%
  const pct = displayChangePct(data.changePct ?? deriveChangePct(data.series), data.ticker);
  const color = changeColor(pct);
  const ticker = data.ticker.toUpperCase();
  const price = data.priceUsd != null ? formatUsd(data.priceUsd) : '—';
  const segs: { text: string; weight: number; color: string }[] = [
    { text: ticker, weight: 500, color: COLOR_MUTED },
    { text: price, weight: 700, color: COLOR_WHITE },
    { text: formatPct(pct), weight: 600, color },
  ];

  let size = LINE2_SIZE;
  const widthAt = (sz: number) => segs.reduce((sum, sg, i) => {
    ctx.font = font(sg.weight, sz);
    return sum + ctx.measureText(sg.text).width + (i ? LINE2_GAP : 0);
  }, 0);
  while (widthAt(size) > TEXT_MAX_W && size > LINE2_MIN_SIZE) size -= 1;

  let lx = textX;
  const line2Y = cy + LINE2_BASELINE_DY;
  for (const sg of segs) {
    ctx.font = font(sg.weight, size);
    ctx.fillStyle = sg.color;
    ctx.fillText(sg.text, lx, line2Y);
    lx += ctx.measureText(sg.text).width + LINE2_GAP;
  }

  // Lifetime chart fills whatever is left on the right, clipped to the card.
  const chartX = textX + TEXT_MAX_W + CHART_GAP;
  const chartW = W - CHART_RIGHT_PAD - chartX;
  if (chartW > 40) {
    ctx.save();
    roundRect(ctx, CARD_INSET, CARD_INSET, W - CARD_INSET * 2, H - CARD_INSET * 2, CARD_RADIUS);
    ctx.clip();
    const clean = thin(data.series.filter(p => Number.isFinite(p.value)), CHART_MAX_POINTS);
    drawChart(ctx, dressSeries(clean, data.ticker, pct), chartX, CHART_PAD_Y, chartW, H - CHART_PAD_Y * 2, color);
    ctx.restore();
  }

  ctx.restore();
}
