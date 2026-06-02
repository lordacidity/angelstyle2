import type { MutableRefObject } from 'react';
import type { SparkPoint } from '../types';

// ── Colors exactly as in pauv-the-app (globals.css + MobileTradeList.tsx) ───────
const COLOR_WHITE           = '#ffffff';
const COLOR_SECONDARY       = '#71717a'; // artist.industry subtitle (hardcoded in ArtistRow)
const COLOR_POSITIVE        = '#04df9d'; // --st-positive
const COLOR_NEGATIVE        = '#FF4B4B'; // --st-chart-negative
const COLOR_AVATAR_BG       = '#1e1e1e';
const COLOR_AVATAR_BORDER   = '#2a2a2a';
const COLOR_AVATAR_INITIALS = '#52525b';
const COLOR_SEPARATOR       = '#1a1a1a'; // borderBottom in ArtistRow

// Fonts — must match what next/font/google loads in layout.tsx:
//   Geist → --font-geist-sans, Geist Mono → --font-geist-mono
const SANS = 'Geist, system-ui, -apple-system, sans-serif';
const MONO = '"Geist Mono", monospace';

// DISPLAY_SCALE = 0.38 → multiply any UI px by (1/0.38) to get canvas px
const S = 1 / 0.38;

const PADDING_X = 65; // left/right margin — matches SONOTRADE_PADDING_X

// ArtistRow: padding '14px 0', avatar 42×42, total row height ~70px at UI scale
export const MARKET_ROW_H = Math.round(70 * S); // ≈ 184px

const AVATAR_D = Math.round(42 * S); // ≈ 110px
const AVATAR_R = AVATAR_D / 2;

// gap: 12 between avatar → text column, text column → right column
const GAP    = Math.round(12 * S); // ≈ 32px
const TEXT_X = PADDING_X + AVATAR_D + GAP; // left edge of name/industry text

// Fonts: name bumped to 18px (was 15) for prominence; price stays 15px, industry/change 12px
const NAME_SIZE   = Math.round(20 * S); // bumped from 18
const SUB_SIZE    = Math.round(12 * S); // ≈ 32px
const NAME_GAP    = Math.round(5  * S); // space between name and industry

const PRICE_SIZE  = Math.round(20 * S); // bumped from 15 → 18 → 20
const CHANGE_SIZE = Math.round(12 * S); // ≈ 32px
const PRICE_GAP   = Math.round(4  * S); // space between price and change

// ListTrendArrow: SVG viewBox="0 0 24 18" displayed at 13×13px UI
const ARROW_W   = Math.round(13 * S);           // ≈ 34px
const ARROW_H   = Math.round(13 * S * 18 / 24); // ≈ 26px (preserves 24:18 aspect)
const ARROW_GAP = Math.round(3  * S);            // gap: 3 between arrow and % text ≈ 8px

// Sparkline: 80×30px UI → 211×79px canvas, marginRight 8px UI → 21px canvas
const SPARK_W          = Math.round(80 * S); // ≈ 211px
const SPARK_H          = Math.round(30 * S); // ≈ 79px
const SPARK_MARGIN_R   = Math.round(16 * S); // more breathing room between chart and price
const SPARK_LINE_W     = Math.round(1.5 * S);// stroke width ≈ 4px

// ── Small variant — a single compact line: photo, name, price, change ──────────
// No industry subtitle, no sparkline. ~48px row at UI scale vs ~70px for large.
export const MARKET_ROW_H_SMALL = Math.round(48 * S); // ≈ 126px
// Breathing room between the bottom of the video and the top of the CTA box.
export const CTA_TOP_GAP = Math.round(7 * S);
// "Link in bio" line centered under the CTA box.
const LINK_SIZE = Math.round(13 * S);
const LINK_GAP  = Math.round(5 * S);
const COLOR_LINK = 'rgba(255,255,255,0.5)'; // light grey
export const CTA_LINK_AREA_H = LINK_GAP + LINK_SIZE + Math.round(8 * S);
const SM_AVATAR_D    = Math.round(30 * S); // ≈ 79px
const SM_NAME_SIZE   = Math.round(18 * S); // bumped from 14 → 16 → 18
const SM_PRICE_SIZE  = Math.round(16 * S); // bumped from 14 for prominence
const SM_CHANGE_SIZE = Math.round(12 * S);
const SM_ARROW_W     = Math.round(12 * S);
const SM_ARROW_H     = Math.round(12 * S * 18 / 24);
const SM_ARROW_GAP   = Math.round(3 * S);
const SM_PC_GAP      = Math.round(10 * S); // gap between price and change groups
const SM_NAME_PAD    = Math.round(12 * S); // min gap between name and price group

export interface DrawMarketRowOptions {
  ctx: CanvasRenderingContext2D;
  cx: number;
  videoBottomY: number;
  cw: number;
  name: string;
  subtitle: string;        // industry ?? subcategory ?? '—'
  photo_url: string | null;
  priceUsd: number | null;
  lifetimeChangePct: number | null;
  sparkline?: SparkPoint[] | null;
  avatarImgRef: MutableRefObject<HTMLImageElement | null>;
  lastPhotoUrlRef: MutableRefObject<string | null>;
  size?: 'large' | 'small';
}

// Avatar outline: a rounded square (used for both small and large variants).
function avatarPath(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, d: number,
): void {
  const rad = Math.round(d * 0.22); // corner radius
  const x = cx - r, y = cy - r;
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + d, y,     x + d, y + d, rad);
  ctx.arcTo(x + d, y + d, x,     y + d, rad);
  ctx.arcTo(x,     y + d, x,     y,     rad);
  ctx.arcTo(x,     y,     x + d, y,     rad);
  ctx.closePath();
}

// Largest font size (stepping down from baseSize, floored at minSize) at which
// `text` fits within maxWidth. Lets long names shrink to fit instead of wrapping
// or being clipped/ellipsized. Leaves ctx.font set to the chosen size.
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string, weight: string, family: string,
  baseSize: number, maxWidth: number, minSize: number,
): number {
  let size = baseSize;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

export function drawMarketRow({
  ctx, cx, videoBottomY, cw,
  name, subtitle, photo_url, priceUsd, lifetimeChangePct, sparkline,
  avatarImgRef, lastPhotoUrlRef, size = 'large',
}: DrawMarketRowOptions): void {
  const isSmall   = size === 'small';
  const rowH      = isSmall ? MARKET_ROW_H_SMALL : MARKET_ROW_H;
  const avatarD   = isSmall ? SM_AVATAR_D : AVATAR_D;
  const avatarR   = avatarD / 2;
  const cy        = videoBottomY + CTA_TOP_GAP; // gap between video and CTA
  const midY      = cy + rowH / 2;
  const rightEdge = cx + cw - PADDING_X;

  // "Link in bio" — light grey, centered under the CTA box. Drawn for both sizes.
  const drawLinkInBio = () => {
    ctx.font = `500 ${LINK_SIZE}px ${SANS}`;
    ctx.fillStyle = COLOR_LINK;
    const txt = 'Link in bio';
    const w = ctx.measureText(txt).width;
    ctx.fillText(txt, cx + cw / 2 - w / 2, cy + rowH + LINK_GAP + LINK_SIZE);
  };

  if (!isSmall) {
    // Large: a white rounded-rectangle outline hugging the CTA content (small
    // gets no box and no divider).
    const boxMargin = 52;                       // canvas px in from the side edges
    const bx = cx + boxMargin;
    const bw = cw - boxMargin * 2;
    const byInset = Math.round(9 * S);
    const by = cy + byInset;
    const bh = rowH - byInset * 2;
    const br = Math.round(14 * S);
    ctx.beginPath();
    ctx.moveTo(bx + br, by);
    ctx.arcTo(bx + bw, by,      bx + bw, by + bh, br);
    ctx.arcTo(bx + bw, by + bh, bx,      by + bh, br);
    ctx.arcTo(bx,      by + bh, bx,      by,      br);
    ctx.arcTo(bx,      by,      bx + bw, by,      br);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; // light, soft white
    ctx.lineWidth = Math.max(1, Math.round(0.8 * S));
    ctx.stroke();
  }

  // ── Avatar ────────────────────────────────────────────────────────────────────
  const avatarCX = cx + PADDING_X + avatarR;
  const avatarCY = midY;

  if (photo_url !== lastPhotoUrlRef.current) {
    avatarImgRef.current = null;
    lastPhotoUrlRef.current = photo_url;
  }
  let img = avatarImgRef.current;
  if (!img && photo_url) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = photo_url;
    avatarImgRef.current = img;
  }

  // Background fill
  ctx.fillStyle = COLOR_AVATAR_BG;
  avatarPath(ctx, avatarCX, avatarCY, avatarR, avatarD);
  ctx.fill();

  if (img && img.complete && img.naturalWidth > 0) {
    // Photo — object-fit: cover
    ctx.save();
    avatarPath(ctx, avatarCX, avatarCY, avatarR, avatarD);
    ctx.clip();
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(avatarD / iw, avatarD / ih);
    const sw = avatarD / scale, sh = avatarD / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh,
      avatarCX - avatarR, avatarCY - avatarR, avatarD, avatarD);
    ctx.restore();
  } else {
    // Initials fallback — fontSize: 10 at UI scale
    const initialsSize = Math.round((isSmall ? 8 : 10) * S);
    const initials = name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
    ctx.font = `600 ${initialsSize}px ${SANS}`;
    ctx.fillStyle = COLOR_AVATAR_INITIALS;
    const iw2 = ctx.measureText(initials).width;
    ctx.fillText(initials, avatarCX - iw2 / 2, avatarCY + initialsSize * 0.35);
  }

  // Border: '1px solid #2a2a2a'
  ctx.strokeStyle = COLOR_AVATAR_BORDER;
  ctx.lineWidth = Math.max(1, Math.round(1 * S));
  avatarPath(ctx, avatarCX, avatarCY, avatarR, avatarD);
  ctx.stroke();

  // ── Small variant — one line: name (left) · price + change (right) ───────────
  if (isSmall) {
    const priceText  = priceUsd != null ? priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    const changeText = lifetimeChangePct != null ? `${Math.abs(lifetimeChangePct).toFixed(1)}%` : '';

    ctx.font = `600 ${SM_PRICE_SIZE}px ${MONO}`;
    const priceW = priceText ? ctx.measureText(priceText).width : 0;
    ctx.font = `500 ${SM_CHANGE_SIZE}px ${MONO}`;
    const changeTxtW = changeText ? ctx.measureText(changeText).width : 0;
    const changeRowW = changeTxtW ? SM_ARROW_W + SM_ARROW_GAP + changeTxtW : 0;

    // Right group laid out right-to-left ending at rightEdge: [price] [gap] [↑ change]
    const changeTextX = rightEdge - changeTxtW;
    const arrowX      = changeTextX - SM_ARROW_GAP - SM_ARROW_W;
    const priceRight  = changeRowW ? arrowX - SM_PC_GAP : rightEdge;
    const priceX      = priceRight - priceW;
    const groupLeft   = changeRowW ? arrowX : priceX;

    // Name — fills the space between avatar and the right group. If too long,
    // SHRINK to fit rather than truncate with an ellipsis.
    const textX     = cx + PADDING_X + avatarD + GAP;
    const nameMaxW  = Math.max(0, groupLeft - SM_NAME_PAD - textX);
    const smNameSz  = fitFontSize(ctx, name, '600', SANS, SM_NAME_SIZE, nameMaxW, Math.round(9 * S));
    ctx.font = `600 ${smNameSz}px ${SANS}`;
    const nameBaseline = Math.round(midY + smNameSz * 0.35);
    ctx.fillStyle = COLOR_WHITE;
    ctx.fillText(name, textX, nameBaseline);

    // Price
    if (priceText) {
      ctx.font = `600 ${SM_PRICE_SIZE}px ${MONO}`;
      ctx.fillStyle = COLOR_WHITE;
      ctx.fillText(priceText, priceX, Math.round(midY + SM_PRICE_SIZE * 0.35));
    }

    // Change — MARKETING: always positive (green + up arrow)
    if (lifetimeChangePct != null) {
      const changeBaseline = Math.round(midY + SM_CHANGE_SIZE * 0.35);
      ctx.fillStyle = COLOR_POSITIVE;
      const arrowCY  = changeBaseline - SM_CHANGE_SIZE * 0.35;
      const arrowTop = arrowCY - SM_ARROW_H / 2;
      ctx.beginPath();
      ctx.moveTo(arrowX + SM_ARROW_W * 0.5,   arrowTop);
      ctx.lineTo(arrowX + SM_ARROW_W * 0.933, arrowTop + SM_ARROW_H * 0.792);
      ctx.lineTo(arrowX + SM_ARROW_W * 0.067, arrowTop + SM_ARROW_H * 0.792);
      ctx.closePath();
      ctx.fill();
      ctx.font = `500 ${SM_CHANGE_SIZE}px ${MONO}`;
      ctx.fillStyle = COLOR_POSITIVE;
      ctx.fillText(changeText, changeTextX, changeBaseline);
    }
    drawLinkInBio();
    return;
  }

  // ── Name + Industry (center column) ──────────────────────────────────────────
  // Stack tightly by CAP HEIGHT (not line-height) so the two lines sit right on
  // top of each other. Group is vertically centered on the avatar's middle.
  const NAME_CAP = NAME_SIZE * 0.72;
  const SUB_CAP  = SUB_SIZE  * 0.72;
  const textBlockH = NAME_CAP + NAME_GAP + SUB_CAP;
  const blockTop   = midY - textBlockH / 2;
  const nameBaseline = Math.round(blockTop + NAME_CAP);
  const subBaseline  = Math.round(nameBaseline + NAME_GAP + SUB_CAP);

  // ── Measure the price column first — needed both to place the sparkline and
  // to know how much horizontal room the name has. ────────────────────────────
  const priceText   = priceUsd != null ? priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const changeText  = lifetimeChangePct != null ? `${Math.abs(lifetimeChangePct).toFixed(1)}%` : '';

  ctx.font = `600 ${PRICE_SIZE}px ${MONO}`;
  const priceTextW  = priceText  ? ctx.measureText(priceText).width  : 0;

  ctx.font = `500 ${CHANGE_SIZE}px ${MONO}`;
  const changeTxtW  = changeText ? ctx.measureText(changeText).width  : 0;
  const changeRowW  = changeTxtW ? ARROW_W + ARROW_GAP + changeTxtW : 0;

  const priceColW   = Math.max(priceTextW, changeRowW);

  // Layout (left→right): avatar · name/industry · price+change · sparkline.
  // The sparkline now sits at the far right; price/change sits just left of it.
  const hasSpark       = sparkline != null && sparkline.length >= 1;
  const priceRightEdge = hasSpark ? rightEdge - SPARK_W - SPARK_MARGIN_R : rightEdge;

  // Name + Industry: left-aligned, stacked, group centered on the photo's
  // middle. If the name is too long to fit before the sparkline/price column,
  // SHRINK it to fit rather than wrap or ellipsize. Industry keeps its size.
  const sparkSpace = (sparkline && sparkline.length >= 1) ? (SPARK_W + SPARK_MARGIN_R) : SPARK_MARGIN_R;
  const nameMaxW   = Math.max(Math.round(20 * S), (rightEdge - priceColW - sparkSpace) - TEXT_X - Math.round(8 * S));
  const nameSize   = fitFontSize(ctx, name, '600', SANS, NAME_SIZE, nameMaxW, Math.round(11 * S));
  ctx.font = `600 ${nameSize}px ${SANS}`;
  ctx.fillStyle = COLOR_WHITE;
  ctx.fillText(name, TEXT_X, nameBaseline);

  ctx.font = `400 ${SUB_SIZE}px ${SANS}`;
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.fillText(subtitle || '—', TEXT_X, subBaseline);

  // ── Sparkline — sits immediately left of the price column with SPARK_MARGIN_R gap ──
  // This matches the CSS: [sparkline div marginRight:8][price+change shrink:0]
  // MARKETING: green and net-upward (the source series is generated to end
  // higher than it starts), but drawn in its natural order so it has real ups
  // and downs along the way — not a flat monotonic climb.
  if (sparkline && sparkline.length >= 1) {
    const sparkColor = COLOR_POSITIVE;

    const sparkLeft  = rightEdge - SPARK_W;
    const sparkTop   = midY - SPARK_H / 2;
    const pad        = (2 / 32) * SPARK_H;

    // Single-point sparklines come back from the API for brand-new markets —
    // pad to two so we always have a line segment to draw.
    const rawVals = sparkline.map(p => p.value);
    const vals = rawVals.length === 1 ? [rawVals[0]!, rawVals[0]!] : rawVals;
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);
    const vRange = vMax - vMin;

    const pts = vals.map((v, i) => ({
      x: sparkLeft + (i / (vals.length - 1)) * SPARK_W,
      y: vRange === 0
        ? sparkTop + SPARK_H / 2
        : sparkTop + pad + (1 - (v - vMin) / vRange) * (SPARK_H - pad * 2),
    }));

    // Kalshi-style step line: horizontal hold then a vertical jump at each point.
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 0; i < pts.length - 1; i++) {
      ctx.lineTo(pts[i + 1]!.x, pts[i]!.y);     // hold
      ctx.lineTo(pts[i + 1]!.x, pts[i + 1]!.y); // jump
    }
    ctx.strokeStyle = sparkColor;
    ctx.lineWidth   = SPARK_LINE_W;
    ctx.lineCap     = 'square';
    ctx.lineJoin    = 'miter';
    ctx.stroke();
  }

  // ── Price + Change (right column) ─────────────────────────────────────────────
  // Stack tightly by CAP HEIGHT so price + change sit right on top of each other,
  // vertically centered on the avatar's middle.
  const PRICE_CAP  = PRICE_SIZE  * 0.72;
  const CHANGE_CAP = CHANGE_SIZE * 0.72;
  const priceBlockH   = PRICE_CAP + PRICE_GAP + CHANGE_CAP;
  const priceBlockTop = midY - priceBlockH / 2;
  const priceBaseline  = Math.round(priceBlockTop + PRICE_CAP);
  const changeBaseline = Math.round(priceBaseline + PRICE_GAP + CHANGE_CAP);

  if (priceText) {
    ctx.font = `600 ${PRICE_SIZE}px ${MONO}`;
    ctx.fillStyle = COLOR_WHITE;
    ctx.fillText(priceText, priceRightEdge - priceTextW, priceBaseline);
  }

  if (lifetimeChangePct != null) {
    // MARKETING: always render the change as positive. The displayed % already
    // uses Math.abs() above so the number is unsigned; we force the color +
    // arrow direction to match.
    const color = COLOR_POSITIVE;

    ctx.font = `500 ${CHANGE_SIZE}px ${MONO}`;
    ctx.fillStyle = color;
    const aX     = priceRightEdge - ARROW_W - ARROW_GAP - changeTxtW;

    // Arrow center aligned on text cap-height (ListTrendArrow: 13×13, SVG viewBox 0 0 24 18)
    const arrowCY  = changeBaseline - CHANGE_SIZE * 0.35;
    const arrowTop = arrowCY - ARROW_H / 2;

    // Triangle matching SVG path: m12 0 10.392 14.25H1.608z in viewBox 24×18 — always up.
    ctx.beginPath();
    ctx.moveTo(aX + ARROW_W * 0.5,   arrowTop);
    ctx.lineTo(aX + ARROW_W * 0.933, arrowTop + ARROW_H * 0.792);
    ctx.lineTo(aX + ARROW_W * 0.067, arrowTop + ARROW_H * 0.792);
    ctx.closePath();
    ctx.fill();

    ctx.fillText(changeText, aX + ARROW_W + ARROW_GAP, changeBaseline);
  }

  drawLinkInBio();
}
