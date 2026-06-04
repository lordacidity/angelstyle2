import {
  CANVAS_W, HEADER_PADDING_X, CAPTION_LINE_HEIGHT,
  PAUV_CAPTION_MAX_W, PAUV_CAPTION_FONT,
} from '../constants';
import { wrapRichText } from '@/lib/emoji';

const CLEAN_FONT = '400 42px Chirp, "Comic Sans MS", cursive';
const CLEAN_MAX_W = CANVAS_W - (HEADER_PADDING_X + 43) * 2;

// Caption glyphs are 42px; emoji are rendered as ~1em square images, so the
// line counter must measure them at the same size the renderers draw them.
export const CAPTION_EMOJI_SIZE = 42;
export const PAUV_CAP_FONT = `400 42px ${PAUV_CAPTION_FONT}`;

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

export function countPauvCaptionLines(
  ctx: CanvasRenderingContext2D,
  overlayCaption: string,
): number {
  return countCaptionLines(ctx, overlayCaption, PAUV_CAP_FONT, PAUV_CAPTION_MAX_W);
}
