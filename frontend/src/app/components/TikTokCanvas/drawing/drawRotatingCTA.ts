import type { MutableRefObject } from 'react';
import type { MarketData } from '../types';
import { drawMarketRow, ctaContentBox } from './drawMarketRow';

// ── Two-CTA rotation ────────────────────────────────────────────────────────
// When an entry has a second person, the CTA holds person A for ROTATE_INTERVAL
// seconds, then BLINKS to person B — a quick fade-out to black and fade-in of the
// next card (no fold, no slide) — holds B, blinks back, forever. Same treatment
// for the large and small CTA. Only the person card blinks; the "pauv.com to
// trade" line drawn beneath it stays put.
export const ROTATE_INTERVAL = 6;    // seconds each person is held
export const ROTATE_TRANS    = 0.3;  // seconds the blink takes (fade out + fade in)

// Mid-hold price "roll": halfway through each person's hold the price ticks up by
// PRICE_BUMP dollars with a quick odometer roll. Purely a visual flourish.
const ROLL_AT    = ROTATE_INTERVAL / 2; // seconds into a hold when the price ticks
const ROLL_DUR   = 0.28;                // seconds the roll animation lasts (snappy)
const PRICE_BUMP = 0.12;                // dollars the price climbs by

interface CardRefs {
  img: MutableRefObject<HTMLImageElement | null>;
  url: MutableRefObject<string | null>;
}

export interface RotatingCTAOptions {
  ctx: CanvasRenderingContext2D;
  cx: number;
  cw: number;
  videoBottomY: number;
  /** Time in SECONDS — performance.now()/1000 for the live preview, the frame
   *  timestamp for the deterministic export. Drives the blink phase. */
  t: number;
  arrowOpacity: number;
  primary: MarketData;
  alt: MarketData;
  primaryRefs: CardRefs;
  altRefs: CardRefs;
  pauvLogoImgRef?: MutableRefObject<HTMLImageElement | null>;
}

export function drawRotatingCTA(opts: RotatingCTAOptions): void {
  const { ctx, cx, cw, videoBottomY, t, arrowOpacity, primary, alt, primaryRefs, altRefs, pauvLogoImgRef } = opts;

  const size = primary.size ?? 'large';

  const cardOpts = (data: MarketData, refs: CardRefs) => ({
    cx, videoBottomY, cw,
    name: data.name,
    subtitle: data.industry ?? data.subcategory ?? '—',
    photo_url: data.photo_url,
    priceUsd: data.price.usd,
    lifetimeChangePct: data.price.lifetimeChangePct,
    sparkline: data.sparkline,
    size, ctaCategory: data.ctaCategory, down: data.down,
    avatarImgRef: refs.img, lastPhotoUrlRef: refs.url, pauvLogoImgRef,
    arrowOpacity,
  });

  type Roll = { priceUsd: number | null; priceRoll?: { fromUsd: number; toUsd: number; progress: number } };

  const drawFull = (data: MarketData, refs: CardRefs, roll?: Roll) =>
    drawMarketRow({ ctx, ...cardOpts(data, refs), ...(roll ?? {}) });

  // The price each held person shows `localPh` seconds into their hold: flat at
  // the base, then a quick roll up to base+BUMP at the midpoint, settled after.
  const addBump = (v: number | null) => (v == null ? null : v + PRICE_BUMP);
  const rollFor = (localPh: number, base: number | null): Roll => {
    if (base == null) return { priceUsd: null };
    const progress = Math.max(0, Math.min(1, (localPh - ROLL_AT) / ROLL_DUR));
    if (progress <= 0) return { priceUsd: base };
    if (progress >= 1) return { priceUsd: base + PRICE_BUMP };
    return { priceUsd: base + PRICE_BUMP, priceRoll: { fromUsd: base, toUsd: base + PRICE_BUMP, progress } };
  };

  // Bio has no person card and both people share the identical tagline, so there
  // is nothing to blink — just draw the primary. (CanvasGrid also withholds the
  // alt for bio, so this is only a defensive fallback.)
  if (size === 'bio') { drawFull(primary, primaryRefs); return; }

  // The card region the black blink covers: the pill (large) or the tight content
  // band (small). Rounded so the cover matches the card's corners over the video.
  const box    = ctaContentBox(cx, cw, videoBottomY, size);
  const coverR = Math.round(box.h * 0.2);

  const cycle = 2 * ROTATE_INTERVAL;
  let ph = t % cycle;
  if (ph < 0) ph += cycle;

  // Hold A → blink A→B → hold B → blink B→A. By the time a person blinks away
  // their price has already settled at base+BUMP; the incoming person enters at
  // their own base (the swap happens under the black cover, so the reset is hidden).
  if (ph < ROTATE_INTERVAL - ROTATE_TRANS) {
    drawFull(primary, primaryRefs, rollFor(ph, primary.price.usd));
  } else if (ph < ROTATE_INTERVAL) {
    blink(primary, primaryRefs, addBump(primary.price.usd),
          alt, altRefs, alt.price.usd,
          (ph - (ROTATE_INTERVAL - ROTATE_TRANS)) / ROTATE_TRANS);
  } else if (ph < cycle - ROTATE_TRANS) {
    drawFull(alt, altRefs, rollFor(ph - ROTATE_INTERVAL, alt.price.usd));
  } else {
    blink(alt, altRefs, addBump(alt.price.usd),
          primary, primaryRefs, primary.price.usd,
          (ph - (cycle - ROTATE_TRANS)) / ROTATE_TRANS);
  }

  // A quick fade-through-black blink: the first half shows the outgoing card while
  // a black cover ramps UP over it; the second half shows the incoming card while
  // the cover ramps back DOWN. At the midpoint the card region is solid black.
  function blink(
    fromData: MarketData, fromRefs: CardRefs, fromPrice: number | null,
    toData: MarketData, toRefs: CardRefs, toPrice: number | null, pRaw: number,
  ) {
    const p = Math.max(0, Math.min(1, pRaw));
    const showFrom = p < 0.5;
    drawFull(showFrom ? fromData : toData, showFrom ? fromRefs : toRefs,
             { priceUsd: showFrom ? fromPrice : toPrice });

    const cover = showFrom ? p / 0.5 : 1 - (p - 0.5) / 0.5;   // 0 → 1 → 0
    if (cover <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = Math.min(1, cover);
    ctx.fillStyle = '#000';
    const { x, top: y, w, h } = box;
    const r = coverR;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
