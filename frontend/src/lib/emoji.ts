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
  /** Pinned emojis sort to the very front of the picker. */
  pinned?: boolean;
}

// Curated set. Pinned: 😂 🔥 🤣 (the sideways/rolling laugh, reachable via @cry).
// Most are single-codepoint emoji, so the filename is just the unified hex — no
// variation selectors. The World Cup flags are the exception: they're two
// regional-indicator codepoints joined with a dash (e.g. 1f1e7-1f1f7.png), which
// matches the emoji-datasource-apple filename. The tokenizer sorts EMOJI_CHARS
// longest-first, so these multi-codepoint chars match before any prefix.
export const EMOJIS: EmojiDef[] = [
  { char: '😂', unified: '1f602', name: 'Face with Tears of Joy', keywords: ['laugh', 'haha', 'crying laughing', 'funny'], pinned: true },
  { char: '🔥', unified: '1f525', name: 'Fire', keywords: ['lit', 'hot', 'flame', 'fire'], pinned: true },
  // Sideways laughing — reachable by typing "@cry" (per request) as well as the
  // usual rofl/lmao terms. Pinned to the front of the picker.
  { char: '🤣', unified: '1f923', name: 'Rolling on the Floor Laughing', keywords: ['lol', 'cry', 'rofl', 'lmao', 'laugh', 'funny', 'sideways'], pinned: true },
  { char: '😀', unified: '1f600', name: 'Grinning Face', keywords: ['smile', 'happy', 'grin'] },
  { char: '😊', unified: '1f60a', name: 'Smiling Face with Smiling Eyes', keywords: ['smile', 'happy', 'blush', 'warm'] },
  { char: '😅', unified: '1f605', name: 'Grinning Face with Sweat', keywords: ['nervous', 'sweat', 'phew', 'laugh'] },
  { char: '😉', unified: '1f609', name: 'Winking Face', keywords: ['wink', 'flirt', 'joke'] },
  { char: '😏', unified: '1f60f', name: 'Smirking Face', keywords: ['smirk', 'smug', 'sly'] },
  { char: '😍', unified: '1f60d', name: 'Smiling Face with Heart-Eyes', keywords: ['love', 'heart', 'crush', 'adore'] },
  { char: '🤩', unified: '1f929', name: 'Star-Struck', keywords: ['starstruck', 'amazed', 'wow', 'excited'] },
  { char: '😎', unified: '1f60e', name: 'Smiling Face with Sunglasses', keywords: ['cool', 'sunglasses', 'chill'] },
  { char: '🥳', unified: '1f973', name: 'Partying Face', keywords: ['party', 'celebrate', 'birthday'] },
  { char: '🥺', unified: '1f97a', name: 'Pleading Face', keywords: ['plead', 'puppy', 'please', 'beg', 'cute'] },
  { char: '😭', unified: '1f62d', name: 'Loudly Crying Face', keywords: ['cry', 'sob', 'sad', 'tears'] },
  { char: '😤', unified: '1f624', name: 'Face with Steam From Nose', keywords: ['triumph', 'steam', 'mad', 'determined'] },
  { char: '🙄', unified: '1f644', name: 'Face with Rolling Eyes', keywords: ['eyeroll', 'whatever', 'annoyed', 'ugh'] },
  { char: '😱', unified: '1f631', name: 'Face Screaming in Fear', keywords: ['scream', 'shock', 'omg', 'scared'] },
  { char: '🤯', unified: '1f92f', name: 'Exploding Head', keywords: ['mind blown', 'shocked', 'wow', 'omg'] },
  { char: '😲', unified: '1f632', name: 'Astonished Face', keywords: ['shocked', 'shock', 'astonished', 'gasp', 'surprised', 'wow'] },
  { char: '🫤', unified: '1fae4', name: 'Face with Diagonal Mouth', keywords: ['side eye', 'side eyes', 'skeptical', 'unamused', 'meh', 'unsure'] },
  { char: '😔', unified: '1f614', name: 'Pensive Face', keywords: ['disappointed', 'looking down', 'sad', 'dejected', 'down', 'pensive'] },
  { char: '😩', unified: '1f629', name: 'Weary Face', keywords: ['moan', 'moaning', 'open mouth', 'weary', 'ugh', 'frustrated'] },
  { char: '🤔', unified: '1f914', name: 'Thinking Face', keywords: ['think', 'hmm', 'consider'] },
  { char: '🤡', unified: '1f921', name: 'Clown Face', keywords: ['clown', 'joke', 'fool', 'silly'] },
  { char: '💀', unified: '1f480', name: 'Skull', keywords: ['dead', 'dying', 'lol', 'skull'] },
  { char: '👀', unified: '1f440', name: 'Eyes', keywords: ['look', 'watching', 'eyes', 'shifty'] },
  { char: '🙏', unified: '1f64f', name: 'Folded Hands', keywords: ['pray', 'thanks', 'please', 'hope'] },
  { char: '💪', unified: '1f4aa', name: 'Flexed Biceps', keywords: ['strong', 'muscle', 'flex', 'gym'] },
  { char: '👏', unified: '1f44f', name: 'Clapping Hands', keywords: ['clap', 'applause', 'bravo'] },
  { char: '🙌', unified: '1f64c', name: 'Raising Hands', keywords: ['praise', 'celebrate', 'hooray'] },
  { char: '👍', unified: '1f44d', name: 'Thumbs Up', keywords: ['yes', 'like', 'approve', 'good'] },
  { char: '👎', unified: '1f44e', name: 'Thumbs Down', keywords: ['no', 'dislike', 'bad', 'nope'] },
  { char: '🫡', unified: '1fae1', name: 'Saluting Face', keywords: ['salute', 'respect', 'yes sir', 'o7'] },
  { char: '🤝', unified: '1f91d', name: 'Handshake', keywords: ['deal', 'agree', 'partner', 'shake'] },
  { char: '🎉', unified: '1f389', name: 'Party Popper', keywords: ['party', 'celebrate', 'tada', 'congrats'] },
  { char: '🎯', unified: '1f3af', name: 'Direct Hit', keywords: ['target', 'bullseye', 'goal', 'accurate'] },
  { char: '💯', unified: '1f4af', name: 'Hundred Points', keywords: ['100', 'perfect', 'agree', 'facts'] },
  { char: '✅', unified: '2705', name: 'Check Mark Button', keywords: ['check', 'yes', 'done', 'correct'] },
  { char: '❌', unified: '274c', name: 'Cross Mark', keywords: ['x', 'no', 'wrong', 'cancel'] },
  { char: '⭐', unified: '2b50', name: 'Star', keywords: ['star', 'favorite', 'rating'] },
  { char: '🚀', unified: '1f680', name: 'Rocket', keywords: ['moon', 'launch', 'fast', 'rocket'] },
  { char: '📈', unified: '1f4c8', name: 'Chart Increasing', keywords: ['up', 'stocks', 'growth', 'gains', 'trade'] },
  { char: '📉', unified: '1f4c9', name: 'Chart Decreasing', keywords: ['down', 'loss', 'drop', 'dip', 'crash'] },
  { char: '💰', unified: '1f4b0', name: 'Money Bag', keywords: ['money', 'cash', 'rich', 'profit'] },
  { char: '💸', unified: '1f4b8', name: 'Money with Wings', keywords: ['money', 'spend', 'loss', 'cash', 'fly'] },
  { char: '🤑', unified: '1f911', name: 'Money-Mouth Face', keywords: ['money', 'rich', 'profit', 'greedy'] },
  { char: '💎', unified: '1f48e', name: 'Gem Stone', keywords: ['diamond', 'hands', 'hold', 'gem', 'value'] },
  { char: '🐂', unified: '1f402', name: 'Ox', keywords: ['bull', 'bullish', 'market', 'up'] },
  { char: '🐻', unified: '1f43b', name: 'Bear', keywords: ['bear', 'bearish', 'market', 'down'] },
  { char: '🗽', unified: '1f5fd', name: 'Statue of Liberty', keywords: ['statue of liberty', 'nyc', 'new york', 'america', 'usa', 'liberty'] },
  { char: '🍎', unified: '1f34e', name: 'Red Apple', keywords: ['apple', 'fruit', 'red'] },
  { char: '🧊', unified: '1f9ca', name: 'Ice', keywords: ['ice', 'ice cube', 'icecube', 'cold', 'frozen'] },
  { char: '🍆', unified: '1f346', name: 'Eggplant', keywords: ['eggplant', 'aubergine', 'veggie'] },
  { char: '💦', unified: '1f4a6', name: 'Sweat Droplets', keywords: ['squirt', 'splash', 'water', 'sweat', 'wet'] },
  { char: '⚡', unified: '26a1', name: 'High Voltage', keywords: ['lightning', 'energy', 'fast', 'power'] },
  { char: '🎤', unified: '1f3a4', name: 'Microphone', keywords: ['mic', 'sing', 'karaoke', 'podcast', 'announce'] },
  // Speaking head — reachable by typing "@speak" (and "@yap"). Multi-codepoint
  // (head + FE0F variation selector), so the filename carries the dash, like the
  // flags above; the longest-first tokenizer matches it before any prefix.
  { char: '🗣️', unified: '1f5e3-fe0f', name: 'Speaking Head', keywords: ['speak', 'speaking', 'talk', 'talking', 'yap', 'yapping', 'announce', 'rant', 'loud'] },
  // World Cup — big footballing nations.
  { char: '🇧🇷', unified: '1f1e7-1f1f7', name: 'Brazil', keywords: ['brazil', 'brasil', 'flag', 'world cup'] },
  { char: '🇦🇷', unified: '1f1e6-1f1f7', name: 'Argentina', keywords: ['argentina', 'flag', 'world cup'] },
  { char: '🇫🇷', unified: '1f1eb-1f1f7', name: 'France', keywords: ['france', 'french', 'flag', 'world cup'] },
  { char: '🇩🇪', unified: '1f1e9-1f1ea', name: 'Germany', keywords: ['germany', 'german', 'deutschland', 'flag', 'world cup'] },
  { char: '🇪🇸', unified: '1f1ea-1f1f8', name: 'Spain', keywords: ['spain', 'spanish', 'espana', 'flag', 'world cup'] },
  { char: '🇵🇹', unified: '1f1f5-1f1f9', name: 'Portugal', keywords: ['portugal', 'portuguese', 'flag', 'world cup'] },
  { char: '🇳🇱', unified: '1f1f3-1f1f1', name: 'Netherlands', keywords: ['netherlands', 'holland', 'dutch', 'flag', 'world cup'] },
  { char: '🇮🇹', unified: '1f1ee-1f1f9', name: 'Italy', keywords: ['italy', 'italian', 'italia', 'flag', 'world cup'] },
  { char: '🇺🇸', unified: '1f1fa-1f1f8', name: 'United States', keywords: ['usa', 'united states', 'america', 'flag', 'world cup'] },
  { char: '🇲🇽', unified: '1f1f2-1f1fd', name: 'Mexico', keywords: ['mexico', 'mexican', 'flag', 'world cup'] },
];

export const emojiSrc = (unified: string) => `/emoji/${unified}.png`;

const CHAR_TO_UNIFIED = new Map(EMOJIS.map(e => [e.char, e.unified]));

/** Apple PNG url for a literal emoji char, or null if it's not in the set. */
export function emojiSrcForChar(char: string): string | null {
  const u = CHAR_TO_UNIFIED.get(char);
  return u ? emojiSrc(u) : null;
}
// Longest-first so multi-codepoint chars (none today, but future-proof) match
// before any prefix.
const EMOJI_CHARS = EMOJIS.map(e => e.char).sort((a, b) => b.length - a.length);

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

/** Kick off loading every curated emoji image. Returns a promise that resolves
 *  once they're all settled — await it before an export so frames aren't drawn
 *  with missing emoji. */
export function preloadEmojiImages(): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return Promise.all(EMOJIS.map(e => new Promise<void>(resolve => {
    const img = getEmojiImage(e.char);
    if (!img || (img.complete && img.naturalWidth > 0)) return resolve();
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  }))).then(() => undefined);
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
    for (const ch of EMOJI_CHARS) {
      if (str.startsWith(ch, i)) { matched = ch; break; }
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
