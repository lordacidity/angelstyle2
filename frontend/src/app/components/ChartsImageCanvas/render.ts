// Pure canvas drawing for the "Charts Image" sentiment card. Extracted so it can
// be rendered both by the standalone ChartsImageCanvas component AND as a carousel
// background layer (CarouselCanvas). Everything here is `(ctx, …)` → no React.

import type { ChartsImageMarket, ChartsImageDirection, ChartsImageNoiseLevel, SparkPoint } from './types';

// Noise amplitude per level, as a fraction of the chart's plot height. 0 = off.
export const NOISE_SCALE: Record<ChartsImageNoiseLevel, number> = { none: 0, small: 0.035, med: 0.075, large: 0.13 };

// Stable per-ticker seed so each market's noise shape is consistent across redraws.
function tickerSeed(ticker: string): number {
  return (ticker.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 9) >>> 0) || 1;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAD      = 80; // uniform content padding on all four sides
const AVATAR_R = 52; // small inline avatar (≈h-9 at 0.38 display scale)
// Portrait gets extra breathing room; PPT keeps the original tighter values
const topPadFor    = (cH: number) => cH > 1100 ? PAD + 68 : PAD + 20;
const chartBotFor  = (cH: number) => cH > 1100 ? cH - 266  : cH - 210;
const barCyFor     = (cH: number) => cH > 1100 ? cH - 177  : cH - 140;

// Each synthetic sparkline index treated as 45 days → realistic 18-month span
const POINT_INTERVAL_MS = 45 * 24 * 60 * 60 * 1000;

// Video animation timing — the line grows for GROW_MS (divided by the speed
// multiplier), then holds on the finished chart for HOLD_MS. The recorded clip
// is GROW_MS/speed + HOLD_MS long, the same shape the Charts (artist) feature uses.
export const GROW_MS = 9000;
export const HOLD_MS = 2500;
// Period of one tip "ping" — matches the live mobile chart's pulsing price dot.
export const PULSE_MS = 1400;

// ── Helpers ─────────────────────────────────────────────────────────────────

// Deterministic, believable change% in [5, 15] seeded by ticker. Must be stable
// across redraws (the canvas repaints every animation frame) — no Math.random().
// Exported so the caption generator shows the same magnitude as the rendered card.
export function seededChangePct(ticker: string): number {
  let seed = ticker.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return 5 + (seed / 0xffffffff) * 10; // 5.0 – 15.0
}

function sparkToSeries(spark: SparkPoint[] | null | undefined): { t: number; price: number }[] {
  if (!spark?.length) return [];
  // Real Google Trends timestamps are ms-since-epoch (> year 2000 = 9.46e11).
  // Synthetic fallback timestamps are sequential indices 0, 1, 2 …
  const isReal = spark[0].timestamp > 946_684_800_000;
  if (isReal) {
    return spark.map(p => ({ t: p.timestamp, price: p.value }));
  }
  // Synthetic: space each index 45 days apart so we get ~18 months of virtual history
  const nowMs = Date.now();
  const n     = spark.length;
  return spark.map((p, i) => ({
    t:     nowMs - (n - 1 - i) * POINT_INTERVAL_MS,
    price: p.value,
  }));
}

// ── drawImageCover ─────────────────────────────────────────────────────────────

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number, cy: number, r: number,
) {
  const iw    = img.naturalWidth  || img.width  || 1;
  const ih    = img.naturalHeight || img.height || 1;
  const d     = r * 2;
  const scale = Math.max(d / iw, d / ih);
  const sw    = d / scale;
  const sh    = d / scale;
  const sx    = (iw - sw) / 2;
  const sy    = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, cx - r, cy - r, d, d);
}

// ── drawStepChart ─────────────────────────────────────────────────────────────

function drawStepChart(
  ctx:       CanvasRenderingContext2D,
  series:    { t: number; price: number }[],
  rx: number, ry: number, rw: number, rh: number,
  color:     string,
  maxLabels: number = 20,
  noiseSeed:  number = 0,
  noiseScale: number = 0,
  revealT:    number = 1,   // 0..1 — fraction of the line drawn in (video animation); 1 = full
  tipPulseT:  number = -1,  // 0..1 looping pulse phase for the live tip dot; <0 = static (still image)
) {
  if (series.length < 2) return;

  const src = series;

  const s = src;

  const V_PAD_T    = 48;
  const V_PAD_B    = 80;
  const chartAreaH = rh - V_PAD_T - V_PAD_B;

  const prices    = s.map(p => p.price);
  const minPrice  = Math.min(...prices);
  const maxPrice  = Math.max(...prices);
  const priceRange = maxPrice === minPrice ? 1 : maxPrice - minPrice;

  const tStart = s[0].t;
  const tEnd   = s[s.length - 1].t;
  const tRange = Math.max(tEnd - tStart, 1);

  // Right gutter for Y-axis labels; inner pad keeps the line/dot off the gutter edge
  const RIGHT_GUTTER    = 90;
  const CHART_RIGHT_PAD = 40;

  const toX = (t: number) =>
    rx + ((t - tStart) / tRange) * (rw - RIGHT_GUTTER - CHART_RIGHT_PAD);

  const toY = (price: number) =>
    ry + V_PAD_T + (1 - (price - minPrice) / priceRange) * chartAreaH;

  // ── Grid lines at fractions 0, 0.25, 0.5, 0.75 of rh ────────────────────
  ctx.save();
  for (const frac of [0, 0.25, 0.5, 0.75]) {
    const gy = ry + frac * rh;

    ctx.strokeStyle = '#484848';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.moveTo(rx, gy);
    ctx.lineTo(rx + rw - RIGHT_GUTTER, gy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Y-axis price label
    const labelPrice = minPrice + (1 - (gy - ry - V_PAD_T) / chartAreaH) * priceRange;
    ctx.font         = `400 20px "JetBrains Mono", "Courier New", monospace`;
    ctx.fillStyle    = '#52525b';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${labelPrice.toFixed(2)}`, rx + rw, gy);
  }

  // ── Step-line path ────────────────────────────────────────────────────────
  const rawPts = s.map(p => ({ x: toX(p.t), y: toY(p.price) }));

  // Optional noise: nudge each interior point vertically by a seeded amount so the
  // line reads as more volatile. noiseScale === 0 (level 'none') → no extra noise.
  // Amplitude scales with the chosen level; first/last points stay anchored (last
  // keeps the head dot on the real price).
  if (noiseScale > 0 && rawPts.length > 2) {
    let rng = (noiseSeed >>> 0) || 1;
    const nextRand  = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };
    const NOISE_AMP = chartAreaH * noiseScale;
    const yTop = ry + V_PAD_T;
    const yBot = ry + V_PAD_T + chartAreaH;
    for (let i = 1; i < rawPts.length - 1; i++) {
      const n = (nextRand() - 0.5) * 2 * NOISE_AMP;
      rawPts[i].y = Math.max(yTop, Math.min(yBot, rawPts[i].y + n));
    }
  }

  // Insert seeded sub-points between each pair for organic fluctuations. The noise
  // level controls BOTH how many sub-points we add (more = more jagged) and how far
  // they jitter; level 'none' keeps the original subtle baseline (1 pt, 10px).
  const noiseOn  = noiseScale > 0;
  const SUB_PTS  = noiseOn ? Math.round(2 + noiseScale * 32) : 1; // small≈3, med≈4, large≈6
  const JITTER   = noiseOn ? 10 + noiseScale * 130 : 10;          // px amplitude per sub-point
  const yTopJ    = ry + V_PAD_T;
  const yBotJ    = ry + V_PAD_T + chartAreaH;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < rawPts.length - 1; i++) {
    pts.push(rawPts[i]);
    for (let j = 1; j <= SUB_PTS; j++) {
      const t  = j / (SUB_PTS + 1);
      const x  = rawPts[i].x + (rawPts[i + 1].x - rawPts[i].x) * t;
      const y  = rawPts[i].y + (rawPts[i + 1].y - rawPts[i].y) * t;
      const h  = Math.sin(i * 127.1 + j * 311.7 + x * 0.3 + noiseSeed * 0.001) * 43758.5453;
      const n  = (h - Math.floor(h) - 0.5) * 2 * JITTER;
      pts.push({ x, y: Math.max(yTopJ, Math.min(yBotJ, y + n)) });
    }
  }
  pts.push(rawPts[rawPts.length - 1]);

  // ── Reveal: draw only the leading fraction of the path so the line "draws in"
  // left→right (video animation). The head dot below then sits at the frontier,
  // matching the leading-edge dot of the Charts (artist) animation. revealT >= 1
  // (static image / PNG / end of animation) draws the whole line unchanged.
  let drawnPts = pts;
  if (revealT < 1 && pts.length >= 2) {
    const fpos = Math.max(0, Math.min(1, revealT)) * (pts.length - 1);
    const fi   = Math.floor(fpos);
    const frac = fpos - fi;
    const slice = pts.slice(0, fi + 1);
    if (fi < pts.length - 1) {
      const a = pts[fi], b = pts[fi + 1];
      slice.push({ x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac });
    }
    drawnPts = slice.length >= 2 ? slice : pts.slice(0, 2);
  }

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 3;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.moveTo(drawnPts[0].x, drawnPts[0].y);
  for (let i = 1; i < drawnPts.length - 1; i++) {
    const mx = (drawnPts[i].x + drawnPts[i + 1].x) / 2;
    const my = (drawnPts[i].y + drawnPts[i + 1].y) / 2;
    ctx.quadraticCurveTo(drawnPts[i].x, drawnPts[i].y, mx, my);
  }
  ctx.lineTo(drawnPts[drawnPts.length - 1].x, drawnPts[drawnPts.length - 1].y);
  ctx.stroke();

  // ── Dot at the leading edge (frontier while animating; true last point when full) ─
  const last = drawnPts[drawnPts.length - 1];

  // Live pulsating tip — the same "radar ping" the Sonotrade mobile chart shows
  // at the current price. A halo expands from the 6px core out to ~26px while it
  // fades to 0; two halos offset half a cycle keep the pulse continuous. The
  // still image (tipPulseT < 0) freezes this at its mid-pulse state (r16 @ .18).
  const halo = (r: number, a: number) => {
    if (a <= 0) return;
    ctx.beginPath();
    ctx.arc(last.x, last.y, r, 0, Math.PI * 2);
    ctx.fillStyle   = color;
    ctx.globalAlpha = a;
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  if (tipPulseT < 0) {
    halo(16, 0.18); // static mid-pulse for the PNG / still
  } else {
    const p1 = tipPulseT % 1;
    const p2 = (tipPulseT + 0.5) % 1;
    halo(6 + p1 * 20, 0.36 * (1 - p1));
    halo(6 + p2 * 20, 0.36 * (1 - p2));
  }

  // Inner solid dot
  ctx.beginPath();
  ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // ── X-axis time labels ────────────────────────────────────────────────────
  ctx.font         = `400 22px "JetBrains Mono", "Courier New", monospace`;
  ctx.fillStyle    = '#52525b';
  ctx.textBaseline = 'alphabetic';
  const labelY = ry + rh - 24;

  // Place maxLabels evenly across the actual time range
  const tMin = s[0].t;
  const tMax = s[s.length - 1].t;
  const seenYears = new Set<number>();
  for (let k = 0; k < maxLabels; k++) {
    const t    = tMin + (k / (maxLabels - 1)) * (tMax - tMin);
    const year = new Date(t).getFullYear();
    if (seenYears.has(year)) continue;
    seenYears.add(year);
    const lx = toX(t);
    ctx.textAlign = k === 0 ? 'left' : k === maxLabels - 1 ? 'right' : 'center';
    ctx.fillText(String(year), lx, labelY);
  }

  ctx.restore();
}

// ── drawHeader ────────────────────────────────────────────────────────────────

interface HeaderResult {
  series:      { t: number; price: number }[];
  color:       string;
  changeBaseY: number;
}

function drawHeader(
  ctx:             CanvasRenderingContext2D,
  market:          ChartsImageMarket,
  img:             HTMLImageElement | null,
  overrideName:    string,
  cH:              number,
  overrideIndustry?: string,
  direction:       ChartsImageDirection = 'up',
): HeaderResult {
  const displayName = overrideName || market.name;
  const SANS        = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const TOP_PAD     = topPadFor(cH);

  // ── Sparkline shape (Google Trends) ──────────────────────────────────────
  const fullSeries = sparkToSeries(market.sparkline?.length ? market.sparkline : []);

  // Crop to first point where Google Trends value > 0
  const firstNonZeroIdx = fullSeries.findIndex(p => p.price > 0);
  const rawSeries = firstNonZeroIdx > 0 ? fullSeries.slice(firstNonZeroIdx) : fullSeries;

  const lastSpark = rawSeries[rawSeries.length - 1]?.price ?? 0;
  const minSpark  = rawSeries.length ? Math.min(...rawSeries.map(p => p.price)) : 0;

  // Displayed value = NPSI index from API.
  const realPrice = market.price?.usd ?? null;
  const lastPrice = realPrice != null && realPrice > 0 ? realPrice : Math.max(0.01, lastSpark);

  // Normalise: minSpark → 0.01, lastSpark → NPSI. Shape is scaled proportionally,
  // all values ≥ 0.01, last point = NPSI.
  const sparkRange = lastSpark - minSpark;
  const series = rawSeries.map(p => ({
    t:     p.t,
    price: sparkRange > 0
      ? 0.01 + ((p.price - minSpark) / sparkRange) * (lastPrice - 0.01)
      : lastPrice,
  }));

  // Headline change: magnitude is a seeded random 5–15% per ticker (stable across
  // redraws), sign comes from the up/down toggle. Raw $ change is derived from the
  // pct applied to the displayed price, so the two always agree.
  const isPositive = direction !== 'down';
  const pct        = seededChangePct(market.ticker);
  const signedPct  = isPositive ? pct : -pct;
  const startPrice = lastPrice / (1 + signedPct / 100);
  const rawChange  = lastPrice - startPrice; // +ve when up, −ve when down
  const color      = isPositive ? '#0CDF9D' : '#FF4B4B';

  // Append a short fabricated move at the very end: a sharp up/down spike that swings
  // ~20% of the data's value range but spans only ~1–2% of the chart width — so the
  // line clearly ends up or down without overwriting any of the real history.
  if (series.length >= 3) {
    let sMin = Infinity, sMax = -Infinity;
    for (const p of series) { if (p.price < sMin) sMin = p.price; if (p.price > sMax) sMax = p.price; }
    const sRange   = Math.max(lastPrice * 0.5, sMax - sMin); // floor so flat charts still spike
    const MOVE     = sRange * 0.2;
    const endPrice = Math.max(0.01, isPositive ? lastPrice + MOVE : lastPrice - MOVE);
    const tStart   = series[0].t;
    const tEnd     = series[series.length - 1].t;
    const stepT    = (tEnd - tStart) / Math.max(1, series.length - 1);
    const N        = Math.max(2, Math.round(series.length * 0.015)); // ~1.5% of the width
    for (let k = 1; k <= N; k++) {
      const f = k / N;
      series.push({ t: tEnd + stepT * k, price: lastPrice + (endPrice - lastPrice) * f });
    }
  }

  // ── Shared left margin — all rows left-aligned ───────────────────────────
  const LEFT = PAD;

  // ── Row 1: avatar (small) + name (+ industry under name) ─────────────────
  const nameText        = `${displayName}'s Sentiment`;
  const NAME_FONT       = `400 44px "Inter", ${SANS}`;
  const INDUSTRY_FONT   = `400 31px "Inter", ${SANS}`;
  const AVATAR_NAME_GAP = 42;
  const avatarCX = LEFT + AVATAR_R;
  const avatarCY = TOP_PAD + AVATAR_R;
  const nameX    = LEFT + AVATAR_R * 2 + AVATAR_NAME_GAP;
  const industry = (overrideIndustry?.trim() ?? market.industry ?? '').trim();

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, AVATAR_R, 0, Math.PI * 2);
  if (img) {
    ctx.clip();
    drawImageCover(ctx, img, avatarCX, avatarCY, AVATAR_R);
  } else {
    ctx.fillStyle = '#27272a';
    ctx.fill();
    ctx.fillStyle    = '#0CDF9D';
    ctx.font         = `700 ${Math.round(AVATAR_R * 0.65)}px -apple-system, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayName.charAt(0).toUpperCase(), avatarCX, avatarCY);
  }
  ctx.restore();

  ctx.font      = NAME_FONT;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  if (industry) {
    // Stack name + industry, centred as a block on the avatar.
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(nameText, nameX, avatarCY - 8);
    ctx.font      = INDUSTRY_FONT;
    ctx.fillStyle = '#71717a';
    ctx.fillText(industry, nameX, avatarCY + 44);
  } else {
    ctx.textBaseline = 'middle';
    ctx.fillText(nameText, nameX, avatarCY);
  }

  // ── Row 2: price + "points" ───────────────────────────────────────────────
  const isPpt            = cH <= 1100;
  const priceStr         = `${Math.max(0.01, lastPrice).toFixed(2)}`;
  const PRICE_FONT       = `600 56px "JetBrains Mono", "Courier New", monospace`;
  const POINTS_FONT      = `400 44px "Inter", ${SANS}`;
  const CHANGE_FONT      = `500 30px "JetBrains Mono", "Courier New", monospace`;
  const PRICE_POINTS_GAP = 16;
  ctx.font = PRICE_FONT;  const priceW = ctx.measureText(priceStr).width;
  const priceBaseY = avatarCY + AVATAR_R + 104;

  ctx.font         = PRICE_FONT;
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(priceStr, LEFT, priceBaseY);

  ctx.font         = POINTS_FONT;
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  const pointsX = LEFT + priceW + PRICE_POINTS_GAP;
  ctx.fillText('points', pointsX, priceBaseY - 1);

  const pctStr   = `${Math.abs(pct).toFixed(1)}%`;
  const rawStr   = `${isPositive ? '+' : '-'}$${Math.abs(rawChange).toFixed(2)}`;
  const ARROW_W  = 28;
  const ARROW_H  = Math.round(ARROW_W * (18 / 24));
  const ARROW_GAP = 10;

  let changeBaseY: number;

  if (isPpt) {
    // PPT: inline arrow + % + raw after "points" on the same baseline
    ctx.font = POINTS_FONT;
    const pointsW   = ctx.measureText('points').width;
    const inlineGap = 32;
    const arrowLeft = pointsX + pointsW + inlineGap;
    const arrowTopBase = priceBaseY - Math.round(30 * 0.35) - Math.round(ARROW_H / 2) + 3;
    const arrowTop     = isPositive ? arrowTopBase : arrowTopBase - 5;

    ctx.fillStyle = color;
    ctx.beginPath();
    if (isPositive) {
      ctx.moveTo(arrowLeft + ARROW_W * 0.5,   arrowTop);
      ctx.lineTo(arrowLeft + ARROW_W * 0.933, arrowTop + ARROW_H * 0.792);
      ctx.lineTo(arrowLeft + ARROW_W * 0.067, arrowTop + ARROW_H * 0.792);
    } else {
      ctx.moveTo(arrowLeft + ARROW_W * 0.5,   arrowTop + ARROW_H);
      ctx.lineTo(arrowLeft + ARROW_W * 0.067, arrowTop + ARROW_H * 0.208);
      ctx.lineTo(arrowLeft + ARROW_W * 0.933, arrowTop + ARROW_H * 0.208);
    }
    ctx.closePath();
    ctx.fill();

    ctx.font         = CHANGE_FONT;
    ctx.fillStyle    = color;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    const pctX    = arrowLeft + ARROW_W + ARROW_GAP;
    ctx.fillText(pctStr, pctX, priceBaseY);
    const pctTextW = ctx.measureText(pctStr).width;
    ctx.fillText(rawStr, pctX + pctTextW + 24, priceBaseY);

    changeBaseY = priceBaseY;
  } else {
    // Portrait: Row 3 below price row
    changeBaseY = priceBaseY + 72;
    const arrowLeft = LEFT;
    const arrowTopBase = changeBaseY - Math.round(30 * 0.35) - Math.round(ARROW_H / 2) + 3;
    const arrowTop     = isPositive ? arrowTopBase : arrowTopBase - 5;

    ctx.fillStyle = color;
    ctx.beginPath();
    if (isPositive) {
      ctx.moveTo(arrowLeft + ARROW_W * 0.5,   arrowTop);
      ctx.lineTo(arrowLeft + ARROW_W * 0.933, arrowTop + ARROW_H * 0.792);
      ctx.lineTo(arrowLeft + ARROW_W * 0.067, arrowTop + ARROW_H * 0.792);
    } else {
      ctx.moveTo(arrowLeft + ARROW_W * 0.5,   arrowTop + ARROW_H);
      ctx.lineTo(arrowLeft + ARROW_W * 0.067, arrowTop + ARROW_H * 0.208);
      ctx.lineTo(arrowLeft + ARROW_W * 0.933, arrowTop + ARROW_H * 0.208);
    }
    ctx.closePath();
    ctx.fill();

    ctx.font         = CHANGE_FONT;
    ctx.fillStyle    = color;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    const pctX     = arrowLeft + ARROW_W + ARROW_GAP;
    ctx.fillText(pctStr, pctX, changeBaseY);
    const pctTextW = ctx.measureText(pctStr).width;
    ctx.fillText(rawStr, pctX + pctTextW + 24, changeBaseY);
  }

  return { series, color, changeBaseY };
}

// ── drawBottomBar ─────────────────────────────────────────────────────────────

const PERIODS = ['1H', '1D', '7D', '1M', 'ALL'] as const;

function drawBottomBar(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, cW: number, cH: number) {
  const BAR_CY = barCyFor(cH);

  // Time frames (left) — 7D is the highlighted default
  ctx.font         = `400 30px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  let px = PAD;
  for (const p of PERIODS) {
    ctx.fillStyle = p === 'ALL' ? '#ffffff' : '#52525b';
    ctx.fillText(p, px, BAR_CY);
    px += ctx.measureText(p).width + 40;
  }

  // Pauv logo (right) — grayscale + low opacity
  if (logo) {
    const logoH = 40;
    const logoW  = logo.naturalWidth * (logoH / (logo.naturalHeight || 1));
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.filter      = 'grayscale(1)';
    ctx.drawImage(logo, cW - logoW - PAD, BAR_CY - logoH / 2, logoW, logoH);
    ctx.restore();
  }
}

// ── drawChartImageFrame ─────────────────────────────────────────────────────────
// One full Charts Image frame onto any 2D context at size w×h. Paints its own
// background, so callers can drop it straight in as a layer.

export interface ChartFrameOpts {
  market:            ChartsImageMarket;
  overrideName?:     string;
  overrideIndustry?: string;
  direction?:        ChartsImageDirection;
  noiseLevel?:       ChartsImageNoiseLevel;
  avatarImg?:        HTMLImageElement | null;
  pauvLogo?:         HTMLImageElement | null;
  revealT?:          number;  // 0..1 line-draw progress; default 1 (full)
  tipPulseT?:        number;  // 0..1 looping tip pulse phase; default -1 (static)
}

export function drawChartImageFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: ChartFrameOpts,
) {
  ctx.fillStyle = '#0A0A0A';
  ctx.fillRect(0, 0, w, h);

  const mk = opts.market;
  if (!mk) return;

  const { series, color, changeBaseY } = drawHeader(
    ctx, mk, opts.avatarImg ?? null, opts.overrideName ?? '', h,
    opts.overrideIndustry ?? '', opts.direction ?? 'up',
  );

  const CHART_TOP  = changeBaseY + 56;
  const CHART_H_PX = chartBotFor(h) - CHART_TOP;
  if (CHART_H_PX > 60) {
    drawStepChart(
      ctx, series, PAD, CHART_TOP, w - PAD * 2, CHART_H_PX, color, h > 1100 ? 4 : 7,
      tickerSeed(mk.ticker), NOISE_SCALE[opts.noiseLevel ?? 'none'] ?? 0,
      opts.revealT ?? 1, opts.tipPulseT ?? -1,
    );
  }

  drawBottomBar(ctx, opts.pauvLogo ?? null, w, h);
}
