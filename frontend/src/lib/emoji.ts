// Apple-style emoji support, shared by the caption picker (CanvasGrid) and the
// canvas caption renderers (drawHeader / clean template / export pipeline).
//
// Why images instead of native glyphs: the caption is painted with ctx.fillText,
// so on Windows it would render as Segoe (blob) emoji in the exported video. To
// guarantee Apple glyphs on every OS we draw the Apple PNGs (bundled under
// /public/emoji, 64px from emoji-datasource-apple) onto the canvas ourselves.

export interface EmojiDef {
  /** The literal unicode character inserted into the caption text. */
  char: string;
  /** Lowercase hex codepoint(s) — matches the PNG filename in /public/emoji. */
  unified: string;
  /** Primary label, shown as the title in the picker. */
  name: string;
  /** Extra search terms. */
  keywords: string[];
  /** Unicode group ("Smileys & Emotion", "Flags", …) — used to section the
   *  emoji manager. */
  category: string;
  /** Pinned emojis sort to the front of the picker. NOTE: pinning is no longer a
   *  static property — it's a user preference stored in Railway (see
   *  emoji-prefs-db / emoji-prefs-store). Kept optional only for back-compat. */
  pinned?: boolean;
}

// The full Apple emoji set (~1900 glyphs), generated from emoji-datasource-apple
// by scripts/gen-emoji.mjs into emoji-data.json. Each entry's PNG lives at
// /public/emoji/{unified}.png. Re-run the script to refresh the set.
//
// Pinning and per-emoji "@" aliases used to be hand-tuned here; they're now
// user-customizable and persisted to Railway, so the data file is pure glyph
// metadata. The tokenizer below buckets these chars by their first code unit so
// matching stays fast even at this size.
import EMOJI_DATA from './emoji-data.json';

export const EMOJIS: EmojiDef[] = EMOJI_DATA as EmojiDef[];

export const emojiSrc = (unified: string) => `/emoji/${unified}.png`;

const CHAR_TO_UNIFIED = new Map(EMOJIS.map(e => [e.char, e.unified]));
const UNIFIED_TO_EMOJI = new Map(EMOJIS.map(e => [e.unified, e]));

/** Apple PNG url for a literal emoji char, or null if it's not in the set. */
export function emojiSrcForChar(char: string): string | null {
  const u = CHAR_TO_UNIFIED.get(char);
  return u ? emojiSrc(u) : null;
}

/** Look up an emoji definition by its unified codepoint key. */
export function emojiByUnified(unified: string): EmojiDef | undefined {
  return UNIFIED_TO_EMOJI.get(unified);
}

// Tokenizer index: bucket every emoji char by its first UTF-16 code unit, each
// bucket sorted longest-first. With ~1900 glyphs a flat longest-first scan per
// caption character would be O(chars × 1900); bucketing cuts each lookup to the
// handful of emoji that share a leading code unit while preserving the
// longest-first match (so ZWJ sequences / flags win over their prefixes).
const EMOJI_BY_FIRST: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const e of EMOJIS) {
    const k = e.char[0];
    let arr = m.get(k);
    if (!arr) { arr = []; m.set(k, arr); }
    arr.push(e.char);
  }
  for (const arr of m.values()) arr.sort((a, b) => b.length - a.length);
  return m;
})();

// ── Image cache (browser only) ────────────────────────────────────────────────
const imgCache = new Map<string, HTMLImageElement>();

export function getEmojiImage(char: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const unified = CHAR_TO_UNIFIED.get(char);
  if (!unified) return null;
  let img = imgCache.get(unified);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = emojiSrc(unified);
    imgCache.set(unified, img);
  }
  return img;
}

function settleImages(chars: Iterable<string>): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return Promise.all([...chars].map(c => new Promise<void>(resolve => {
    const img = getEmojiImage(c);
    if (!img || (img.complete && img.naturalWidth > 0)) return resolve();
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  }))).then(() => undefined);
}

/** Preload just the emoji glyphs that actually appear in `text`. Await this
 *  before an export so those frames aren't drawn with a missing image (the full
 *  set is ~1900 PNGs, so preloading everything would be wasteful — captions only
 *  ever use a handful). */
export function preloadEmojiImagesForText(text: string): Promise<void> {
  if (!text) return Promise.resolve();
  const chars = new Set<string>();
  for (const tok of tokenize(text)) if (tok.t === 'e') chars.add(tok.v);
  return chars.size ? settleImages(chars) : Promise.resolve();
}

// ── Rich text (text + emoji) layout ────────────────────────────────────────────
// Emoji are drawn as square images ~1em tall, sitting on the text baseline. The
// advance is a touch wider than the box for breathing room. Both the line
// counter and the renderer go through these helpers so wrapping stays in sync.

type Token = { t: 's'; v: string } | { t: 'e'; v: string };

function tokenize(str: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let buf = '';
  while (i < str.length) {
    let matched: string | null = null;
    const candidates = EMOJI_BY_FIRST.get(str[i]);
    if (candidates) {
      for (const ch of candidates) {
        if (str.startsWith(ch, i)) { matched = ch; break; }
      }
    }
    if (matched) {
      if (buf) { tokens.push({ t: 's', v: buf }); buf = ''; }
      tokens.push({ t: 'e', v: matched });
      i += matched.length;
    } else {
      buf += str[i];
      i++;
    }
  }
  if (buf) tokens.push({ t: 's', v: buf });
  return tokens;
}

export type EmojiToken = { type: 'text'; value: string } | { type: 'emoji'; value: string };

/** Split a string into runs of plain text and known emoji — for rendering an
 *  Apple-emoji overlay in React (the caption editor). */
export function splitEmojiTokens(str: string): EmojiToken[] {
  return tokenize(str).map(t => t.t === 's'
    ? { type: 'text', value: t.v } as const
    : { type: 'emoji', value: t.v } as const);
}

const emojiAdvance = (size: number) => size * 1.1;

/** Width of a string segment with emoji measured as fixed-size boxes. Assumes
 *  ctx.font is already set to the text font. */
export function measureRichWidth(ctx: CanvasRenderingContext2D, str: string, emojiSize: number): number {
  let w = 0;
  for (const tok of tokenize(str)) {
    w += tok.t === 's' ? ctx.measureText(tok.v).width : emojiAdvance(emojiSize);
  }
  return w;
}

/** Greedy word-wrap that accounts for emoji width. Returns the visual lines as
 *  raw strings (re-tokenized at draw time). ctx.font must already be set. */
export function wrapRichText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  emojiSize: number,
): string[] {
  const out: string[] = [];
  const spaceW = ctx.measureText(' ').width;
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let cur = '';
    let curW = 0;
    for (const word of para.split(' ')) {
      const wordW = measureRichWidth(ctx, word, emojiSize);
      const addW = (cur ? spaceW : 0) + wordW;
      if (cur && curW + addW > maxWidth) {
        out.push(cur);
        cur = word;
        curW = wordW;
      } else {
        cur = cur ? `${cur} ${word}` : word;
        curW += addW;
      }
    }
    out.push(cur);
  }
  return out;
}

/** Draw one already-wrapped line at (x, baselineY), painting Apple emoji images
 *  inline. ctx.font / ctx.fillStyle must already be set for the text runs. */
export function drawRichLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  baselineY: number,
  emojiSize: number,
): void {
  let cursor = x;
  for (const tok of tokenize(line)) {
    if (tok.t === 's') {
      ctx.fillText(tok.v, cursor, baselineY);
      cursor += ctx.measureText(tok.v).width;
    } else {
      const adv = emojiAdvance(emojiSize);
      const img = getEmojiImage(tok.v);
      if (img && img.complete && img.naturalWidth > 0) {
        const left = cursor + (adv - emojiSize) / 2;
        const top = baselineY - emojiSize * 0.85;
        ctx.drawImage(img, left, top, emojiSize, emojiSize);
      } else {
        // Not loaded (or unknown) — fall back to the native glyph so text never
        // vanishes; it'll swap to the Apple image on the next frame once cached.
        ctx.fillText(tok.v, cursor, baselineY);
      }
      cursor += adv;
    }
  }
}
