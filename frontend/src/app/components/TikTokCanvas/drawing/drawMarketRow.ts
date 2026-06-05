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

const PADDING_X = 105; // left/right inner margin

// ArtistRow: padding '14px 0', avatar 32×32, total row height ~70px at UI scale
export const MARKET_ROW_H = Math.round(67 * S);

const AVATAR_D = Math.round(28 * S);
const AVATAR_R = AVATAR_D / 2;

// gap: 12 between avatar → text column, text column → right column
const GAP    = Math.round(7 * S);
const TEXT_X = PADDING_X + AVATAR_D + GAP; // left edge of name/industry text

const NAME_SIZE   = Math.round(10 * S);
const SUB_SIZE    = Math.round(8  * S);
const NAME_GAP    = Math.round(9 * S); // space between name and industry

const PRICE_SIZE  = Math.round(11 * S);
const CHANGE_SIZE = Math.round(8  * S);
const PRICE_GAP   = Math.round(10 * S); // space between price and change

// ListTrendArrow: SVG viewBox="0 0 24 18" displayed at 8×8px UI
const ARROW_W   = Math.round(8 * S);
const ARROW_H   = Math.round(8 * S * 18 / 24);
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
// The small CTA tucks even closer to the video than the large one.
export const CTA_TOP_GAP_SMALL = Math.round(1 * S);
// The bio CTA sits well below the video — a roomy gap above the "pauv.com" line.
export const CTA_TOP_GAP_BIO = Math.round(14 * S);
// "Link in bio" line centered under the CTA box.
const LINK_SIZE = Math.round(10 * S);
const LINK_GAP  = Math.round(2 * S);
const COLOR_LINK = 'rgba(255,255,255,0.5)'; // light grey
export const CTA_LINK_AREA_H = LINK_GAP + LINK_SIZE + Math.round(8 * S);
// Bio CTA: no market row at all — just the link, a little bigger, right under the video.
const BIO_LINK_SIZE = Math.round(13 * S);
export const CTA_LINK_AREA_H_BIO = LINK_GAP + BIO_LINK_SIZE + Math.round(8 * S);
const SM_AVATAR_D      = Math.round(24 * S);
// Small CTA photo is a rounded square, not a circle — slight corner rounding.
const SM_AVATAR_RADIUS = Math.round(5 * S);
// Extra room to the right of the small CTA so the % change isn't flush to the edge.
const SM_RIGHT_PAD     = Math.round(10 * S);
const SM_NAME_SIZE   = Math.round(18 * S); // bumped from 14 → 16 → 18
// Right side (the price + change cluster) shrunk 15% — the 0.85 factor below.
const SM_PRICE_SIZE  = Math.round(16 * 0.85 * S); // was 16 (bumped for prominence), -15%
const SM_CHANGE_SIZE = Math.round(12 * 0.85 * S); // was 12, -15%
const SM_ARROW_W     = Math.round(12 * 0.85 * S);
const SM_ARROW_H     = Math.round(12 * 0.85 * S * 18 / 24);
const SM_ARROW_GAP   = Math.round(3 * 0.85 * S);
const SM_PC_GAP      = Math.round(10 * 0.85 * S); // gap between price and change groups
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
  pauvLogoImgRef?: MutableRefObject<HTMLImageElement | null>;
  arrowOpacity?: number;
  triangleOnly?: boolean;
  size?: 'large' | 'small' | 'bio';
  /** bio CTA only: appends a bold " Artists" / " Athletes" after "to trade". */
  ctaCategory?: 'artists' | 'athletes';
}

// Avatar outline: a circle by default, or a rounded square when `cornerRadius`
// is given (the small variant uses a slightly-rounded square instead).
function avatarPath(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, d: number,
  cornerRadius?: number,
): void {
  ctx.beginPath();
  if (cornerRadius && cornerRadius > 0) {
    const x = cx - d / 2;
    const y = cy - d / 2;
    const br = cornerRadius;
    ctx.moveTo(x + br, y);
    ctx.arcTo(x + d, y,     x + d, y + d, br);
    ctx.arcTo(x + d, y + d, x,     y + d, br);
    ctx.arcTo(x,     y + d, x,     y,     br);
    ctx.arcTo(x,     y,     x + d, y,     br);
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
  }
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
  avatarImgRef, lastPhotoUrlRef, pauvLogoImgRef, arrowOpacity = 1, triangleOnly = false, size = 'large',
  ctaCategory,
}: DrawMarketRowOptions): void {
  const isSmall   = size === 'small';
  const isBio     = size === 'bio';
  const rowH      = isBio ? 0 : (isSmall ? MARKET_ROW_H_SMALL : MARKET_ROW_H);
  const avatarD   = isSmall ? SM_AVATAR_D : AVATAR_D;
  const avatarR   = avatarD / 2;
  const cy        = videoBottomY + (isBio ? CTA_TOP_GAP_BIO : isSmall ? CTA_TOP_GAP_SMALL : CTA_TOP_GAP); // gap between video and CTA
  const midY      = cy + rowH / 2;
  // Large CTA only: pull both sides in so the row is ~20% narrower and stays
  // centered. The slack is taken from the empty space to the LEFT of the chart —
  // avatar/name shift right, chart/price shift left — while the chart, text, and
  // price+change cluster keep their sizes.
  const LG_NARROW = 0.20;
  const lgInset   = (isSmall || isBio) ? 0 : Math.round((cw - PADDING_X * 2) * LG_NARROW / 2);
  const padX      = PADDING_X + lgInset;
  const rightEdge = cx + cw - padX;

  // triangleOnly: skip all drawing except the animated triangle (used in recording per-frame pass).
  if (triangleOnly && lifetimeChangePct == null) return; // bio / no-change CTA: nothing to animate
  if (triangleOnly && lifetimeChangePct != null) {
    if (isBio) return; // bio CTA has no market row / arrow to animate
    const changeText = `${Math.abs(lifetimeChangePct).toFixed(1)}%`;
    ctx.fillStyle = COLOR_POSITIVE;
    ctx.globalAlpha = arrowOpacity;
    if (isSmall) {
      // Mirror the small-variant arrow geometry exactly (see the small block below)
      // so the per-frame animated triangle lands on top of the baked one — not at
      // the large layout's position, which would draw a phantom arrow below.
      ctx.font = `500 ${SM_CHANGE_SIZE}px ${MONO}`;
      const changeTxtW = ctx.measureText(changeText).width;
      const smRightEdge = rightEdge - SM_RIGHT_PAD;
      const changeTextX = smRightEdge - changeTxtW;
      const arrowX      = changeTextX - SM_ARROW_GAP - SM_ARROW_W;
      const changeBaseline = Math.round(midY + SM_CHANGE_SIZE * 0.35);
      const arrowCY  = changeBaseline - SM_CHANGE_SIZE * 0.35;
      const arrowTop = arrowCY - SM_ARROW_H / 2;
      ctx.beginPath();
      ctx.moveTo(arrowX + SM_ARROW_W * 0.5,   arrowTop);
      ctx.lineTo(arrowX + SM_ARROW_W * 0.933, arrowTop + SM_ARROW_H * 0.792);
      ctx.lineTo(arrowX + SM_ARROW_W * 0.067, arrowTop + SM_ARROW_H * 0.792);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.font = `500 ${CHANGE_SIZE}px ${MONO}`;
      const changeTxtW = ctx.measureText(changeText).width;
      const PRICE_CAP   = PRICE_SIZE * 0.72;
      const CHANGE_CAP  = CHANGE_SIZE * 0.72;
      const priceBlockH = PRICE_CAP + PRICE_GAP + CHANGE_CAP;
      const changeBaseline = Math.round((midY - priceBlockH / 2) + PRICE_CAP + PRICE_GAP + CHANGE_CAP);
      const aX      = rightEdge - ARROW_W - ARROW_GAP - changeTxtW;
      const arrowCY  = changeBaseline - CHANGE_SIZE * 0.35 + Math.round(1 * S);
      const arrowTop = arrowCY - ARROW_H / 2;
      ctx.beginPath();
      ctx.moveTo(aX + ARROW_W * 0.5,   arrowTop);
      ctx.lineTo(aX + ARROW_W * 0.933, arrowTop + ARROW_H * 0.792);
      ctx.lineTo(aX + ARROW_W * 0.067, arrowTop + ARROW_H * 0.792);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  // "Link in bio" — light grey, centered under the CTA box. Drawn for every size;
  // `linkSize` lets the bio variant render it a little bigger.
  const drawLinkInBio = (linkSize: number = LINK_SIZE) => {
    // One shared font (Inter at `linkSize`) for every segment — only the weight
    // and colour change between them, so ".com", "to trade" and the category all
    // sit on the SAME baseline at the SAME size, on one line.
    const font = (weight: number) => `${weight} ${linkSize}px Inter, ${SANS}`;
    const dotCom = '.com';
    const txt    = 'to trade';
    // Bio CTA only: a bold talent category after "to trade", e.g.
    // "pauv.com to trade Artists" / "…Athletes". Same font + size as "to trade",
    // just bold and white. Leading space separates it from "trade".
    const catLabel = (isBio && ctaCategory) ? (ctaCategory === 'athletes' ? 'Athletes' : 'Artists') : '';
    const catText  = catLabel ? ` ${catLabel}` : '';

    // Measure each segment in the exact weight it's drawn with, so the centering
    // and the inter-segment offsets are pixel-accurate (no drift, no overlap).
    ctx.font = font(600); const dotComW = ctx.measureText(dotCom).width;
    ctx.font = font(400); const txtW    = ctx.measureText(txt).width;
    ctx.font = font(700); const catW    = catText ? ctx.measureText(catText).width : 0;

    const logoH   = linkSize;
    const gap     = Math.round(4 * S); // space between ".com" and "to trade"
    const logoGap = 0;
    const baseY   = cy + rowH + LINK_GAP + linkSize;

    // Draw Pauv logo if loaded
    let logo: HTMLImageElement | null = pauvLogoImgRef?.current ?? null;
    if (!logo) {
      logo = new Image();
      logo.crossOrigin = 'anonymous';
      logo.src = '/pauvlogo.png';
      logo.onload = () => { if (pauvLogoImgRef) pauvLogoImgRef.current = logo; };
    }

    if (logo?.complete && logo.naturalWidth > 0) {
      const aspect = logo.naturalWidth / logo.naturalHeight;
      const dw = Math.round(logoH * aspect);
      // Whole line: [logo].com␣to trade␣Artists — centered as a single unit.
      const totalW = dw + logoGap + dotComW + gap + txtW + catW;
      const x = cx + cw / 2 - totalW / 2;
      // pauvlogo.png is the "pauv" wordmark whose long "p" descender fills the
      // bottom 23% of the image — the "auv" baseline sits at 0.77 of its height
      // (measured from the asset). drawImage places the whole box, so to land
      // the wordmark on the text baseline (descender hanging below, like real
      // text) we drop it by that descender depth. It SCALES with logo height —
      // the old fixed nudge left the bigger bio logo floating above the line.
      // The extra ~2px drops it a hair below the baseline so the "p" clearly
      // clears ".com to trade".
      const logoDrop = Math.round(logoH * 0.23) + Math.round(0.8 * S);
      ctx.drawImage(logo, x, baseY - logoH + logoDrop, dw, logoH);
      ctx.font = font(600); ctx.fillStyle = COLOR_WHITE;
      ctx.fillText(dotCom, x + dw + logoGap, baseY);
      const tradeX = x + dw + logoGap + dotComW + gap;
      ctx.font = font(400); ctx.fillStyle = COLOR_LINK;
      ctx.fillText(txt, tradeX, baseY);
      if (catText) {
        ctx.font = font(700); ctx.fillStyle = COLOR_WHITE;
        ctx.fillText(catText, tradeX + txtW, baseY);
      }
    } else {
      // No logo yet — center "to trade" (+ category) on its own, same baseline.
      const fbX = cx + cw / 2 - (txtW + catW) / 2;
      ctx.font = font(400); ctx.fillStyle = COLOR_LINK;
      ctx.fillText(txt, fbX, baseY);
      if (catText) {
        ctx.font = font(700); ctx.fillStyle = COLOR_WHITE;
        ctx.fillText(catText, fbX + txtW, baseY);
      }
    }
  };

  // Bio CTA: only the "pauv.com to trade" line — a little bigger, sitting right
  // under the video. No avatar, no market row.
  if (isBio) {
    drawLinkInBio(BIO_LINK_SIZE);
    return;
  }

  if (!isSmall) {
    // Large: a white rounded-rectangle outline hugging the CTA content (small
    // gets no box and no divider). Narrows with the content via lgInset so the
    // box keeps its constant gap to the avatar/price and stays centered.
    const boxMargin = 80 + lgInset;             // canvas px in from the side edges
    const bx = cx + boxMargin;
    const bw = cw - boxMargin * 2;
    const byInset = Math.round(9 * S);
    const by = cy + byInset;
    const bh = rowH - byInset * 2;
    const br = Math.round(10 * S);
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
  const avatarCX = cx + padX + avatarR;
  const avatarCY = midY;
  // Small variant draws the photo as a slightly-rounded square; others stay circular.
  const avatarCorner = isSmall ? SM_AVATAR_RADIUS : undefined;

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
  avatarPath(ctx, avatarCX, avatarCY, avatarR, avatarD, avatarCorner);
  ctx.fill();

  if (img && img.complete && img.naturalWidth > 0) {
    // Photo — object-fit: cover
    ctx.save();
    avatarPath(ctx, avatarCX, avatarCY, avatarR, avatarD, avatarCorner);
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
  avatarPath(ctx, avatarCX, avatarCY, avatarR, avatarD, avatarCorner);
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

    // Pull the right cluster in from the row's right edge so the % change has
    // breathing room before the side, instead of sitting flush against it.
    const smRightEdge = rightEdge - SM_RIGHT_PAD;

    // Right group laid out right-to-left ending at smRightEdge: [price] [gap] [↑ change]
    const changeTextX = smRightEdge - changeTxtW;
    const arrowX      = changeTextX - SM_ARROW_GAP - SM_ARROW_W;
    const priceRight  = changeRowW ? arrowX - SM_PC_GAP : smRightEdge;
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
      // Respect arrowOpacity so the export's static sprite (baked at opacity 0)
      // omits this arrow and the per-frame triangleOnly pass animates it instead —
      // matching the large variant. Without this the small arrow bakes in solid
      // (never blinks) and the animated one lands elsewhere.
      ctx.globalAlpha = arrowOpacity;
      ctx.beginPath();
      ctx.moveTo(arrowX + SM_ARROW_W * 0.5,   arrowTop);
      ctx.lineTo(arrowX + SM_ARROW_W * 0.933, arrowTop + SM_ARROW_H * 0.792);
      ctx.lineTo(arrowX + SM_ARROW_W * 0.067, arrowTop + SM_ARROW_H * 0.792);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
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

  // Layout (left→right): avatar · name/industry · sparkline · price+change.
  // Price+change at far right; sparkline sits just left of it.
  const hasSpark       = sparkline != null && sparkline.length >= 1;
  const priceRightEdge = rightEdge;

  // Name + Industry: left-aligned, stacked, group centered on the photo's
  // middle. If the name is too long to fit before the sparkline/price column,
  // SHRINK it to fit rather than wrap or ellipsize. Industry keeps its size.
  const sparkSpace = (sparkline && sparkline.length >= 1) ? (SPARK_W + SPARK_MARGIN_R) : SPARK_MARGIN_R;
  const textX      = TEXT_X + lgInset; // name/industry shift right with the avatar
  const nameMaxW   = Math.max(Math.round(20 * S), (rightEdge - priceColW - sparkSpace) - textX - Math.round(8 * S));
  const nameSize   = fitFontSize(ctx, name, '600', SANS, NAME_SIZE, nameMaxW, Math.round(11 * S));
  ctx.font = `600 ${nameSize}px ${SANS}`;
  ctx.fillStyle = COLOR_WHITE;
  ctx.fillText(name, textX, nameBaseline);

  ctx.font = `400 ${SUB_SIZE}px ${SANS}`;
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.fillText(subtitle || '—', textX, subBaseline);

  // ── Sparkline — sits immediately left of the price column with SPARK_MARGIN_R gap ──
  // This matches the CSS: [sparkline div marginRight:8][price+change shrink:0]
  // MARKETING: green and net-upward (the source series is generated to end
  // higher than it starts), but drawn in its natural order so it has real ups
  // and downs along the way — not a flat monotonic climb.
  if (sparkline && sparkline.length >= 1) {
    const sparkColor = COLOR_POSITIVE;

    const sparkLeft  = priceRightEdge - priceColW - SPARK_MARGIN_R - SPARK_W;
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

    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i]!.x + pts[i + 1]!.x) / 2;
      const my = (pts[i]!.y + pts[i + 1]!.y) / 2;
      ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y);
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

    const arrowCY  = changeBaseline - CHANGE_SIZE * 0.35 + Math.round(1 * S);
    const arrowTop = arrowCY - ARROW_H / 2;

    // Triangle matching SVG path: m12 0 10.392 14.25H1.608z in viewBox 24×18 — always up.
    ctx.globalAlpha = arrowOpacity;
    ctx.beginPath();
    ctx.moveTo(aX + ARROW_W * 0.5,   arrowTop);
    ctx.lineTo(aX + ARROW_W * 0.933, arrowTop + ARROW_H * 0.792);
    ctx.lineTo(aX + ARROW_W * 0.067, arrowTop + ARROW_H * 0.792);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillText(changeText, aX + ARROW_W + ARROW_GAP, changeBaseline);
  }

  drawLinkInBio();
}
