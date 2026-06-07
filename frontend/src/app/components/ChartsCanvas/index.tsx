'use client';

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { CANVAS_W, CANVAS_H, DISPLAY_SCALE, CAPTION_LINE_HEIGHT, HEADER_PADDING_X } from './constants';
import type { ChartsCanvasProps, ChartsCanvasRef, ChartsMarket, SparkPoint } from './types';
import { wrapRichText, drawRichLine } from '@/lib/emoji';

export type { ChartsCanvasRef, ChartsMarket } from './types';

// ── Layout ────────────────────────────────────────────────────────────────────

const CAPTION_FONT_SIZE  = 48;
const CAPTION_LINE_H     = CAPTION_LINE_HEIGHT; // 55
const CLEAN_PAD_TOP      = 44;
const CLEAN_PAD_BOT      = 40;
const CAPTION_BOT_OFF    = 18;

const CAPTION_AREA_H = 320; // fixed height reserved for caption text above the CTA

// Profile section (matches ChartArtistHeader proportions)
const PROFILE_TOP_PAD  = 60;
const AVATAR_R         = 88;   // 176 px diameter
const AVATAR_NAME_GAP  = 48;
const NAME_FONT_SIZE   = 42;
const TICKER_FONT_SIZE = 30;
const PRICE_FONT_SIZE  = 48;
const PCT_FONT_SIZE    = 36;

// Chart animation timing — 25-second single play, no loop
const GROW_MS  = 22000;  // animation grows for 22 s, then holds at final state
const CYCLE_MS = 25000;  // total intended duration (22 s grow + 3 s hold)

// Each synthetic sparkline index treated as 45 days → realistic 18-month span
const POINT_INTERVAL_MS = 45 * 24 * 60 * 60 * 1000;
const MIN_WIN_MS        = 30 * 24 * 60 * 60 * 1000; // 30-day initial window

// Chart geometry
const CHART_PAD_L = 16;
const CHART_PAD_R = 300;  // gap between last data point and right edge
const Y_AXIS_W    = 80;   // right gutter for price labels
const CHART_PAD_T = 12;
const CHART_PAD_B = 52;
const LEAD_R      = 22;   // leading-edge avatar radius

// CTA "pauv.com  to trade" row drawn above the chart
const CTA_LINK_SIZE = 32;
const CTA_AREA_H   = 48;

// Two line colours
const LINE_COLOR_A = '#04df9d'; // Pauv teal/green
const LINE_COLOR_B = '#ef4444'; // red

// ── Helpers ───────────────────────────────────────────────────────────────────

// Mirrors CanvasGrid.generateFallbackSparkline — deterministic per ticker so both
// profiles always have a line and can show % change = (currentPoint − start) / start.
function generateFallbackSparkline(ticker: string): SparkPoint[] {
  let seed = ticker.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x1234) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  const N      = 13 + Math.floor(rand() * 9);
  const wiggle = 0.34 + rand() * 0.18;
  const vals: number[] = [];
  for (let i = 0; i < N; i++) {
    const t     = N === 1 ? 0 : i / (N - 1);
    const taper = Math.sin(Math.PI * t);
    let   j     = (rand() - 0.5) * wiggle;
    if (rand() < 0.22) j += (rand() - 0.5) * wiggle * 1.8;
    vals.push(t + j * taper);
  }
  const lo    = Math.min(...vals);
  const range = Math.max(1e-6, Math.max(...vals) - lo);
  return vals.map((x, i) => ({ value: 0.1 + ((x - lo) / range) * 0.8, timestamp: i }));
}

function niceStep(range: number, target: number): number {
  if (!(range > 0) || !(target > 0)) return 1;
  const raw  = range / target;
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function valueAt(s: { t: number; price: number }[], time: number): number | null {
  if (!s.length) return null;
  if (time <= s[0].t) return s[0].price;
  if (time >= s[s.length - 1].t) return s[s.length - 1].price;
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= time) {
      const a = s[i - 1], b = s[i];
      const f = b.t === a.t ? 0 : (time - a.t) / (b.t - a.t);
      return a.price + (b.price - a.price) * f;
    }
  }
  return s[s.length - 1].price;
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

// ── Caption ───────────────────────────────────────────────────────────────────

function drawCaption(ctx: CanvasRenderingContext2D, caption: string) {
  if (!caption.trim()) return;

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';

  const padX = HEADER_PADDING_X + 43;
  const maxW = CANVAS_W - padX * 2;

  // Shrink font so the full caption wraps to at most 2 lines (floor: 24px)
  let fontSize = CAPTION_FONT_SIZE;
  const countLines = (fs: number) => {
    ctx.font = `400 ${fs}px Inter, -apple-system, sans-serif`;
    return caption.split('\n').reduce((sum, p) =>
      sum + (p.trim() ? wrapRichText(ctx, p, maxW, fs).length : 1), 0);
  };
  let totalLines = countLines(fontSize);
  if (totalLines > 2) {
    fontSize = Math.max(24, Math.floor(fontSize * 2 / totalLines));
    if (countLines(fontSize) > 2) fontSize = Math.max(24, fontSize - 2);
  }

  const lineH = Math.round(fontSize * 1.25);

  ctx.font      = `400 ${fontSize}px Inter, -apple-system, sans-serif`;
  ctx.fillStyle = '#ffffff';

  const groups: (string[] | null)[] = [];
  for (const para of caption.split('\n')) {
    if (!para) { groups.push(null); continue; }
    groups.push(wrapRichText(ctx, para, maxW, fontSize));
  }
  const lineCount = groups.reduce((n, g) => n + (g === null ? 1 : g.length), 0);

  // Anchor to bottom of caption band — text sits just above the CTA
  const lastBaseline  = CAPTION_AREA_H - CAPTION_BOT_OFF;
  const firstBaseline = lastBaseline - (lineCount - 1) * lineH;
  let cy              = Math.max(fontSize + 10, firstBaseline);

  for (let gi = 0; gi < groups.length; gi++) {
    const group       = groups[gi];
    const isLastGroup = gi === groups.length - 1;
    if (group === null) { cy += lineH; continue; }
    for (let wi = 0; wi < group.length; wi++) {
      drawRichLine(ctx, group[wi], CANVAS_W / 2, cy, fontSize);
      if (wi < group.length - 1) cy += lineH;
    }
    if (!isLastGroup) cy += lineH;
  }
  ctx.restore();
}

// ── CTA row: "[pauv logo].com  to trade" — matches Twitter canvas drawLinkInBio ──

function drawCTA(
  ctx: CanvasRenderingContext2D,
  baselineY: number,
  logoRef: { current: HTMLImageElement | null },
) {
  const SIZE    = CTA_LINK_SIZE;
  const dotCom  = '.com';
  const toTrade = 'to trade';
  const gap     = 12;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'left';

  ctx.font = `600 ${SIZE}px Inter, -apple-system, sans-serif`;
  const dotComW = ctx.measureText(dotCom).width;
  ctx.font = `400 ${SIZE}px Inter, -apple-system, sans-serif`;
  const tradeW = ctx.measureText(toTrade).width;

  let logo = logoRef.current;
  if (!logo) {
    logo = new Image();
    logo.crossOrigin = 'anonymous';
    logo.src = '/pauvlogo.png';
    logo.onload = () => { logoRef.current = logo; };
  }

  if (logo?.complete && logo.naturalWidth > 0) {
    const aspect = logo.naturalWidth / logo.naturalHeight;
    const logoW  = Math.round(SIZE * aspect);
    const totalW = logoW + dotComW + gap + tradeW;
    const startX = CANVAS_W / 2 - totalW / 2;
    const logoDrop = Math.round(SIZE * 0.23);
    ctx.drawImage(logo, startX, baselineY - SIZE + logoDrop + 1, logoW, SIZE);
    ctx.font = `600 ${SIZE}px Inter, -apple-system, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(dotCom, startX + logoW, baselineY);
    ctx.font = `400 ${SIZE}px Inter, -apple-system, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(toTrade, startX + logoW + dotComW + gap, baselineY);
  } else {
    const totalW = dotComW + gap + tradeW;
    const startX = CANVAS_W / 2 - totalW / 2;
    ctx.font = `600 ${SIZE}px Inter, -apple-system, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(dotCom, startX, baselineY);
    ctx.font = `400 ${SIZE}px Inter, -apple-system, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(toTrade, startX + dotComW + gap, baselineY);
  }

  ctx.restore();
}

// Draw image centred+cropped to fill a circle (object-fit: cover)
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

// ── CompareChart draw — exact port of the React CompareChart to canvas ────────

interface ChartResult {
  priceA: number | null; pctA: number | null;
  priceB: number | null; pctB: number | null;
}

function drawCompareChart(
  ctx:    CanvasRenderingContext2D,
  sparkA: SparkPoint[] | null | undefined,
  sparkB: SparkPoint[] | null | undefined,
  imgA:   HTMLImageElement | null,
  imgB:   HTMLImageElement | null,
  colorA: string,
  colorB: string,
  cursorT: number,           // 0..1 from animation loop
  rx: number, ry: number, rw: number, rh: number,
): ChartResult {
  // 5-point moving average to kill spikes before rendering
  const smooth = (s: { t: number; price: number }[]) => s.map((p, i) => {
    const lo  = Math.max(0, i - 2);
    const hi  = Math.min(s.length - 1, i + 2);
    const win = s.slice(lo, hi + 1);
    return { t: p.t, price: win.reduce((sum, q) => sum + q.price, 0) / win.length };
  });
  const rawA = sparkToSeries(sparkA);
  const rawB = sparkToSeries(sparkB);
  const sA = smooth(rawA);
  const sB = smooth(rawB);

  // Base for % change: smoothed value at the timestamp of the first raw non-zero point.
  // Using raw to find the timestamp avoids picking up smoothing bleed-in as the base.
  const firstRawNonZeroA = rawA.find(p => p.price > 0);
  const firstRawNonZeroB = rawB.find(p => p.price > 0);
  const firstBaseA = firstRawNonZeroA ? (valueAt(sA, firstRawNonZeroA.t) ?? 0) : 0;
  const firstBaseB = firstRawNonZeroB ? (valueAt(sB, firstRawNonZeroB.t) ?? 0) : 0;

  if (!sA.length && !sB.length) {
    // No data yet — draw a "Press Start" hint in the chart area
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `300 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle    = '#27272a';
    ctx.fillText('Press Start to load Google Trends', rx + rw / 2, ry + rh / 2);
    return { priceA: null, pctA: null, priceB: null, pctB: null };
  }

  // ── Time domain ──────────────────────────────────────────────────────────
  const allStarts: number[] = [];
  const allEnds:   number[] = [];
  if (sA.length) { allStarts.push(sA[0].t); allEnds.push(sA[sA.length - 1].t); }
  if (sB.length) { allStarts.push(sB[0].t); allEnds.push(sB[sB.length - 1].t); }
  const tStart   = Math.min(...allStarts);
  const tEnd     = Math.max(...allEnds);
  const fullSpan = Math.max(tEnd - tStart, 1);
  const minWin   = Math.min(MIN_WIN_MS, fullSpan);
  const cursorTime = tStart + minWin + cursorT * (fullSpan - minWin);
  const winRange   = Math.max(cursorTime - tStart, 1);

  // ── Reveal each series up to cursorTime ──────────────────────────────────
  const reveal = (s: { t: number; price: number }[]) => {
    const out  = s.filter(p => p.t <= cursorTime);
    const lead = valueAt(s, cursorTime);
    if (lead != null && (!out.length || out[out.length - 1].t < cursorTime))
      out.push({ t: cursorTime, price: lead });
    return out;
  };
  const revA = reveal(sA);
  const revB = reveal(sB);

  // ── Y scale from revealed data ───────────────────────────────────────────
  const rPrices = [...revA, ...revB].map(p => p.price);
  const minP    = rPrices.length ? Math.min(...rPrices) : 0;
  const maxP    = rPrices.length ? Math.max(...rPrices) : 1;
  const pRange  = maxP === minP ? 1 : maxP - minP;
  const PAD_Y   = pRange * 0.08;
  const loP     = minP - PAD_Y;
  const vRange  = pRange + 2 * PAD_Y;

  // ── Grid lines from FULL data range ─────────────────────────────────────
  const fullPrices = [...sA, ...sB].map(p => p.price);
  const fullMin    = fullPrices.length ? Math.min(...fullPrices) : 0;
  const fullMax    = fullPrices.length ? Math.max(...fullPrices) : 1;
  const gridStep   = niceStep((fullMax - fullMin) || 1, 6);
  const gridLines: number[] = [];
  if (rPrices.length && gridStep > 0 && vRange > 0) {
    const hiP       = loP + vRange;
    const firstLine = Math.ceil(loP / gridStep) * gridStep;
    for (let p = firstLine, guard = 0; p <= hiP + 1e-6 && guard < 100; p += gridStep, guard++)
      gridLines.push(p);
  }

  // ── Projection helpers ───────────────────────────────────────────────────
  const chartAreaH = rh - CHART_PAD_T - CHART_PAD_B;
  const CHART_W    = rw - Y_AXIS_W;
  const toX = (t: number) =>
    rx + Y_AXIS_W + CHART_PAD_L + ((t - tStart) / winRange) * (CHART_W - CHART_PAD_L - CHART_PAD_R / 2);
  const toY = (price: number) =>
    ry + CHART_PAD_T + (1 - (price - loP) / vRange) * chartAreaH;

  // ── Horizontal gridlines + Y-axis price labels ───────────────────────────
  for (const price of gridLines) {
    const gy = toY(price);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(rx + Y_AXIS_W + CHART_PAD_L, gy);
    ctx.lineTo(rx + rw, gy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `400 22px system-ui, sans-serif`;
    ctx.fillStyle    = '#3f3f46';
    ctx.fillText(price.toFixed(2), rx + Y_AXIS_W / 2, gy);
  }

  // ── Bottom axis (removed) ─────────────────────────────────────────────────
  const bottomY = ry + CHART_PAD_T + chartAreaH;

  // ── X-axis year labels ───────────────────────────────────────────────────────
  const MIN_LABEL_GAP = 72;
  const y0 = new Date(tStart).getFullYear();
  const y1 = new Date(cursorTime).getFullYear();
  ctx.font         = `400 22px system-ui, sans-serif`;
  ctx.fillStyle    = '#3f3f46';
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'center';

  const chartRight = CHART_W - CHART_PAD_L - CHART_PAD_R / 2;
  const leftBound  = rx + Y_AXIS_W + CHART_PAD_L;
  const FADE_ZONE  = 48;

  // Smooth mapping: centre of each year's visible span scaled by winRange.
  // Start from y0+1 so the thinned sequence naturally ends on y1 (2026).
  const yearCandidates: { y: number; lx: number }[] = [];
  for (let y = y0 + 1; y <= y1; y++) {
    const spanStart = Math.max(new Date(y, 0, 1).getTime(), tStart);
    const spanEnd   = Math.min(new Date(y + 1, 0, 1).getTime(), cursorTime);
    const center    = (spanStart + spanEnd) / 2;
    const lx        = rx + Y_AXIS_W + CHART_PAD_L + ((center - tStart) / winRange) * chartRight;
    yearCandidates.push({ y, lx });
  }

  let step = 1;
  if (yearCandidates.length > 1) {
    const span      = yearCandidates[yearCandidates.length - 1].lx - yearCandidates[0].lx;
    const maxLabels = Math.max(1, Math.floor(span / MIN_LABEL_GAP));
    step            = Math.ceil(yearCandidates.length / maxLabels);
  }

  for (let i = 0; i < yearCandidates.length; i += step) {
    const { y, lx } = yearCandidates[i];

    let alpha = 1;

    // Fade in the newest year as cursorTime progresses through it
    if (y === y1) {
      const yStart = new Date(y, 0, 1).getTime();
      const yEnd   = new Date(y + 1, 0, 1).getTime();
      alpha = Math.min(1, ((cursorTime - yStart) / (yEnd - yStart)) * 3);
    }

    // Fade out any label whose x position reaches the Y-axis
    const distFromLeft = lx - leftBound;
    if (distFromLeft < FADE_ZONE) {
      alpha = Math.min(alpha, Math.max(0, distFromLeft / FADE_ZONE));
    }

    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    ctx.fillText(String(y), lx, bottomY + 8);
    ctx.globalAlpha = 1;
  }

  // ── Animated head date label — centered below chart ─────────────────────
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const headDate  = new Date(cursorTime);
  const headLabel = `${MONTHS[headDate.getMonth()]} ${headDate.getFullYear()}`;
  ctx.font         = `600 48px Inter, -apple-system, sans-serif`;
  ctx.fillStyle    = 'rgba(255,255,255,0.75)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(headLabel, CANVAS_W / 2, bottomY + 80);

  // ── Draw each revealed line ───────────────────────────────────────────────
  const drawLine = (rev: { t: number; price: number }[], color: string) => {
    if (rev.length < 2) return;
    const pts = rev.map(p => ({ x: toX(p.t), y: toY(p.price) }));
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 5;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  };
  if (revA.length >= 2) drawLine(revA, colorA);
  if (revB.length >= 2) drawLine(revB, colorB);

  // ── Leading-edge avatar circles ──────────────────────────────────────────
  const drawLead = (
    rev:        { t: number; price: number }[],
    color:      string,
    img:        HTMLImageElement | null,
    firstPrice: number,
  ): { price: number; firstPrice: number } | null => {
    if (rev.length < 2) return null;
    const lead = rev[rev.length - 1];
    const lx   = toX(lead.t);
    const ly   = toY(lead.price);
    const cx   = lx + LEAD_R;
    const cy   = ly;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, LEAD_R, 0, Math.PI * 2);
    if (img) {
      ctx.clip();
      drawImageCover(ctx, img, cx, cy, LEAD_R);
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = color;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, LEAD_R, 0, Math.PI * 2);
    ctx.stroke();

    // Price label above circle
    ctx.font         = `700 20px "JetBrains Mono", "Courier New", monospace`;
    ctx.fillStyle    = color;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`$${Math.max(0.01, lead.price).toFixed(2)}`, cx, cy - LEAD_R - 6);

    return { price: lead.price, firstPrice };
  };

  const resA = drawLead(revA, colorA, imgA, firstBaseA);
  const resB = drawLead(revB, colorB, imgB, firstBaseB);

  return {
    priceA: resA?.price ?? null,
    pctA:   resA
      ? Math.max(0, resA.firstPrice > 0 ? ((resA.price - resA.firstPrice) / resA.firstPrice) * 100 : 0)
      : null,
    priceB: resB?.price ?? null,
    pctB:   resB
      ? Math.max(0, resB.firstPrice > 0 ? ((resB.price - resB.firstPrice) / resB.firstPrice) * 100 : 0)
      : null,
  };
}

// ── Profile section ───────────────────────────────────────────────────────────

function drawProfiles(
  ctx:           CanvasRenderingContext2D,
  markets:       [ChartsMarket | null, ChartsMarket | null],
  imgs:          [HTMLImageElement | null, HTMLImageElement | null],
  dividerY:      number,
  cursorT:       number,
  logoRef:       { current: HTMLImageElement | null },
  overrideNames: [string, string],
) {
  const colW       = CANVAS_W / 2;
  const avatarCy   = dividerY + PROFILE_TOP_PAD + AVATAR_R;
  const nameBaseY  = avatarCy + AVATAR_R + AVATAR_NAME_GAP;
  const priceBaseY = nameBaseY + NAME_FONT_SIZE + 36;

  // Total header height (used to position the chart below)
  const headersH = PROFILE_TOP_PAD
    + AVATAR_R * 2
    + AVATAR_NAME_GAP
    + NAME_FONT_SIZE + 18
    + PRICE_FONT_SIZE + 16   // price row
    + PCT_FONT_SIZE  + 16    // pct row
    + CTA_AREA_H;            // "pauv.com to trade" row + gap to chart

  const LINE_COLORS: [string, string] = [LINE_COLOR_A, LINE_COLOR_B];

  // ── Draw chart first (behind avatars if they overlap) ────────────────────
  const CHART_X  = 72;
  const chartY   = dividerY + headersH;
  const chartW   = CANVAS_W - CHART_X - 72;
  const chartH   = CANVAS_H - chartY - 280;

  const sparkA = markets[0]?.sparkline;
  const sparkB = markets[1]?.sparkline;

  let chartResult: ChartResult = { priceA: null, pctA: null, priceB: null, pctB: null };
  if (chartH > 40) {
    chartResult = drawCompareChart(
      ctx,
      sparkA,
      sparkB,
      imgs[0], imgs[1],
      LINE_COLOR_A, LINE_COLOR_B,
      cursorT,
      CHART_X, chartY, chartW, chartH,
    );
  }

  // ── Two profile headers side-by-side ─────────────────────────────────────
  const prices = [chartResult.priceA, chartResult.priceB];
  const pcts   = [chartResult.pctA,   chartResult.pctB];

  for (let i = 0; i < 2; i++) {
    const market = markets[i];
    const img    = imgs[i];
    const cx     = colW * i + colW / 2;
    const color  = LINE_COLORS[i];
    const price  = prices[i];
    const pct    = pcts[i];

    // Circular avatar — cover crop (preserves aspect ratio)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, avatarCy, AVATAR_R, 0, Math.PI * 2);
    if (img) {
      ctx.clip();
      drawImageCover(ctx, img, cx, avatarCy, AVATAR_R);
    } else {
      ctx.fillStyle = '#1c1c1c';
      ctx.fill();
      if (market) {
        ctx.fillStyle    = color;
        ctx.font         = `700 ${Math.round(AVATAR_R * 0.65)}px -apple-system, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        const displayName = overrideNames[i] || market.name;
        ctx.fillText(displayName.charAt(0).toUpperCase(), cx, avatarCy);
      }
    }
    ctx.restore();

    // Coloured ring
    ctx.strokeStyle = color;
    ctx.lineWidth   = 4;
    ctx.beginPath();
    ctx.arc(cx, avatarCy, AVATAR_R + 3, 0, Math.PI * 2);
    ctx.stroke();

    if (!market) continue;

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';

    // Name + " NPSI" — same font, white, rendered as one string
    ctx.font      = `300 ${NAME_FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#ffffff';
    const maxW    = colW - 64;
    const rawName = (overrideNames[i] || market.name) + ' NPSI';
    let   displayName = rawName;
    while (displayName.length > 1 && ctx.measureText(displayName).width > maxW) displayName = displayName.slice(0, -1);
    if (displayName !== rawName) displayName += '…';
    ctx.fillText(displayName, cx, nameBaseY);

    // ── Animated price + pts + % change — all on one row ────────────────
    if (price != null) {
      const priceStr  = Math.max(0.01, price).toFixed(2);
      const ptsFontSz = 32;
      const pctFontSz = Math.round(PCT_FONT_SIZE * 0.65);
      const gap       = 14;
      const triW      = 18;
      const triH      = 14;

      // Pre-measure all segments
      ctx.font = `600 ${PRICE_FONT_SIZE}px "JetBrains Mono", "Courier New", monospace`;
      const priceW = ctx.measureText(priceStr).width;
      ctx.font = `400 ${ptsFontSz}px Inter, -apple-system, sans-serif`;
      const ptsW = ctx.measureText('pts').width;

      const hasPct   = pct != null;
      const isUp     = (pct ?? 0) >= 0;
      const pctStr   = hasPct ? (Math.abs(pct!).toFixed(2) + '%') : '';
      const pctColor = isUp ? '#04df9d' : '#ef4444';
      let pctW = 0;
      if (hasPct) {
        ctx.font = `600 ${pctFontSz}px "JetBrains Mono", "Courier New", monospace`;
        pctW = ctx.measureText(pctStr).width;
      }

      const pctSection = hasPct ? gap + triW + 8 + pctW : 0;
      const totalW     = priceW + gap + ptsW + pctSection;
      let   x          = cx - totalW / 2;

      ctx.textBaseline = 'top';
      ctx.textAlign    = 'left';

      // Price
      ctx.font      = `600 ${PRICE_FONT_SIZE}px "JetBrains Mono", "Courier New", monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(priceStr, x, priceBaseY);
      x += priceW + gap;

      // pts
      ctx.font      = `400 ${ptsFontSz}px Inter, -apple-system, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('pts', x, priceBaseY + (PRICE_FONT_SIZE - ptsFontSz) / 2);
      x += ptsW + gap;

      // Triangle + % change
      if (hasPct) {
        const triTop = priceBaseY + (PRICE_FONT_SIZE - triH) / 2 - 1;
        ctx.fillStyle = pctColor;
        ctx.beginPath();
        if (isUp) {
          ctx.moveTo(x + triW / 2, triTop);
          ctx.lineTo(x + triW,     triTop + triH);
          ctx.lineTo(x,            triTop + triH);
        } else {
          ctx.moveTo(x,            triTop);
          ctx.lineTo(x + triW,     triTop);
          ctx.lineTo(x + triW / 2, triTop + triH);
        }
        ctx.closePath();
        ctx.fill();
        x += triW + 8;

        ctx.font      = `600 ${pctFontSz}px "JetBrains Mono", "Courier New", monospace`;
        ctx.fillStyle = pctColor;
        ctx.fillText(pctStr, x, priceBaseY + (PRICE_FONT_SIZE - pctFontSz) / 2);
      }

      ctx.textAlign = 'center';
    }
  }

  // ── "Vs" label between the two avatar circles ──────────────────────────────
  const VS_SIZE = 52;
  ctx.font         = `600 ${VS_SIZE}px Inter, -apple-system, sans-serif`;
  ctx.fillStyle    = 'rgba(255,255,255,0.55)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Vs', CANVAS_W / 2, avatarCy);

  // ── "pauv.com  to trade" CTA — just above the chart ─────────────────────────
  const ctaBaselineY = chartY - CTA_AREA_H + Math.round(CTA_AREA_H * 0.72);
  drawCTA(ctx, ctaBaselineY, logoRef);
}

// ── Component ─────────────────────────────────────────────────────────────────

const PHONEDECK_URL = typeof process !== 'undefined'
  ? (process.env.NEXT_PUBLIC_PHONEDECK_URL ?? 'http://localhost:8080')
  : 'http://localhost:8080';

function safeExportName(raw: string) {
  return raw.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70).replace(/[. ]+$/g, '').trim() || 'charts';
}

export const ChartsCanvas = forwardRef<ChartsCanvasRef, ChartsCanvasProps>(function ChartsCanvas(
  { overlayCaption = '', markets, overrideNames = ['', ''], onRecordingStateChange, audioUrl, audioDurationMs },
  ref,
) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const rafRef        = useRef(0);
  const img0Ref       = useRef<HTMLImageElement | null>(null);
  const img1Ref       = useRef<HTMLImageElement | null>(null);
  const pauvLogoRef   = useRef<HTMLImageElement | null>(null);
  const animStartRef  = useRef(0); // set on first RAF tick

  const isRecordingRef  = useRef(false);
  const onRecStateRef   = useRef(onRecordingStateChange);
  useEffect(() => { onRecStateRef.current = onRecordingStateChange; }, [onRecordingStateChange]);

  const captionRef       = useRef(overlayCaption);
  const marketsRef       = useRef(markets);
  const overrideNamesRef = useRef(overrideNames);
  useEffect(() => { captionRef.current       = overlayCaption;  }, [overlayCaption]);
  useEffect(() => { marketsRef.current       = markets;         }, [markets]);
  useEffect(() => { overrideNamesRef.current = overrideNames;   }, [overrideNames]);

  // Dynamic timing driven by audio duration
  const growMsRef  = useRef(GROW_MS);
  const cycleMsRef = useRef(CYCLE_MS);
  const audioUrlRef = useRef<string | null>(null);
  useEffect(() => {
    audioUrlRef.current = audioUrl ?? null;
    if (audioDurationMs && audioDurationMs > 4000) {
      growMsRef.current  = audioDurationMs - 3000;
      cycleMsRef.current = audioDurationMs;
    } else {
      growMsRef.current  = GROW_MS;
      cycleMsRef.current = CYCLE_MS;
    }
  }, [audioUrl, audioDurationMs]);

  // Reset animation when market IDs change
  useEffect(() => {
    animStartRef.current = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets[0]?.id, markets[1]?.id]);

  // Reset animation when fresh sparkline data arrives (so it plays from t=0)
  useEffect(() => {
    animStartRef.current = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets[0]?.sparkline?.length, markets[1]?.sparkline?.length]);

  useEffect(() => {
    const url = markets[0]?.photo_url;
    if (!url) { img0Ref.current = null; return; }
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { img0Ref.current = img; };
    img.onerror = () => { img0Ref.current = null; };
    img.src = url;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets[0]?.photo_url]);

  useEffect(() => {
    const url = markets[1]?.photo_url;
    if (!url) { img1Ref.current = null; return; }
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { img1Ref.current = img; };
    img.onerror = () => { img1Ref.current = null; };
    img.src = url;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets[1]?.photo_url]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
    const ctx    = canvas.getContext('2d');
    if (!ctx)    { rafRef.current = requestAnimationFrame(draw); return; }

    const now = performance.now();
    const mksNow = marketsRef.current;
    const selectedCount = [mksNow[0], mksNow[1]].filter(Boolean).length;
    const loadedCount   = [mksNow[0], mksNow[1]].filter(m => (m?.sparkline?.length ?? 0) > 0).length;
    const allLoaded     = selectedCount > 0 && loadedCount >= selectedCount;

    // Only start the clock once all selected markets have sparkline data
    if (allLoaded && animStartRef.current === 0) animStartRef.current = now;

    // Clamp at 1 — no loop; animation grows then holds at final state
    const cursorT = animStartRef.current === 0
      ? 0
      : Math.min((now - animStartRef.current) / growMsRef.current, 1);

    const caption  = captionRef.current;
    const mks      = marketsRef.current;
    const imgs: [HTMLImageElement | null, HTMLImageElement | null] = [img0Ref.current, img1Ref.current];

    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawProfiles(ctx, mks, imgs, CAPTION_AREA_H, cursorT, pauvLogoRef, overrideNamesRef.current);
    drawCaption(ctx, caption);

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);


  useImperativeHandle(ref, () => ({
    startDownload: async () => {
      const canvas = canvasRef.current;
      if (!canvas || isRecordingRef.current) return;

      const mks = marketsRef.current;
      const loadedCount = mks.filter(m => (m?.sparkline?.length ?? 0) > 0).length;
      const selectedCount = mks.filter(Boolean).length;
      if (selectedCount === 0 || loadedCount < selectedCount) return;

      isRecordingRef.current = true;
      const notify = (isRecording: boolean, recProgress: number, recStatus: string) =>
        onRecStateRef.current?.({ isRecording, recProgress, recStatus });

      notify(true, 0, 'Starting…');

      try {
        // Reset so the animation plays from the beginning of the recording
        animStartRef.current = 0;

        // Give the RAF one tick to restart the clock
        await new Promise<void>(r => setTimeout(r, 80));

        const mimeType =
          typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
            ? 'video/mp4;codecs=avc1'
            : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4')
              ? 'video/mp4'
              : 'video/webm;codecs=vp9';

        const stream = canvas.captureStream(30);

        // Mix in audio track if one is selected
        let audioEl: HTMLAudioElement | null = null;
        let audioCtx: AudioContext | null = null;
        if (audioUrlRef.current) {
          try {
            audioEl = new Audio();
            audioEl.src = audioUrlRef.current;
            audioEl.crossOrigin = 'anonymous';
            audioEl.preload = 'auto';
            audioCtx = new AudioContext();
            const src  = audioCtx.createMediaElementSource(audioEl);
            const dest = audioCtx.createMediaStreamDestination();
            src.connect(dest);
            dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
            // Wait until audio has enough data
            await new Promise<void>(res => {
              if (!audioEl || audioEl.readyState >= 3) { res(); return; }
              audioEl.oncanplay = () => res();
              setTimeout(res, 6000);
            });
          } catch {
            audioEl = null;
            audioCtx = null;
          }
        }

        const cycleMs  = cycleMsRef.current;
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
        const chunks: Blob[] = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.start(200);

        // Start audio in sync with animation
        if (audioEl && audioCtx) {
          audioEl.currentTime = 0;
          await audioCtx.resume();
          audioEl.play().catch(() => {});
        }

        notify(true, 0.01, 'Recording…');

        // Wait cycleMs, reporting progress each frame
        const startMs = performance.now();
        await new Promise<void>(resolve => {
          const tick = () => {
            const p = Math.min((performance.now() - startMs) / cycleMs, 1);
            notify(true, p, 'Recording…');
            if (p >= 1) resolve(); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

        audioEl?.pause();
        audioCtx?.close().catch(() => {});

        recorder.stop();
        await new Promise<void>(r => { recorder.onstop = () => r(); });

        notify(true, 0.98, 'Saving…');

        const blob = new Blob(chunks, { type: mimeType });
        const filename = `${safeExportName(captionRef.current || 'charts')}.mp4`;

        try {
          const form = new FormData();
          form.append('files', blob, filename);
          const resp = await fetch(`${PHONEDECK_URL}/api/upload`, { method: 'POST', body: form });
          if (!resp.ok) throw new Error(await resp.text());
          notify(true, 1, `In Phonedeck: ${filename}`);
          setTimeout(() => notify(false, 0, ''), 5000);
        } catch {
          const url = URL.createObjectURL(blob);
          Object.assign(document.createElement('a'), { href: url, download: filename }).click();
          URL.revokeObjectURL(url);
          notify(true, 1, 'Saved to Downloads');
          setTimeout(() => notify(false, 0, ''), 4000);
        }
      } catch (err) {
        notify(true, 0, `Error: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => notify(false, 0, ''), 5000);
      } finally {
        isRecordingRef.current = false;
      }
    },
    cancelExport: () => {
      isRecordingRef.current = false;
      onRecStateRef.current?.({ isRecording: false, recProgress: 0, recStatus: '' });
    },
    setBlockTopPct: () => {},
    play:            () => {},
    pause:           () => {},
    seekTo:          () => {},
    setTrimRange:    () => {},
    resetTrim:       () => {},
    zoomIn:          () => {},
    zoomOut:         () => {},
    resetZoom:       () => {},
    setZoom:         () => {},
    resetBox:        () => {},
    centerBox:       () => {},
    setIncludeEdit:  () => {},
    getVideoElement: () => null,
    getTrimState: () => ({
      trimStart: 0, trimEnd: 0, duration: 0,
      includeEdit: false, videoScale: 1,
      blockTopPct: CAPTION_AREA_H / CANVAS_H,
    }),
  }), []);

  return (
    <div
      className="relative select-none"
      style={{
        width:    CANVAS_W * DISPLAY_SCALE,
        height:   CANVAS_H * DISPLAY_SCALE,
        overflow: 'visible',
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="block border border-zinc-700 shadow-[0_0_48px_rgba(254,44,85,0.1)]"
        style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE }}
      />
    </div>
  );
});
