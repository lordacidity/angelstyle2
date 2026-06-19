import {
  BASE_HEADER_HEIGHT,
  CAPTION_LINE_HEIGHT,
  CAPTION_TOP_PADDING,
  PAUV_PADDING_X,
  HEADER_PADDING_TOP,
  PAUV_AVATAR_SIZE,
  PAUV_TEXT_X,
  PAUV_CAPTION_MAX_W,
  VERIFIED_TICK_SVG,
} from '../constants';
import type { DrawHeaderOptions } from '../types';
import { countPauvCaptionLines, PAUV_CAP_FONT, CAPTION_EMOJI_SIZE } from './countCaptionLines';
import { wrapRichText, drawRichLine } from '@/lib/emoji';

const CHIRP = 'Chirp, "Twitter Chirp", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// Slightly squarer than X's shape-square-rx-16 (was 16px on 108px)
const AVATAR_SIZE = PAUV_AVATAR_SIZE;           // 108
const AVATAR_RADIUS = 10;
const TEXT_X_OFFSET = PAUV_TEXT_X;              // 201 from canvas left

// Supersample the rounded avatar 3× then draw it down, so the corners and logo
// stay crisp (a raw canvas clip leaves jagged corners; downscaling anti-aliases).
const AVATAR_SS = 3;

// The brand "p" mark (pauv-p.png) is a black "p" on white. Paint a flat brand-gold
// background and composite the "p" with 'multiply' (white → gold, black "p" →
// black) instead of treating it as a photo — a flat fill has no banding and
// compresses cleanly, so the avatar stays crisp through the video encoder.
const BRAND_P_LOGO = 'pauv-p.png';
const BRAND_BG = '#E5C68D';

const roundedAvatarCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

function getRoundedAvatar(logo: HTMLImageElement): HTMLCanvasElement {
  const cached = roundedAvatarCache.get(logo);
  const dim = AVATAR_SIZE * AVATAR_SS;
  if (cached && cached.width === dim) return cached;

  const c = document.createElement('canvas');
  c.width = dim;
  c.height = dim;
  const octx = c.getContext('2d')!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  octx.beginPath();
  octx.roundRect(0, 0, dim, dim, AVATAR_RADIUS * AVATAR_SS);
  octx.clip();

  // object-fit: cover — scale to fill, crop center
  const iw = logo.naturalWidth;
  const ih = logo.naturalHeight;
  const scale = Math.max(dim / iw, dim / ih);
  const sw = dim / scale;
  const sh = dim / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;

  if (logo.src.includes(BRAND_P_LOGO)) {
    octx.fillStyle = BRAND_BG;
    octx.fillRect(0, 0, dim, dim);
    octx.globalCompositeOperation = 'multiply';
    octx.drawImage(logo, sx, sy, sw, sh, 0, 0, dim, dim);
    octx.globalCompositeOperation = 'source-over';
  } else {
    octx.drawImage(logo, sx, sy, sw, sh, 0, 0, dim, dim);
  }

  roundedAvatarCache.set(logo, c);
  return c;
}

// Scaled from Twitter's 15px @ ~390px content width → 1080px canvas
const NAME_SIZE = 42;
const HANDLE_SIZE = 40;
// Baseline gap between name and handle rows (tight like Twitter)
const NAME_HANDLE_LINE_H = 52;

// Tweet body (caption): same size as display name
const CAP_SIZE = 42;
// Gap from handle baseline to first caption line top
const CAP_GAP = 24;

export function drawHeaderOnContext({
  ctx,
  cx,
  cy,
  cw,
  overlayCaption,
  overlayLogoSrc,
  overlayDisplayName,
  overlayHandle,
  overlayVerified,
  logoImgRef,
  verifiedImgRef,
}: DrawHeaderOptions): number {
  const captionLines = countPauvCaptionLines(ctx, overlayCaption);
  // Trims dead space below the caption so the video sits as close under it as the
  // caption sits under the logo row (~16px). Must match index.tsx computeHeaderHeight.
  const CAPTION_BOTTOM_OFFSET = 35;
  const headerHeight = overlayCaption
    ? BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - CAPTION_BOTTOM_OFFSET
    : BASE_HEADER_HEIGHT;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.fillRect(cx, cy, cw, headerHeight);

  // ── Avatar ──────────────────────────────────────────────────────────────────
  const avatarX = cx + PAUV_PADDING_X;
  const avatarY = cy + HEADER_PADDING_TOP;

  let logo = logoImgRef.current;
  if (!logo) {
    logo = new Image();
    logo.crossOrigin = 'anonymous';
    logo.src = overlayLogoSrc;
    logoImgRef.current = logo;
  }

  if (logo.complete && logo.naturalWidth > 0) {
    const prevSmooth = ctx.imageSmoothingEnabled;
    const prevQuality = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(getRoundedAvatar(logo), avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    ctx.imageSmoothingEnabled = prevSmooth;
    ctx.imageSmoothingQuality = prevQuality;
  }

  // ── Right column: Name + Handle (stacked, vertically centered in avatar) ────
  const blockH = NAME_SIZE + (NAME_HANDLE_LINE_H - NAME_SIZE) + HANDLE_SIZE;
  const blockTop = avatarY + (AVATAR_SIZE - blockH) / 2;

  const nameBaseline = blockTop + NAME_SIZE;
  const handleBaseline = nameBaseline + (NAME_HANDLE_LINE_H - NAME_SIZE) + HANDLE_SIZE;

  // Display name — 700 weight, near-white
  ctx.font = `700 ${NAME_SIZE}px ${CHIRP}`;
  ctx.fillStyle = 'rgb(231, 233, 234)';
  ctx.fillText(overlayDisplayName, TEXT_X_OFFSET, nameBaseline);
  const nameWidth = ctx.measureText(overlayDisplayName).width;

  // Gold verified badge — inline immediately after name, centered on cap-height
  if (overlayVerified) {
    const BADGE = 34;
    const badgeX = TEXT_X_OFFSET + nameWidth + 6;
    // Cap-height ≈ 70% of font size; center badge on that visual midpoint
    const capMid = nameBaseline - Math.round(NAME_SIZE * 0.35);
    const badgeY = capMid - BADGE / 2;
    let img = verifiedImgRef.current;
    if (!img) {
      img = new Image();
      img.src = `data:image/svg+xml;utf8,${encodeURIComponent(VERIFIED_TICK_SVG)}`;
      verifiedImgRef.current = img;
    }
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, badgeX, badgeY, BADGE, BADGE);
    }
  }

  // @handle — 400 weight, gray
  ctx.font = `400 ${HANDLE_SIZE}px ${CHIRP}`;
  ctx.fillStyle = 'rgb(113, 118, 123)';
  ctx.fillText(overlayHandle, TEXT_X_OFFSET, handleBaseline);

  // ── Tweet body (caption) — full width, starts at avatar left edge ──────────
  if (overlayCaption) {
    const captionX = cx + PAUV_PADDING_X;
    const captionBaseline = handleBaseline + CAP_GAP + CAP_SIZE;

    ctx.font = PAUV_CAP_FONT;
    ctx.fillStyle = 'rgb(231, 233, 234)';

    let y = captionBaseline;
    for (const line of wrapRichText(ctx, overlayCaption, PAUV_CAPTION_MAX_W, CAPTION_EMOJI_SIZE)) {
      drawRichLine(ctx, line, captionX, y, CAPTION_EMOJI_SIZE);
      y += CAPTION_LINE_HEIGHT;
    }
  }

  return headerHeight;
}
