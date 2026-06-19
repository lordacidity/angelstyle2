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

// Shared USD formatter — "1,234.56". Used for the static price and the rolling one.
const fmtPrice = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
// Sized so the visible gap from the CTA's bottom edge up to the top of "pauv.com"
// matches CTA_TOP_GAP (the gap above the CTA). Formula:
//   visible bottom gap = LINK_GAP + (LINK_SIZE - capHeight) ≈ LINK_GAP + 0.3 * LINK_SIZE
//   solving for LINK_GAP = CTA_TOP_GAP - 0.3 * LINK_SIZE = 7*S - 3*S = 4*S
// gives symmetric breathing room above and below the CTA — was 2*S which left
// the bottom looking ~5 canvas px tighter than the top.
const LINK_GAP  = Math.round(4 * S);
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
  /** Mid-rotation price roll: render the price area as a quick vertical odometer
   *  roll from `fromUsd` up to `toUsd` (progress 0→1 drives the slide). Purely a
   *  visual flourish, set by the rotating CTA; ignored on the triangleOnly pass. */
  priceRoll?: { fromUsd: number; toUsd: number; progress: number };
  /** Skip the "pauv.com to trade" link line. Used by the rotating-CTA helper,
   *  which cubes only the person card and draws the link statically itself. */
  omitLink?: boolean;
  /** Skip the large variant's white pill outline. The rotating-CTA helper draws
   *  that frame statically (so it never rotates) and folds the content inside it. */
  omitBox?: boolean;
  /** Inverts the bullish treatment: red text/arrow, down-pointing triangle, and
   *  a declining sparkline. Defaults to false (green/up). */
  down?: boolean;
  size?: 'large' | 'small' | 'bio';
  /** bio CTA only: appends a bold " Artists" / " Athletes" after "to trade". */
  ctaCategory?: 'artists' | 'athletes' | 'people';
}

// "pauv.com to trade [Artists]" — light grey, centered under the CTA box. Drawn
// for every size; `linkSize` lets the bio variant render it a little bigger. Cy
// and rowH are recomputed from `size` so this can be called standalone (the
// rotating-CTA helper keeps this line fixed while the person card cubes).
export function drawCtaLink({
  ctx, cx, cw, videoBottomY, size = 'large', ctaCategory, pauvLogoImgRef, linkSize,
}: {
  ctx: CanvasRenderingContext2D;
  cx: number;
  cw: number;
  videoBottomY: number;
  size?: 'large' | 'small' | 'bio';
  ctaCategory?: 'artists' | 'athletes' | 'people';
  pauvLogoImgRef?: MutableRefObject<HTMLImageElement | null>;
  linkSize?: number;
}): void {
  const isSmall = size === 'small';
  const isBio   = size === 'bio';
  const rowH    = isBio ? 0 : (isSmall ? MARKET_ROW_H_SMALL : MARKET_ROW_H);
  const cy      = videoBottomY + (isBio ? CTA_TOP_GAP_BIO : isSmall ? CTA_TOP_GAP_SMALL : CTA_TOP_GAP);
  const ls      = linkSize ?? (isBio ? BIO_LINK_SIZE : LINK_SIZE);

  // One shared font (Inter at `ls`) for every segment — only the weight and
  // colour change between them, so ".com", "to trade" and the category all sit
  // on the SAME baseline at the SAME size, on one line.
  const font = (weight: number) => `${weight} ${ls}px Inter, ${SANS}`;
  const dotCom = '.com';
  const txt    = 'to trade';
  const catLabel = (isBio && ctaCategory) ? ctaCategory : '';
  const catText  = catLabel ? ` ${catLabel}` : '';

  ctx.font = font(600); const dotComW = ctx.measureText(dotCom).width;
  ctx.font = font(400); const txtW    = ctx.measureText(txt).width;
  ctx.font = font(700); const catW    = catText ? ctx.measureText(catText).width : 0;

  const logoH   = ls;
  const gap     = Math.round(4 * S); // space between ".com" and "to trade"
  const logoGap = 0;
  const baseY   = cy + rowH + LINK_GAP + ls;

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
    const totalW = dw + logoGap + dotComW + gap + txtW + catW;
    const x = cx + cw / 2 - totalW / 2;
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
    const fbX = cx + cw / 2 - (txtW + catW) / 2;
    ctx.font = font(400); ctx.fillStyle = COLOR_LINK;
    ctx.fillText(txt, fbX, baseY);
    if (catText) {
      ctx.font = font(700); ctx.fillStyle = COLOR_WHITE;
      ctx.fillText(catText, fbX + txtW, baseY);
    }
  }
}

// The tight content rectangle the rotating-CTA helper folds — hugging the
// person card's photo + text (and, for the large variant, its white pill
// outline) rather than the full-width row. Keeping the fold and its shading
// inside this box is what makes the rotation read as "the card turning" instead
// of a black band sweeping the whole width. Mirrors the layout math below so the
// two never drift. (bio has no card to rotate, so it isn't handled here.)
export function ctaContentBox(
  cx: number, cw: number, videoBottomY: number, size: 'large' | 'small',
): { x: number; w: number; top: number; h: number } {
  const isSmall = size === 'small';
  const rowH = isSmall ? MARKET_ROW_H_SMALL : MARKET_ROW_H;
  const cy   = videoBottomY + (isSmall ? CTA_TOP_GAP_SMALL : CTA_TOP_GAP);
  const midY = cy + rowH / 2;
  if (isSmall) {
    // Hug the photo + price cluster TIGHTLY so the words/numbers/photo sit right
    // up against the border WITHOUT shrinking them. The layout is fixed: the
    // avatar is left-aligned at PADDING_X, the price/change cluster is
    // right-aligned at (cw - PADDING_X - SM_RIGHT_PAD), and the avatar (the
    // tallest element) sets the height. Just a few px of breathing room all round.
    const hpad  = Math.round(2 * S);
    const vpad  = Math.round(2 * S);
    const left  = cx + PADDING_X - hpad;
    const right = cx + cw - PADDING_X - SM_RIGHT_PAD + hpad;
    const bandH = SM_AVATAR_D + vpad * 2;
    return { x: left, w: right - left, top: midY - bandH / 2, h: bandH };
  }
  // Large — exactly the white pill outline drawMarketRow strokes below.
  const lgInset   = Math.round((cw - PADDING_X * 2) * 0.20 / 2);
  const boxMargin = 80 + lgInset;
  const byInset   = Math.round(9 * S);
  return { x: cx + boxMargin, w: cw - boxMargin * 2, top: cy + byInset, h: rowH - byInset * 2 };
}

// The large CTA's white rounded-pill outline, drawn standalone. drawMarketRow
// calls this for its border. Small/bio have no pill, so nothing is drawn.
export function drawCtaBox({
  ctx, cx, cw, videoBottomY, size,
}: {
  ctx: CanvasRenderingContext2D;
  cx: number;
  cw: number;
  videoBottomY: number;
  size: 'large' | 'small' | 'bio';
}): void {
  if (size !== 'large') return;
  const { x: bx, w: bw, top: by, h: bh } = ctaContentBox(cx, cw, videoBottomY, 'large');
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

// Filled price-change triangle. Points up (▲) by default; `down` flips it to a
// down-pointing (▼) triangle within the same vertical band so an up and a down
// arrow occupy identical layout space. Geometry mirrors the SVG path
// "m12 0 10.392 14.25H1.608z" in viewBox 24×18.
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number, top: number, w: number, h: number, down: boolean,
): void {
  const tip = h * 0.792;
  ctx.beginPath();
  if (down) {
    ctx.moveTo(x + w * 0.5,   top + tip);
    ctx.lineTo(x + w * 0.933, top);
    ctx.lineTo(x + w * 0.067, top);
  } else {
    ctx.moveTo(x + w * 0.5,   top);
    ctx.lineTo(x + w * 0.933, top + tip);
    ctx.lineTo(x + w * 0.067, top + tip);
  }
  ctx.closePath();
  ctx.fill();
}

// Per-digit "odometer" roll — NumberFlow-style. Instead of sliding the whole
// price as one block, each character is compared old→new and ONLY the columns
// that actually change spin (old digit slides up and out of its own clip while
// the new one rises into place from below). Unchanged digits, the comma and the
// decimal point stay perfectly still, so a +$0.12 bump on "1,234.56 → 1,234.68"
// rolls just the cents. progress 0→1. Purely cosmetic (driven by drawRotatingCTA).
//
// Characters are matched by right-offset, which decimal-aligns the two strings
// for the common case where both have the same length (fixed 2-decimal currency).
// When a carry lengthens the number (e.g. "999.91 → 1,000.03") the extra leading
// characters have no old counterpart and simply rise in.
function drawRollingPrice(
  ctx: CanvasRenderingContext2D,
  opts: {
    fromText: string; toText: string; font: string; color: string;
    baseline: number; capH: number; align: 'left' | 'right'; anchorX: number; progress: number;
  },
): void {
  const { fromText, toText, font, color, baseline, capH, align, anchorX, progress } = opts;
  ctx.font = font;
  const toW   = ctx.measureText(toText).width;
  // The number settles as `toText`, so lay the columns out from its left edge.
  const startX = align === 'right' ? anchorX - toW : anchorX;

  // Spacing between the digits a column rolls through. A gap (> 0) means you see
  // clear air between consecutive numbers as they flash by, rather than them
  // sitting stacked right on top of each other.
  const gap  = capH * 0.5;
  const step = capH + gap;     // vertical pitch of the stacked digits during a spin

  const fromChars = [...fromText];
  const toChars   = [...toText];

  ctx.fillStyle = color;
  let x = startX;
  for (let i = 0; i < toChars.length; i++) {
    const toCh = toChars[i]!;
    const chW  = ctx.measureText(toCh).width;
    // Counterpart in the old string at the same place value (right-aligned).
    const rightOffset = toChars.length - 1 - i;
    const fromIdx     = fromChars.length - 1 - rightOffset;
    const fromCh      = fromIdx >= 0 ? fromChars[fromIdx]! : null;

    if (fromCh === toCh) {
      // Unchanged column (digit, comma or '.') — draw it static, no spin.
      ctx.fillText(toCh, x, baseline);
      x += chW;
      continue;
    }

    // Build the vertical sequence of glyphs this column rolls through, in
    // INCREASING order so the column spins UPWARD (the price is climbing). When
    // both old and new are digits we pass through every number between them —
    // "continuous" odometer — so 0→9 briefly flashes 1,2,…,8,9 while 0→1 just
    // ticks once. Non-digit columns (or a newly-appeared leading digit) just
    // do the simple old→new (or rise-in) slide.
    let seq: string[];
    if (fromCh != null && /[0-9]/.test(fromCh) && /[0-9]/.test(toCh)) {
      const d0 = +fromCh, d1 = +toCh;
      const delta = (d1 - d0 + 10) % 10;
      seq = Array.from({ length: delta + 1 }, (_, k) => String((d0 + k) % 10));
    } else {
      seq = fromCh != null ? [fromCh, toCh] : [toCh];
    }

    const n = seq.length;
    // Spin the whole stack within one slot's clip — a single digit tall plus a
    // sliver of the gap above/below so the spacing between numbers is visible.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 1, baseline - capH - gap * 0.5, chW + 2, capH + gap + 2);
    ctx.clip();
    for (let k = 0; k < n; k++) {
      // seq[k] sits in the slot when progress = k/(n-1); as progress grows the
      // stack slides up and the later (larger) digits arrive from below.
      const y = baseline + (k - progress * (n - 1)) * step;
      ctx.fillText(seq[k]!, x, y);
    }
    ctx.restore();
    x += chW;
  }
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
  ctaCategory, down = false, omitLink = false, omitBox = false, priceRoll,
}: DrawMarketRowOptions): void {
  // Shared with the rotating-CTA helper: when it cubes the person card it draws
  // the "pauv.com to trade" line itself (statically), so the card sprites skip it.
  const drawLinkInBio = (linkSize?: number) => {
    if (omitLink) return;
    drawCtaLink({ ctx, cx, cw, videoBottomY, size, ctaCategory, pauvLogoImgRef, linkSize });
  };
  // Bullish by default; `down` flips the colour, arrow direction, and sparkline.
  const changeColor = down ? COLOR_NEGATIVE : COLOR_POSITIVE;
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
    ctx.fillStyle = changeColor;
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
      drawTriangle(ctx, arrowX, arrowTop, SM_ARROW_W, SM_ARROW_H, down);
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
      drawTriangle(ctx, aX, arrowTop, ARROW_W, ARROW_H, down);
    }
    ctx.globalAlpha = 1;
    return;
  }

  // Bio CTA: only the "pauv.com to trade" line — a little bigger, sitting right
  // under the video. No avatar, no market row.
  if (isBio) {
    drawLinkInBio(BIO_LINK_SIZE);
    return;
  }

  if (!isSmall && !omitBox) {
    // Large: a white rounded-pill outline hugging the CTA content (small gets no
    // box). drawCtaBox no-ops for small/bio.
    drawCtaBox({ ctx, cx, cw, videoBottomY, size });
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
    const priceText  = priceUsd != null ? fmtPrice(priceUsd) : '';
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
      const smPriceBaseline = Math.round(midY + SM_PRICE_SIZE * 0.35);
      if (priceRoll && priceRoll.progress > 0 && priceRoll.progress < 1) {
        drawRollingPrice(ctx, {
          fromText: fmtPrice(priceRoll.fromUsd), toText: fmtPrice(priceRoll.toUsd),
          font: `600 ${SM_PRICE_SIZE}px ${MONO}`, color: COLOR_WHITE,
          baseline: smPriceBaseline, capH: SM_PRICE_SIZE * 0.72, align: 'left', anchorX: priceX,
          progress: priceRoll.progress,
        });
      } else {
        ctx.fillText(priceText, priceX, smPriceBaseline);
      }
    }

    // Change — green + up arrow by default, red + down arrow when `down`.
    if (lifetimeChangePct != null) {
      const changeBaseline = Math.round(midY + SM_CHANGE_SIZE * 0.35);
      ctx.fillStyle = changeColor;
      const arrowCY  = changeBaseline - SM_CHANGE_SIZE * 0.35;
      const arrowTop = arrowCY - SM_ARROW_H / 2;
      // Respect arrowOpacity so the export's static sprite (baked at opacity 0)
      // omits this arrow and the per-frame triangleOnly pass animates it instead —
      // matching the large variant. Without this the small arrow bakes in solid
      // (never blinks) and the animated one lands elsewhere.
      ctx.globalAlpha = arrowOpacity;
      drawTriangle(ctx, arrowX, arrowTop, SM_ARROW_W, SM_ARROW_H, down);
      ctx.globalAlpha = 1;
      ctx.font = `500 ${SM_CHANGE_SIZE}px ${MONO}`;
      ctx.fillStyle = changeColor;
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
  const priceText   = priceUsd != null ? fmtPrice(priceUsd) : '';
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
    const sparkColor = changeColor;

    const sparkLeft  = priceRightEdge - priceColW - SPARK_MARGIN_R - SPARK_W;
    const sparkTop   = midY - SPARK_H / 2;
    const pad        = (2 / 32) * SPARK_H;

    // Single-point sparklines come back from the API for brand-new markets —
    // pad to two so we always have a line segment to draw. When `down`, reverse
    // the (net-rising) series so it reads as a believable decline instead.
    const rawVals = sparkline.map(p => p.value);
    const dirVals = down ? [...rawVals].reverse() : rawVals;
    const vals = dirVals.length === 1 ? [dirVals[0]!, dirVals[0]!] : dirVals;
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
    if (priceRoll && priceRoll.progress > 0 && priceRoll.progress < 1) {
      drawRollingPrice(ctx, {
        fromText: fmtPrice(priceRoll.fromUsd), toText: fmtPrice(priceRoll.toUsd),
        font: `600 ${PRICE_SIZE}px ${MONO}`, color: COLOR_WHITE,
        baseline: priceBaseline, capH: PRICE_CAP, align: 'right', anchorX: priceRightEdge,
        progress: priceRoll.progress,
      });
    } else {
      ctx.fillText(priceText, priceRightEdge - priceTextW, priceBaseline);
    }
  }

  if (lifetimeChangePct != null) {
    // Green + up arrow by default; red + down arrow when `down`. The displayed %
    // already uses Math.abs() above so the number stays unsigned either way.
    ctx.font = `500 ${CHANGE_SIZE}px ${MONO}`;
    ctx.fillStyle = changeColor;
    const aX     = priceRightEdge - ARROW_W - ARROW_GAP - changeTxtW;

    const arrowCY  = changeBaseline - CHANGE_SIZE * 0.35 + Math.round(1 * S);
    const arrowTop = arrowCY - ARROW_H / 2;

    ctx.globalAlpha = arrowOpacity;
    drawTriangle(ctx, aX, arrowTop, ARROW_W, ARROW_H, down);
    ctx.globalAlpha = 1;

    ctx.fillText(changeText, aX + ARROW_W + ARROW_GAP, changeBaseline);
  }

  drawLinkInBio();
}
