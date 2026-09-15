// The "Newly listed" card — announces that someone just went live on Pauv:
// photo · wordmark + dateline · NEW LISTING lockup · name · starting price ·
// call to action. No chart, no volume, no holders: a fresh market has none,
// and a flat line or a zero would only make the card look empty. The frame
// (photo column, hairline, header, footnote) is ./card.ts.
//
// The lockup is the card's one colour. The price is deliberately NOT tinted:
// it is a price, not a return, and a green number would read as a gain that
// has not happened.

import { formatUsd } from './render';
import {
  beginCard, endCard, drawFootnote, drawHero, drawLockup, drawName, formatCardDate,
  type CardChrome,
} from './card';

export interface ListedCardData extends Omit<CardChrome, 'headerRight'> {
  name: string;
  /** Starting price in USD (markets.p0). null → an em dash. */
  startUsd: number | null;
  /** When they went live (profiles.created_at), epoch ms. null → no dateline. */
  listedAt: number | null;
  /** Footnote call to action, left of the profile URL. Blank → omitted. */
  cta: string;
  /** Bare "pauv.com/profile/<ticker>" — the same text the download copies. */
  profileUrl: string;
}

// Baselines, top → bottom. The app's 1200×700 share card's rhythm, opened up
// by this card's extra 100 of height, so the two read as one family when
// they land next to each other in a timeline.
const LOCKUP_BASELINE = 276;
const NAME_BASELINE = 392;
const HERO_BASELINE = 512;
const CAPTION_BASELINE = 556;

/**
 * Four-point sparkle, drawn to the lucide construction: concave sides pulled
 * toward the centre are what make it read as a sparkle rather than a diamond.
 */
function drawSparkle(ctx: CanvasRenderingContext2D, x: number, cy: number, size: number, color: string) {
  const r = size / 2;
  const cx = x + r;
  const k = r * 0.2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
  ctx.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
  ctx.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
  ctx.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draws the card. Expects ctx.canvas to be CARD_W×CARD_H times any uniform scale. */
export function drawListedCard(ctx: CanvasRenderingContext2D, d: ListedCardData) {
  const f = beginCard(ctx, {
    theme: d.theme,
    photo: d.photo,
    logo: d.logo,
    headerRight: d.listedAt != null ? `Listed ${formatCardDate(d.listedAt)}` : null,
  });
  drawLockup(f, 'NEW LISTING', LOCKUP_BASELINE, f.C.up, drawSparkle);
  drawName(f, d.name, NAME_BASELINE);
  drawHero(f, d.startUsd != null ? formatUsd(d.startUsd) : '—', f.C.primary, HERO_BASELINE, 104, 'STARTING PRICE', CAPTION_BASELINE);
  drawFootnote(f, d.cta, d.profileUrl);
  endCard(f);
}
