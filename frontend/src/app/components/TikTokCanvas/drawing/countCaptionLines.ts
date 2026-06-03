import {
  CANVAS_W, HEADER_PADDING_X, CAPTION_LINE_HEIGHT,
  SONOTRADE_CAPTION_MAX_W, SONOTRADE_CAPTION_FONT,
} from '../constants';
import { wrapRichText } from '@/lib/emoji';

const CLEAN_FONT = '400 42px Chirp, "Comic Sans MS", cursive';
const CLEAN_MAX_W = CANVAS_W - (HEADER_PADDING_X + 43) * 2;

// Caption glyphs are 42px; emoji are rendered as ~1em square images, so the
// line counter must measure them at the same size the renderers draw them.
export const CAPTION_EMOJI_SIZE = 42;
export const SONOTRADE_CAP_FONT = `400 42px ${SONOTRADE_CAPTION_FONT}`;

export function countCaptionLines(
  ctx: CanvasRenderingContext2D,
  overlayCaption: string,
  font = CLEAN_FONT,
  maxWidth = CLEAN_MAX_W,
  emojiSize = CAPTION_EMOJI_SIZE,
): number {
  if (!overlayCaption) return 0;
  ctx.font = font;
  return wrapRichText(ctx, overlayCaption, maxWidth, emojiSize).length;
}

export function countSonotradeCaptionLines(
  ctx: CanvasRenderingContext2D,
  overlayCaption: string,
): number {
  return countCaptionLines(ctx, overlayCaption, SONOTRADE_CAP_FONT, SONOTRADE_CAPTION_MAX_W);
}
