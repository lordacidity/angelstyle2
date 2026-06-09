'use client';

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { CANVAS_W, CANVAS_H, DISPLAY_SCALE } from './constants';
import type { ChartsImageCanvasProps, ChartsImageCanvasRef, ChartsImageMarket, SparkPoint } from './types';

export type { ChartsImageCanvasRef, ChartsImageMarket } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAD      = 80; // uniform content padding on all four sides
const TOP_PAD  = PAD + 20;
const AVATAR_R = 52; // small inline avatar (≈h-9 at 0.38 display scale)

// Each synthetic sparkline index treated as 45 days → realistic 18-month span
const POINT_INTERVAL_MS = 45 * 24 * 60 * 60 * 1000;

// ── Helpers copied verbatim from ChartsCanvas/index.tsx ───────────────────────

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

// Deterministic, believable change% in [5, 15] seeded by ticker. Must be stable
// across redraws (the canvas repaints every animation frame) — no Math.random().
function seededChangePct(ticker: string): number {
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
  ctx:    CanvasRenderingContext2D,
  series: { t: number; price: number }[],
  rx: number, ry: number, rw: number, rh: number,
  color:  string,
) {
  if (series.length < 2) return;

  const tenYearsAgo = series[series.length - 1].t - 5 * 365.25 * 24 * 60 * 60 * 1000;
  const trimmed = series.filter(p => p.t >= tenYearsAgo);
  const src = trimmed.length >= 2 ? trimmed : series;

  const MA = 2;
  const s = src.map((p, i) => {
    const slice = src.slice(Math.max(0, i - MA + 1), i + 1);
    const avg = slice.reduce((a, v) => a + v.price, 0) / slice.length;
    return { t: p.t, price: avg };
  });

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

  // Right gutter for Y-axis labels
  const RIGHT_GUTTER = 120;

  const toX = (t: number) =>
    rx + ((t - tStart) / tRange) * (rw - RIGHT_GUTTER);

  const toY = (price: number) =>
    ry + V_PAD_T + (1 - (price - minPrice) / priceRange) * chartAreaH;

  // ── Grid lines at fractions 0, 0.25, 0.5, 0.75 of rh ────────────────────
  ctx.save();
  for (const frac of [0, 0.25, 0.5, 0.75]) {
    const gy = ry + frac * rh;

    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.moveTo(rx, gy);
    ctx.lineTo(rx + rw - RIGHT_GUTTER, gy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Y-axis price label
    const labelPrice = minPrice + (1 - (gy - ry - V_PAD_T) / chartAreaH) * priceRange;
    if (labelPrice > 0) {
      ctx.font         = `400 20px "JetBrains Mono", "Courier New", monospace`;
      ctx.fillStyle    = '#52525b';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`$${labelPrice.toFixed(2)}`, rx + rw - 4, gy);
    }
  }

  // ── Step-line path ────────────────────────────────────────────────────────
  const pts = s.map(p => ({ x: toX(p.t), y: toY(p.price) }));

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

  // ── Dot at last point ─────────────────────────────────────────────────────
  const last = pts[pts.length - 1];

  // Outer glow ring (mid-pulse state of the mobile pulsating dot)
  ctx.beginPath();
  ctx.arc(last.x, last.y, 32, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Inner solid dot
  ctx.beginPath();
  ctx.arc(last.x, last.y, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // ── X-axis time labels (5 evenly spaced) ─────────────────────────────────
  ctx.font         = `400 22px system-ui, sans-serif`;
  ctx.fillStyle    = '#52525b';
  ctx.textBaseline = 'alphabetic';
  const labelY = ry + rh - 24;

  const seenYears = new Set<number>();
  let lastLabelX = -Infinity;
  const minGap = 80;
  for (let i = 0; i < s.length; i++) {
    const year = new Date(s[i].t).getFullYear();
    if (seenYears.has(year)) continue;
    seenYears.add(year); // claim the year before the gap check so no later point re-draws it
    const lx = toX(s[i].t);
    if (lx - lastLabelX < minGap) continue;
    ctx.textAlign = i === 0 ? 'left' : i === s.length - 1 ? 'right' : 'center';
    ctx.fillText(String(year), lx, labelY);
    lastLabelX = lx;
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
  ctx:         CanvasRenderingContext2D,
  market:      ChartsImageMarket,
  img:         HTMLImageElement | null,
  overrideName: string,
): HeaderResult {
  const displayName = overrideName || market.name;
  const SANS        = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // ── Sparkline shape (Google Trends or synthetic fallback) ─────────────────
  const rawSeries = sparkToSeries(
    market.sparkline?.length ? market.sparkline : generateFallbackSparkline(market.ticker),
  );
  const lastSpark = rawSeries[rawSeries.length - 1]?.price ?? 0;

  // 5-year cut (matches drawStepChart) used only to read the trend direction
  const cutStartT  = (rawSeries[rawSeries.length - 1]?.t ?? 0) - 5 * 365.25 * 24 * 60 * 60 * 1000;
  const cutSeries  = rawSeries.filter(p => p.t >= cutStartT);
  const baseSeries = cutSeries.length >= 2 ? cutSeries : rawSeries;
  const firstSpark = baseSeries[0]?.price ?? 0;

  // Headline price = the talent's real NPSI/sentiment price (falls back to the
  // last sparkline value only when no price is available).
  const realPrice    = market.price?.usd ?? null;
  const lastPrice    = realPrice != null && realPrice > 0 ? realPrice : Math.max(0.01, lastSpark);

  // Scale the sparkline so its final point equals the headline price, keeping the
  // chart's Y-axis labels in the same range as the displayed price.
  const scale  = lastSpark > 0 ? lastPrice / lastSpark : 1;
  const series = rawSeries.map(p => ({ t: p.t, price: p.price * scale }));

  // Believable change: magnitude clamped to a 5–15% range (deterministic per
  // person), sign following the chart's visual direction.
  const isPositive = lastSpark >= firstSpark;
  const pct        = seededChangePct(market.ticker);
  const signedPct  = isPositive ? pct : -pct;
  const startPrice = lastPrice / (1 + signedPct / 100);
  const rawChange  = lastPrice - startPrice;
  const color      = isPositive ? '#04df9d' : '#FF4B4B';

  // ── Shared left margin — all rows left-aligned ───────────────────────────
  const LEFT = PAD;

  // ── Row 1: avatar (small) + name (+ industry under name) ─────────────────
  const nameText        = `${displayName}'s Sentiment`;
  const NAME_FONT       = `400 44px "Inter", ${SANS}`;
  const INDUSTRY_FONT   = `400 26px "Inter", ${SANS}`;
  const AVATAR_NAME_GAP = 28;
  const avatarCX = LEFT + AVATAR_R;
  const avatarCY = TOP_PAD + AVATAR_R;
  const nameX    = LEFT + AVATAR_R * 2 + AVATAR_NAME_GAP;
  const industry = (market.industry ?? '').trim();

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, AVATAR_R, 0, Math.PI * 2);
  if (img) {
    ctx.clip();
    drawImageCover(ctx, img, avatarCX, avatarCY, AVATAR_R);
  } else {
    ctx.fillStyle = '#27272a';
    ctx.fill();
    ctx.fillStyle    = '#04df9d';
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
    ctx.fillText(nameText, nameX, avatarCY - 4);
    ctx.font      = INDUSTRY_FONT;
    ctx.fillStyle = '#71717a';
    ctx.fillText(industry, nameX, avatarCY + 32);
  } else {
    ctx.textBaseline = 'middle';
    ctx.fillText(nameText, nameX, avatarCY);
  }

  // ── Row 2: price + "points" ───────────────────────────────────────────────
  const priceStr         = `${Math.max(0.01, lastPrice).toFixed(2)}`;
  const PRICE_FONT       = `600 56px "JetBrains Mono", "Courier New", monospace`;
  const POINTS_FONT      = `400 44px "Inter", ${SANS}`;
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
  ctx.fillText('points', LEFT + priceW + PRICE_POINTS_GAP, priceBaseY - 1);

  // ── Row 3: arrow + signed % ───────────────────────────────────────────────
  const changeBaseY = priceBaseY + 72;
  const CHANGE_FONT = `500 30px "JetBrains Mono", "Courier New", monospace`;
  const pctStr      = `${isPositive ? '+' : '-'}${Math.abs(pct).toFixed(1)}%`;
  const ARROW_W     = 28;
  const ARROW_H     = Math.round(ARROW_W * (18 / 24));
  const ARROW_GAP   = 10;
  const arrowLeft   = LEFT;
  const arrowTop  = changeBaseY - Math.round(30 * 0.35) - Math.round(ARROW_H / 2) + 3;

  ctx.fillStyle = color;
  ctx.beginPath();
  if (isPositive) {
    ctx.moveTo(arrowLeft + ARROW_W * 0.5,    arrowTop);
    ctx.lineTo(arrowLeft + ARROW_W * 0.933,  arrowTop + ARROW_H * 0.792);
    ctx.lineTo(arrowLeft + ARROW_W * 0.067,  arrowTop + ARROW_H * 0.792);
  } else {
    ctx.moveTo(arrowLeft + ARROW_W * 0.5,    arrowTop + ARROW_H);
    ctx.lineTo(arrowLeft + ARROW_W * 0.067,  arrowTop + ARROW_H * 0.208);
    ctx.lineTo(arrowLeft + ARROW_W * 0.933,  arrowTop + ARROW_H * 0.208);
  }
  ctx.closePath();
  ctx.fill();

  ctx.font         = CHANGE_FONT;
  ctx.fillStyle    = color;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  const pctX = arrowLeft + ARROW_W + ARROW_GAP;
  ctx.fillText(pctStr, pctX, changeBaseY);

  // Raw change next to % (matches profile header's raw dollar change)
  const rawStr  = `${isPositive ? '+' : ''}${rawChange.toFixed(2)}`;
  const pctTextW = ctx.measureText(pctStr).width;
  ctx.fillStyle = color;
  ctx.fillText(rawStr, pctX + pctTextW + 24, changeBaseY);

  return { series, color, changeBaseY };
}

// ── drawBottomBar ─────────────────────────────────────────────────────────────

const PERIODS = ['1H', '1D', '7D', '1M', 'ALL'] as const;

function drawBottomBar(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null) {
  const BAR_CY = CANVAS_H - 160;

  // Time frames (left) — 7D is the highlighted default
  ctx.font         = `400 30px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  let px = PAD;
  for (const p of PERIODS) {
    ctx.fillStyle = p === '7D' ? '#ffffff' : '#52525b';
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
    ctx.drawImage(logo, CANVAS_W - logoW - PAD, BAR_CY - logoH / 2, logoW, logoH);
    ctx.restore();
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ChartsImageCanvas = forwardRef<ChartsImageCanvasRef, ChartsImageCanvasProps>(
  function ChartsImageCanvas({ market, overrideName = '' }, ref) {
    const canvasRef       = useRef<HTMLCanvasElement>(null);
    const rafRef          = useRef(0);
    const imgRef          = useRef<HTMLImageElement | null>(null);
    const pauvLogoRef     = useRef<HTMLImageElement | null>(null);
    const marketRef       = useRef(market);
    const overrideNameRef = useRef(overrideName);

    useEffect(() => { marketRef.current       = market;       }, [market]);
    useEffect(() => { overrideNameRef.current = overrideName; }, [overrideName]);

    // ── Load pauv logo ──────────────────────────────────────────────────────
    useEffect(() => {
      const img   = new Image();
      img.onload  = () => { pauvLogoRef.current = img; };
      img.onerror = () => { pauvLogoRef.current = null; };
      img.src = '/pauvlogo.png';
    }, []);

    // ── Load avatar image via proxy ─────────────────────────────────────────
    useEffect(() => {
      const url = market?.photo_url;
      if (!url) { imgRef.current = null; return; }
      const img        = new Image();
      img.crossOrigin  = 'anonymous';
      img.onload  = () => { imgRef.current = img; };
      img.onerror = () => { imgRef.current = null; };
      img.src = `/api/charts/image-proxy?url=${encodeURIComponent(url)}`;
    }, [market?.photo_url]);

    // ── Draw loop ───────────────────────────────────────────────────────────
    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx)  { rafRef.current = requestAnimationFrame(draw); return; }

      const mk = marketRef.current;

      ctx.fillStyle = '#0A0A0A';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      if (!mk) {
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.font         = `300 28px -apple-system, sans-serif`;
        ctx.fillStyle    = '#27272a';
        ctx.fillText('Select a market to get started', CANVAS_W / 2, CANVAS_H / 2);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const { series, color, changeBaseY } = drawHeader(
        ctx, mk, imgRef.current, overrideNameRef.current,
      );

      const CHART_TOP  = changeBaseY + 56;
      const CHART_BOT  = CANVAS_H - 230;
      const CHART_H_PX = CHART_BOT - CHART_TOP;
      const CHART_L    = PAD;
      const CHART_W    = CANVAS_W - PAD * 2;

      if (CHART_H_PX > 60) {
        drawStepChart(ctx, series, CHART_L, CHART_TOP, CHART_W, CHART_H_PX, color);
      }

      drawBottomBar(ctx, pauvLogoRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }, []);

    useEffect(() => {
      let cancelled = false;
      Promise.all([
        document.fonts.load('600 48px "JetBrains Mono"'),
        document.fonts.load('500 22px "JetBrains Mono"'),
        document.fonts.load('400 36px "Inter"'),
        document.fonts.load('500 28px "Inter"'),
      ]).then(() => {
        if (!cancelled) rafRef.current = requestAnimationFrame(draw);
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(rafRef.current);
      };
    }, [draw]);

    // ── PNG export ──────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      exportPng: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx)  return;

        const mk = marketRef.current;

        ctx.fillStyle = '#0A0A0A';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        if (mk) {
          const { series, color, changeBaseY } = drawHeader(
            ctx, mk, imgRef.current, overrideNameRef.current,
          );
          const CHART_TOP  = changeBaseY + 56;
          const CHART_H_PX = (CANVAS_H - 230) - CHART_TOP;
          if (CHART_H_PX > 60) {
            drawStepChart(ctx, series, PAD, CHART_TOP, CANVAS_W - PAD * 2, CHART_H_PX, color);
          }
          drawBottomBar(ctx, pauvLogoRef.current);
        }

        canvas.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href     = url;
          a.download = `${mk?.name ?? 'chart'}-sentiment.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }, 'image/png');
      },
    }), []);

    return (
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{
          width:   CANVAS_W * DISPLAY_SCALE,
          height:  CANVAS_H * DISPLAY_SCALE,
          display: 'block',
        }}
      />
    );
  },
);
