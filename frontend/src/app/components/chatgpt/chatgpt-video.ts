// The ChatGPT lookalike's "screen recording", rendered here in the browser
// instead of captured off the screen. Every frame is drawn on a 1000×750
// screen from the same numbers as ChatGpt.module.css — laid down at twice that
// size (RENDER_SCALE), the way a retina display would, so the text is still
// crisp once the build shrinks it into the bottom half — a pointer is drawn
// on top, and the frames go through WebCodecs (via mediabunny) into an H.264
// MP4. Nothing depends on how fast the machine draws: the same inputs give the
// same file every time.
//
// ── This file is the source of truth for the recording ──────────────────────
// Three places render one, and all three render it from here:
//   Studio > ChatGPT      ChatGptSection, which downloads the file
//   Studio > Vids         the Bottom card, which files it under Bottom A
//   Studio > Simpler      the Bottom card, which keeps it in the tab instead
//                         (lib/simpler/vidsLocal) and lets it go afterwards
// So a change here is a change to all three, which is the point: there is no
// second copy to keep in step. What each one does with the finished file is
// its own business and lives in that caller, not in here.
//
// Which means this file may NOT import from a caller's namespace — nothing
// from components/vids, components/simpler or lib/simpler. Pointing a fourth
// thing at it must never drag one caller's fork into another's video.
//
// One seam is left, and it is worth knowing about: the six helpers below come
// from lib/vidsAudio, lib/vidsEdit and lib/vidsPlan (decodeAudio, scheduleLoop,
// SFX_URL, DEFAULT_SFX_GAIN, videoBitrate, smoothScaling). Those files are
// Vids' side of the Vids/Simpler split, so editing one of those six there does
// reach this renderer, and through it all three callers. They are identical in
// lib/simpler today and generic enough that this has never bitten; if it ever
// does, lift just those six into a neutral module and point this at that.
//
// The script, on a clock of about 8s (never less; a long question stretches
// it a little):
//   - the pointer drops in from the top, clicks the search bar and moves down
//     out of the way; the question types itself out fast, in a human rhythm,
//     over the app's keyboard sound; a pause to read it; Enter sends it (no
//     click on the arrow)
//   - the pulsing dot, then the shimmering "Searching the web"; the pointer
//     rips around in big, fast, uneven loops, annoyed at the wait
//   - the answer starts streaming and the pointer settles to the side; halfway
//     through, it drags across the chosen name (#1) to select it, a little
//     roughly (the space after the name comes along, as it would by hand), the
//     view slams in and out on it twice, and the pointer whips a few laps
//     around the name
//   - the pointer leaves out of the top; the finished answer holds to the end
//
// The file goes back with its three beats in clip seconds (ClipBeats) — the
// question going in, the wait, the pick — so whoever files it can mark it up
// the way a hand-cut recording is, and captions land on the moment.

import type { AudioCodec } from 'mediabunny';
import { safeExportName } from '@/lib/utils';
import { decodeAudio, scheduleLoop, SFX_URL } from '@/lib/vidsAudio';
import { DEFAULT_SFX_GAIN } from '@/lib/vidsEdit';
import { smoothScaling, videoBitrate } from '@/lib/vidsPlan';
import { drawPointer, loadPointers, type PointerKind } from '@/lib/windowsCursor';
import { askChatGpt, buildBlocks, totalLen, type Block, type Direction, type Reply } from './reply';

/** The screen, in CSS px: every number in `m` below is on this grid. */
export const VIDEO_W = 1000;
export const VIDEO_H = 750;
/** Device pixels per CSS px in the file — the file is VIDEO_W × RENDER_SCALE
 *  wide. The build draws the recording into a region about the screen's own
 *  size, so at 1 the 19px text went out at 19px and then through two H.264
 *  passes, which is what read as pixelated. At 2 it is drawn at the resolution
 *  of a good laptop screen and shrunk on the way into the build — the
 *  compression sits at half the size, and the letters keep their edges. */
export const RENDER_SCALE = 2;
/** The size of the file that actually comes out — what to show anyone who is
 *  told what they are about to get. VIDEO_W/VIDEO_H are the CSS grid the
 *  drawing is laid out on, which is not the same number any more. */
export const FILE_W = VIDEO_W * RENDER_SCALE;
export const FILE_H = VIDEO_H * RENDER_SCALE;
/** What a clip runs to, at least: the script is timed to land about here, and
 *  only a long question pushes past it. */
export const CLIP_SECONDS = 8;
const FPS = 30;
const MAX_ZOOM = 1.9;
const SAMPLE_RATE = 44100;
/** The poster's width — the card it is on is a few dozen px tall. */
const POSTER_W = 480;

/** The typing rhythm, in shares of the typing stretch rather than seconds:
 *  they are normalised to typeDur, so only their ratios to each other matter.
 *  A run is a few characters typed at one rate; between runs sits a pause. The
 *  distance between a fast character and a long pause is the whole effect —
 *  set them close together and the question appears all at once however the
 *  delays are shuffled. */
const TYPE_RHYTHM = {
  /** Characters in one run, from this many to this many. */
  run: [2, 7],
  /** Per character, ripping through — several land on the same frame. */
  fast: [0.15, 0.30],
  /** Per character, labouring — about one frame each. */
  slow: [0.90, 1.60],
  /** How much of the time a run is a fast one. */
  fastShare: 0.55,
  /** The stop between two runs: usually a catch of breath… */
  catch: [1.8, 3.2],
  /** …and now and then a proper think, which is the one you really see. */
  think: [5, 9],
  /** How often that stop is a think rather than a catch. */
  thinkShare: 0.3,
  /** On top of whatever else, after a comma or a full stop. */
  punctuation: 4,
} as const;

export interface RenderOptions {
  name: string;
  direction: Direction;
  question: string;
  reply: Reply;
  onProgress?: (done: number, total: number) => void;
  /** The clip as it will come out — its beats, its length, its size — the
   *  moment it is worked out, before the first frame is drawn. For whoever has
   *  something to start on those while the frames go. */
  onPlanned?: (p: ClipPlan) => void;
  signal?: AbortSignal;
}
/** Everything a render hands back that is known before it starts drawing. */
export type ClipPlan = Pick<RenderResult, 'beats' | 'pulseAt' | 'seconds' | 'width' | 'height'>;
/** A stretch of the clip, in clip seconds. */
export interface Stretch { start: number; end: number }
/** The three things the recording shows, in order, each with its stretch:
 *  the question typed and sent; the wait for the answer — the dot, the
 *  shimmer, the answer streaming in — up to the pointer going for the name;
 *  and the pick — the name dragged, the zoom, the laps — to the end. They
 *  abut, and together cover the whole clip. */
export interface ClipBeats { typing: Stretch; loading: Stretch; choosing: Stretch }
export interface RenderResult {
  blob: Blob;
  filename: string;
  beats: ClipBeats;
  /** The first of the hard in-out zoom pulses on the name, once it has been
   *  dragged over — clip seconds, inside `choosing`. */
  pulseAt: number;
  /** How long the file runs, in seconds — whole frames. */
  seconds: number;
  /** The file's size in pixels (the screen times RENDER_SCALE). */
  width: number;
  height: number;
  /** A frame out of the middle of the clip as a JPEG, for wherever the clip
   *  is shown as a card. Null if the browser wouldn't give one. */
  poster: Blob | null;
}

// ── Stylesheet numbers (ChatGpt.module.css, base rules: the stage is wider
// than its narrow-stage breakpoint) ──────────────────────────────────────────
const m = {
  rail: 72, railBtn: 44, railPadT: 12,
  headerH: 64, headerPadL: 12, headerPadR: 14,
  brandSize: 21, brandPadX: 12,
  authGap: 8, btnH: 44, btnPadX: 18, btnSize: 16,
  landingPadX: 20, landingPadB: 72, headingSize: 34, headingMB: 26,
  chipMT: 52, chipH: 46, chipPadX: 18, chipSize: 16,
  footerSize: 14, footerLH: 20, footerPadX: 20, footerPadY: 12,
  composerMax: 880, composerPadX: 10, composerPadY: 8, composerGap: 6, composerMinH: 64, composerRadius: 32,
  iconBtn: 44, inputSize: 19, inputLH: 28, inputPadX: 6, inputPadY: 8, disclaimerSize: 14,
  threadPadT: 12, threadPadX: 20, threadPadB: 28, threadMax: 880, threadGap: 32, threadInnerPT: 12,
  bubbleMax: 0.8, bubbleRadius: 26, bubblePadX: 22, bubblePadY: 12, bubbleSize: 19, bubbleLH: 30,
  asstSize: 19, asstLH: 32, asstPadX: 6, pMB: 18, ulPL: 30, ulMB: 18, liMB: 12, liPL: 6,
  actionsGap: 6, actionsMT: -2, actionsML: -8, actionBtn: 38, actionIcon: 21,
  loadingMinH: 32, dot: 14,
  bottomPadX: 20, bottomPadB: 14, bottomGap: 12,
  upsellGap: 14, upsellRadius: 32, upsellPadY: 12, upsellPadL: 22, upsellPadR: 12,
  upsellSize: 16, upsellLH: 22, upsellBtnH: 40,
};

const C = {
  bg: '#000', text: '#fff', prose: '#ececec', grey: '#9b9b9b', placeholder: '#8f8f8f',
  bubble: '#2a2a2a', pill: '#171717', pillBorder: '#2a2a2a', railBorder: '#1c1c1c', railIcon: '#d0d0d0', railLink: '#cfcfcf',
  icon: '#e3e3e3', sendOff: '#2f2f2f', sendOffIcon: '#7a7a7a', action: '#b4b4b4', chipBorder: '#353535', signupBorder: '#3a3a3a',
  shimmerBase: '#8a8a8a', shimmerBand: '#f4f4f4',
  // Chrome's text selection on a dark page.
  selection: 'rgba(56, 117, 232, 0.62)',
};

// The stylesheet's stack, spelled for canvas (system-ui is Segoe UI on Windows
// and San Francisco on a Mac; the emoji faces make sure the answers' emoji
// come out in colour).
const FAMILY = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';

type Ctx = CanvasRenderingContext2D;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
// Fast out of the gate, settling at the end: a snap.
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);

// ── Text: runs → wrapped lines, with the same character offsets as the answer ─
interface Style { weight?: 400 | 500 | 600; italic?: boolean; underline?: boolean; color?: string; name?: boolean }
interface Span { text: string; style: Style }
interface Seg { text: string; x: number; w: number; start: number; style: Style }
interface Line { segs: Seg[]; w: number }
interface TextBlock { lines: Line[]; size: number; lh: number }
interface Rect { x: number; y: number; w: number; h: number }

const font = (size: number, st: Style) => `${st.italic ? 'italic ' : ''}${st.weight ?? 400} ${size}px ${FAMILY}`;

// Greedy word wrap across styled spans. Offsets (`start`) count every
// character, so a reveal limit from the answer's streaming counter lands on
// the same character here as it does in the DOM. A partly revealed word
// already sits on its final line, so nothing jumps as the text grows.
function layout(ctx: Ctx, spans: Span[], size: number, lh: number, maxW: number): TextBlock {
  const lines: Line[] = [];
  let segs: Seg[] = [];
  let x = 0;
  let pos = 0;
  const endLine = () => { lines.push({ segs, w: x }); segs = []; x = 0; };
  for (const sp of spans) {
    ctx.font = font(size, sp.style);
    let text = '';
    let segX = 0;
    let segStart = pos;
    const commit = () => {
      if (text) segs.push({ text, x: segX, w: ctx.measureText(text.trimEnd()).width, start: segStart, style: sp.style });
    };
    for (const tok of sp.text.match(/\S+\s*|\s+/g) ?? []) {
      const w = ctx.measureText(tok).width;
      if (x + ctx.measureText(tok.trimEnd()).width > maxW && (segs.length || text)) {
        commit();
        endLine();
        text = '';
        segStart = pos;
      }
      if (!text) segX = x;
      text += tok;
      x += w;
      pos += tok.length;
    }
    commit();
  }
  endLine();
  return { lines, size, lh };
}

const lineInk = (ln: Line) => (ln.segs.length ? ln.segs[ln.segs.length - 1].x + ln.segs[ln.segs.length - 1].w : 0);
const blockH = (tb: TextBlock) => tb.lines.length * tb.lh;
// Lines that have at least one character within `limit` (the DOM grows line
// by line the same way).
const linesShown = (tb: TextBlock, limit: number) =>
  (limit <= 0 ? 0 : tb.lines.filter(l => !l.segs.length || l.segs[0].start < limit).length);

function drawText(
  ctx: Ctx, tb: TextBlock, x0: number, y0: number, color: string,
  opts: { limit?: number; align?: 'left' | 'center'; width?: number } = {},
) {
  const limit = opts.limit ?? Infinity;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  tb.lines.forEach((ln, i) => {
    const dx = opts.align === 'center' ? ((opts.width ?? 0) - lineInk(ln)) / 2 : 0;
    const cy = y0 + i * tb.lh + tb.lh / 2;
    for (const seg of ln.segs) {
      let n = Math.min(seg.text.length, limit - seg.start);
      if (n <= 0) continue;
      // Never cut an emoji in half for a frame.
      if (n < seg.text.length && /[\uD800-\uDBFF]/.test(seg.text[n - 1])) n--;
      if (n <= 0) continue;
      ctx.font = font(tb.size, seg.style);
      ctx.fillStyle = seg.style.color ?? color;
      ctx.fillText(n === seg.text.length ? seg.text : seg.text.slice(0, n), x0 + dx + seg.x, cy);
      if (seg.style.underline) ctx.fillRect(x0 + dx + seg.x, cy + tb.size * 0.5 + 1, seg.w, 1);
    }
  });
}

function segRects(tb: TextBlock, x0: number, y0: number, pred: (s: Style) => boolean): Rect[] {
  const out: Rect[] = [];
  const h = tb.size * 1.3;
  tb.lines.forEach((ln, i) => {
    for (const s of ln.segs) if (pred(s.style)) out.push({ x: x0 + s.x, y: y0 + i * tb.lh + (tb.lh - h) / 2, w: s.w, h });
  });
  return out;
}

// ── Icons: chatgpt.com's line icons, the same paths as the section's SVGs ───
type IconPath = (c: Ctx) => void;
const ICONS: Record<string, IconPath> = {
  panel: c => { c.roundRect(3, 4, 18, 16, 3); c.moveTo(9, 4); c.lineTo(9, 20); },
  chevron: c => { c.moveTo(6, 9); c.lineTo(12, 15); c.lineTo(18, 9); },
  plus: c => { c.moveTo(12, 5); c.lineTo(12, 19); c.moveTo(5, 12); c.lineTo(19, 12); },
  mic: c => {
    c.roundRect(9, 3, 6, 12, 3);
    c.moveTo(5, 11); c.arc(12, 11, 7, Math.PI, 0, true);
    c.moveTo(12, 18); c.lineTo(12, 21); c.moveTo(9, 21); c.lineTo(15, 21);
  },
  arrowUp: c => { c.moveTo(12, 19); c.lineTo(12, 5); c.moveTo(5, 12); c.lineTo(12, 5); c.lineTo(19, 12); },
  copy: c => { c.roundRect(9, 9, 11, 11, 2); c.moveTo(5, 15); c.lineTo(5, 6); c.quadraticCurveTo(5, 4, 7, 4); c.lineTo(16, 4); },
  share: c => {
    c.moveTo(12, 16); c.lineTo(12, 4); c.moveTo(7, 9); c.lineTo(12, 4); c.lineTo(17, 9);
    c.moveTo(4, 14); c.lineTo(4, 18); c.quadraticCurveTo(4, 20, 6, 20); c.lineTo(18, 20); c.quadraticCurveTo(20, 20, 20, 18); c.lineTo(20, 14);
  },
  extLink: c => {
    c.moveTo(14, 4); c.lineTo(20, 4); c.lineTo(20, 10); c.moveTo(20, 4); c.lineTo(11, 13);
    c.moveTo(19, 14); c.lineTo(19, 19); c.quadraticCurveTo(19, 20, 18, 20); c.lineTo(5, 20);
    c.quadraticCurveTo(4, 20, 4, 19); c.lineTo(4, 6); c.quadraticCurveTo(4, 5, 5, 5); c.lineTo(10, 5);
  },
};
// Strokes a 24-box icon path centred on (cx, cy) at `size` px.
function icon(ctx: Ctx, path: IconPath, cx: number, cy: number, size: number, color: string, width: number) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  path(ctx);
  ctx.stroke();
  ctx.restore();
}

// Deterministic "human" rhythm for the typing.
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The clip: everything precomputed once, then draw(t) per frame ───────────
interface Clip { draw: (t: number) => void; typing: Stretch; seconds: number; beats: ClipBeats; pulseAt: number }
function createClip(ctx: Ctx, o: RenderOptions): Clip {
  const W = VIDEO_W;
  const H = VIDEO_H;
  const question = o.question.trim();

  // ── Timeline ──────────────────────────────────────────────────────────────
  // Long enough for the rhythm to show. At 30fps a question typed in much
  // under two seconds is a character or more on every single frame from start
  // to finish, and no shuffling of the delays can read as anything but all at
  // once — there are no frames spare to put a pause in. See TYPE_RHYTHM.
  const typeDur = clamp(question.length * 0.045, 1.1, 3.4);
  const T_CLICK = 0.3;
  // A beat after the click before the first key lands.
  const T_TYPE = T_CLICK + 0.5;
  const T_TYPED = T_TYPE + typeDur;
  // A pause to read the question, then Enter.
  const T_SEND = T_TYPED + 0.9;
  const T_DOT_END = T_SEND + 0.5;
  const T_STREAM = T_SEND + 1.3;
  const T_STREAMED = T_STREAM + 2.8;
  const T_HALF = T_STREAM + 1.3;
  // Loops start right after Enter and stop a beat after the answer appears.
  const T_CIRCLE: [number, number] = [T_SEND + 0.15, T_STREAM + 0.3];
  // The drag across the name, then two hard in-out zoom pulses, then three
  // fast laps around the name, then out.
  const T_DRAG: [number, number] = [T_HALF, T_HALF + 0.35];
  const PULSE = 0.13;
  const T_PULSE = T_DRAG[1] + 0.08;
  const T_PULSED = T_PULSE + 4 * PULSE;
  const T_NAME_LOOP: [number, number] = [T_PULSED + 0.05, T_PULSED + 0.55];
  // Straight out of the last lap and off the top in a whip: three frames.
  const T_EXIT: [number, number] = [T_NAME_LOOP[1], T_NAME_LOOP[1] + 0.1];
  // About CLIP_SECONDS: never less, a little more when the script needs it,
  // with a beat on the finished answer at the end. Whole frames.
  const seconds = Math.max(CLIP_SECONDS, Math.ceil((Math.max(T_STREAMED, T_EXIT[1]) + 0.7) * FPS) / FPS);
  // The clip as three beats, for the marks it is filed with — see ClipBeats.
  const beats: ClipBeats = {
    typing: { start: 0, end: T_SEND },
    loading: { start: T_SEND, end: T_HALF },
    choosing: { start: T_HALF, end: seconds },
  };

  // When each typed character lands. Typing is runs and stops, not a rate:
  // three or four characters go down together, then nothing for a beat, then a
  // slower stretch, then nothing again. Jitter per key cannot produce that, and
  // neither can a tempo that drifts — both average out to a steady stream over
  // the handful of frames this takes. So the rhythm is built out of the two
  // things you can actually see: RUNS, a few characters at one rate, and the
  // PAUSES between them.
  //
  // Everything is drawn off the question's own seed, so the same question
  // always types the same way, and the shares are normalised to typeDur below
  // — which means the more the pauses take, the faster the runs have to be.
  // That is what makes a burst look like a burst.
  const rnd = mulberry32(hashStr(question));
  const pick = ([lo, hi]: readonly [number, number]) => lo + rnd() * (hi - lo);
  const weights: number[] = [];
  let left = 0;       // characters still to go in the run being typed
  let perChar = 0;    // what each of them costs
  for (let i = 0; i < question.length; i++) {
    const prev = question[i - 1];
    let w: number;
    if (left <= 0) {
      left = Math.round(pick(TYPE_RHYTHM.run));
      perChar = rnd() < TYPE_RHYTHM.fastShare ? pick(TYPE_RHYTHM.fast) : pick(TYPE_RHYTHM.slow);
      // The stop in front of the run. Nothing is stopped in front of the first
      // key — the hands are already there.
      w = perChar + (i === 0 ? 0 : pick(rnd() < TYPE_RHYTHM.thinkShare ? TYPE_RHYTHM.think : TYPE_RHYTHM.catch));
    } else {
      w = perChar;
    }
    // A comma or a full stop is a real stop wherever it falls, run or no run.
    if (prev && /[,.?!]/.test(prev)) w += TYPE_RHYTHM.punctuation;
    weights.push(w);
    left--;
  }
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const charAt: number[] = [];
  let acc = 0;
  for (const w of weights) { acc += w; charAt.push(T_TYPE + typeDur * (acc / weightSum)); }
  const typedCount = (t: number) => { let n = 0; while (n < charAt.length && charAt[n] <= t) n++; return n; };

  const blocks = buildBlocks(o.reply);
  const total = totalLen(blocks);
  const shownAt = (t: number) => (t < T_STREAM ? 0 : t >= T_STREAMED ? total : Math.floor(total * (t - T_STREAM) / (T_STREAMED - T_STREAM)));

  // ── Static layout ─────────────────────────────────────────────────────────
  // Chat mode: the main pane sits right of the rail.
  const mainX = m.rail;
  const mainW = W - m.rail;

  ctx.font = font(m.btnSize, { weight: 500 });
  const loginW = ctx.measureText('Log in').width + 2 * m.btnPadX;
  const signupW = ctx.measureText('Sign up for free').width + 2 * m.btnPadX;

  // Composer: same max width in both modes, different side gutters.
  const inputW = (cw: number) => cw - 2 * m.composerPadX - 3 * m.iconBtn - 3 * m.composerGap - 2 * m.inputPadX;
  const inputX = (cx: number) => cx + m.composerPadX + m.iconBtn + m.composerGap + m.inputPadX;
  const composerHFor = (lines: number) => Math.max(m.composerMinH, lines * m.inputLH + 2 * m.inputPadY + 2 * m.composerPadY);
  const cwL = Math.min(m.composerMax, W - 2 * m.landingPadX);
  const cxL = (W - cwL) / 2;
  const cwC = Math.min(m.composerMax, mainW - 2 * m.bottomPadX);
  const cxC = mainX + (mainW - cwC) / 2;
  const composerHChat = composerHFor(1);

  // Landing: heading, composer and chip as one block, centred in the space
  // under the header (minus the landing's bottom padding).
  const headingLH = Math.round(m.headingSize * 1.3);
  const landingGeom = (lines: number) => {
    const ch = composerHFor(lines);
    const block = headingLH + m.headingMB + ch + m.chipMT + m.chipH;
    const top = m.headerH + (H - m.headerH - m.landingPadB - block) / 2;
    return { headingY: top, composerY: top + headingLH + m.headingMB, composerH: ch, chipY: top + headingLH + m.headingMB + ch + m.chipMT };
  };
  const typedLayout = (n: number) => layout(ctx, [{ text: question.slice(0, n), style: {} }], m.inputSize, m.inputLH, inputW(cwL));
  const footerText = layout(ctx, [
    { text: 'ChatGPT is AI. By using it, you agree to our ', style: {} },
    { text: 'Terms', style: { underline: true } },
    { text: ' & ', style: {} },
    { text: 'Privacy Policy', style: { underline: true } },
    { text: '. Chats may be reviewed and used to improve our AI models. ', style: {} },
    { text: 'Learn more', style: { underline: true } },
  ], m.footerSize, m.footerLH, W - 2 * m.footerPadX);

  // Thread column.
  const colW = Math.min(m.threadMax, mainW - 2 * m.threadPadX);
  const colX = mainX + (mainW - colW) / 2;
  const bubbleText = layout(ctx, [{ text: question, style: {} }], m.bubbleSize, m.bubbleLH, m.bubbleMax * colW - 2 * m.bubblePadX);
  const bubbleW = Math.max(...bubbleText.lines.map(lineInk)) + 2 * m.bubblePadX;
  const bubbleH = blockH(bubbleText) + 2 * m.bubblePadY;
  const bubbleX = colX + colW - bubbleW;

  // The answer's blocks, laid out once; `y` is relative to the answer's top,
  // `mb` the margin under the block (a list item's, plus the list's after the
  // last item).
  interface Laid { block: Block; tb: TextBlock; x: number; y: number; mb: number }
  const laid: Laid[] = [];
  {
    let y = 0;
    blocks.forEach((b, i) => {
      const li = b.kind === 'li';
      const indent = li ? m.ulPL + m.liPL : 0;
      const spans: Span[] = b.runs.map(r => ({
        text: r.text,
        style: { weight: r.strong ? 600 : 400, italic: !!r.em, color: r.strong ? C.text : undefined, name: !!r.name },
      }));
      const tb = layout(ctx, spans, m.asstSize, m.asstLH, colW - 2 * m.asstPadX - indent);
      const mb = li ? m.liMB + (blocks[i + 1]?.kind === 'li' ? 0 : m.ulMB) : m.pMB;
      laid.push({ block: b, tb, x: colX + m.asstPadX + indent, y, mb });
      y += blockH(tb) + mb;
    });
  }
  const asstBodyH = (shown: number) => {
    let h = 0;
    for (const l of laid) {
      if (l.block.start >= shown) break;
      h = l.y + linesShown(l.tb, shown - l.block.start) * m.asstLH + l.mb;
    }
    return h;
  };
  // The chosen name is pick #1: the first list item's name run.
  const nameLaid = laid.find(l => l.block.kind === 'li') ?? null;
  const nameRects = nameLaid ? segRects(nameLaid.tb, nameLaid.x, nameLaid.y, s => !!s.name) : [];
  const nameRect: Rect = nameRects.length
    ? nameRects.reduce((a, r) => {
      const x = Math.min(a.x, r.x), y = Math.min(a.y, r.y);
      return { x, y, w: Math.max(a.x + a.w, r.x + r.w) - x, h: Math.max(a.y + a.h, r.y + r.h) - y };
    })
    : { x: colX + m.asstPadX, y: 0, w: 120, h: m.asstLH };

  // Bottom block (chat mode): the composer, and the upsell once answered.
  const UPSELL = 'You’ll get smarter responses and can upload files, images, and more.';
  const upsellW = cwC;
  const upsellBtnsW = loginW + 8 + signupW;
  const upsellText = layout(ctx, [{ text: UPSELL, style: {} }], m.upsellSize, m.upsellLH, upsellW - m.upsellPadL - m.upsellPadR - m.upsellGap - upsellBtnsW);
  const upsellH = m.upsellPadY * 2 + Math.max(blockH(upsellText), m.upsellBtnH);
  const bottomH = (done: boolean) => m.bottomPadB + composerHChat + (done ? m.bottomGap + upsellH : 0);

  // Thread geometry: content y is measured from the thread's top edge.
  const threadTop = m.headerH;
  const visibleH = (done: boolean) => H - bottomH(done) - threadTop;
  const innerTop = m.threadPadT + m.threadInnerPT;
  const asstTop = innerTop + bubbleH + m.threadGap;
  const contentH = (shown: number, done: boolean) => {
    const asst = shown > 0 ? asstBodyH(shown) + (done ? m.actionsMT + m.actionBtn : 0) : m.loadingMinH;
    return asstTop + asst + m.threadPadB;
  };
  // Pinned to the bottom as the answer grows, like the DOM, until the click
  // highlights the name: from then on the thread stays put.
  const autoScroll = (shown: number, done: boolean) => Math.max(0, contentH(shown, done) - visibleH(done));
  const nameTop = asstTop + nameRect.y;
  const frozenScroll = Math.min(autoScroll(shownAt(T_HALF), false), Math.max(0, nameTop - visibleH(false) * 0.3));
  const nameCY = threadTop + nameTop + nameRect.h / 2 - frozenScroll;

  // The drag-select. Character edges across the name plus the space after it:
  // a character joins the selection once the pointer passes its middle, the
  // way browsers do it, so the highlight grows a letter at a time under the
  // drag. The pointer lands just inside the first letter, a touch low, and
  // ends a few px past the space, short of the dash. The offsets follow the
  // name, so the same inputs still give the same file.
  const nameText = (o.reply.picks[0]?.name ?? '').trim();
  ctx.font = font(m.asstSize, { weight: 600 });
  const edges = Array.from({ length: nameText.length + 1 }, (_, i) => nameRect.x + ctx.measureText(nameText.slice(0, i)).width);
  ctx.font = font(m.asstSize, {});
  edges.push(edges[edges.length - 1] + ctx.measureText(' ').width);
  const selEnd = edges[edges.length - 1];
  const selectedTo = (px: number) => {
    let k = 0;
    while (k < edges.length - 1 && px >= (edges[k] + edges[k + 1]) / 2) k++;
    return edges[k];
  };
  const wobble = mulberry32(hashStr(o.name));
  const dragFrom = { x: nameRect.x + 2 + wobble() * 2, y: nameCY + 4 + wobble() * 4 };
  const dragTo = { x: selEnd + 1 + wobble() * 4, y: nameCY + 3 + wobble() * 6 };
  // The selection's centre on screen: the zoom anchor and the laps' centre.
  const selCX = (nameRect.x + selEnd) / 2;

  // ── Pointer path ──────────────────────────────────────────────────────────
  const g0 = landingGeom(1);
  const clickPt = { x: inputX(cxL) + 28, y: g0.composerY + g0.composerH / 2 + 2 };
  // In from above the frame, straight down onto the search bar.
  const startPt = { x: clickPt.x + 70, y: -40 };
  // Then down out of the way, under the bar, so the typing reads clear.
  const asidePt = { x: clickPt.x + 40, y: clickPt.y + 72 };
  // Big, fast, uneven loops in the empty space under the loading line: the
  // speed and the radius both wobble, the centre drifts, and a fine shake
  // rides on top.
  const loopC = { x: mainX + mainW / 2, y: threadTop + visibleH(false) * 0.55 };
  const loopAt = (t: number) => {
    const u = t - T_CIRCLE[0];
    const a = -Math.PI / 2 + 2 * Math.PI * (3.0 * u + 0.3 * Math.sin(4.7 * u));
    const r = 150 * (0.7 + 0.3 * Math.sin(3.1 * u + 0.8));
    return {
      x: loopC.x + 40 * Math.sin(1.7 * u) + r * Math.cos(a) + 3 * Math.sin(37 * u),
      y: loopC.y + 25 * Math.cos(2.2 * u) + r * 0.85 * Math.sin(a) + 3 * Math.cos(29 * u),
    };
  };
  const restPt = { x: colX + colW * 0.85, y: threadTop + visibleH(false) * 0.5 };
  // Three tight laps around the selection, six a second.
  const lapRX = Math.max(50, (selEnd - nameRect.x) / 2 + 12);
  const nameLoopAt = (t: number) => {
    const a = -Math.PI / 2 + 2 * Math.PI * 6 * (t - T_NAME_LOOP[0]);
    return { x: selCX + lapRX * Math.cos(a), y: nameCY + 34 * Math.sin(a) };
  };
  const exitPt = { x: selCX + 24, y: -40 };
  const keys = [
    { t: 0, ...startPt },
    { t: T_CLICK - 0.18, ...startPt },
    { t: T_CLICK, ...clickPt },
    { t: T_CLICK + 0.1, ...clickPt },
    { t: T_CLICK + 0.4, ...asidePt },
    { t: T_SEND, ...asidePt },
    { t: T_CIRCLE[0], ...loopAt(T_CIRCLE[0]) },
    { t: T_CIRCLE[1], ...loopAt(T_CIRCLE[1]) },
    { t: T_CIRCLE[1] + 0.25, ...restPt },
    { t: T_HALF - 0.2, ...restPt },
    { t: T_DRAG[0], ...dragFrom },
    { t: T_DRAG[1], ...dragTo },
    { t: T_PULSED, ...dragTo },
    { t: T_NAME_LOOP[0], ...nameLoopAt(T_NAME_LOOP[0]) },
    { t: T_EXIT[0], ...nameLoopAt(T_NAME_LOOP[1]) },
    // `snap`: this leg accelerates the whole way instead of easing in and out.
    { t: T_EXIT[1], ...exitPt, snap: true },
    { t: seconds + 1, ...exitPt },
  ];
  const cursorAt = (t: number) => {
    if (t >= T_CIRCLE[0] && t < T_CIRCLE[1]) return loopAt(t);
    if (t >= T_NAME_LOOP[0] && t < T_NAME_LOOP[1]) return nameLoopAt(t);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[i + 1];
    const u = b.t === a.t ? 1 : clamp((t - a.t) / (b.t - a.t), 0, 1);
    const e = 'snap' in b && b.snap ? u * u : easeInOut(u);
    return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
  };
  // in, out, in, out: four PULSE-long legs, each one snapping off the mark.
  const zoomAt = (t: number) => {
    const u = t - T_PULSE;
    if (u < 0 || u >= 4 * PULSE) return 1;
    const leg = Math.floor(u / PULSE);
    const f = easeOut((u - leg * PULSE) / PULSE);
    return leg % 2 === 0 ? 1 + (MAX_ZOOM - 1) * f : MAX_ZOOM - (MAX_ZOOM - 1) * f;
  };
  // The zoom scales the page around the selection, which stays put on
  // screen, never showing past the page's edges (the DOM's zoomTo).
  const zoomShift = (z: number) => ({ x: clamp(selCX * (1 - z), W * (1 - z), 0), y: clamp(nameCY * (1 - z), H * (1 - z), 0) });

  // What Chrome shows under the pointer: the I-beam over text — the search
  // bar's field, the question, the answer as far as it has streamed — and
  // the arrow everywhere else. The pointer sits outside the zoom, so the
  // page under it is found back through the zoom.
  const overText = (tb: TextBlock, x0: number, y0: number, px: number, py: number, limit = Infinity) => {
    const i = Math.floor((py - y0) / tb.lh);
    const ln = tb.lines[i];
    return !!ln && ln.segs.length > 0 && ln.segs[0].start < limit && px >= x0 && px <= x0 + lineInk(ln);
  };
  const pointerAt = (t: number, p: { x: number; y: number }): PointerKind => {
    if (t < T_SEND) {
      const lines = Math.max(1, typedLayout(typedCount(t)).lines.length);
      const g = landingGeom(lines);
      const fieldH = lines * m.inputLH + 2 * m.inputPadY;
      const fieldY = g.composerY + g.composerH / 2 - fieldH / 2;
      const fieldX = inputX(cxL) - m.inputPadX;
      return p.x >= fieldX && p.x <= fieldX + inputW(cwL) + 2 * m.inputPadX && p.y >= fieldY && p.y <= fieldY + fieldH ? 'beam' : 'arrow';
    }
    const z = zoomAt(t);
    const s = z > 1 ? zoomShift(z) : { x: 0, y: 0 };
    const px = (p.x - s.x) / z;
    const py = (p.y - s.y) / z;
    const shown = shownAt(t);
    const done = t >= T_STREAMED;
    if (py < threadTop || py > threadTop + visibleH(done)) return 'arrow';
    const cy = py - threadTop + (t >= T_HALF ? frozenScroll : autoScroll(shown, done));
    if (overText(bubbleText, bubbleX + m.bubblePadX, innerTop + m.bubblePadY, px, cy)) return 'beam';
    for (const l of laid) {
      if (l.block.start >= shown) break;
      if (overText(l.tb, l.x, asstTop + l.y, px, cy, shown - l.block.start)) return 'beam';
    }
    return 'arrow';
  };

  // ── Drawing ───────────────────────────────────────────────────────────────
  const pill = (x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke?: string) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  };
  const label = (text: string, x: number, y: number, size: number, weight: 400 | 500 | 600, color: string, align: 'left' | 'center' = 'left') => {
    ctx.font = font(size, { weight });
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  };

  function drawHeader(x0: number, w: number) {
    const cy = m.headerH / 2;
    const bx = x0 + m.headerPadL + m.brandPadX;
    ctx.font = font(m.brandSize, { weight: 600 });
    const bw = ctx.measureText('ChatGPT').width;
    label('ChatGPT', bx, cy, m.brandSize, 600, C.text);
    icon(ctx, ICONS.chevron, bx + bw + 4 + 8, cy + 1, 16, C.grey, 2);
    let rx = x0 + w - m.headerPadR;
    for (const [text, bwid] of [['Sign up for free', signupW], ['Log in', loginW]] as const) {
      rx -= bwid;
      pill(rx, cy - m.btnH / 2, bwid, m.btnH, m.btnH / 2, C.text);
      label(text, rx + bwid / 2, cy, m.btnSize, 500, '#000', 'center');
      rx -= m.authGap;
    }
  }

  function drawRail() {
    ctx.fillStyle = C.railBorder;
    ctx.fillRect(m.rail - 1, 0, 1, H);
    icon(ctx, ICONS.panel, m.rail / 2, m.railPadT + m.railBtn / 2, 22, C.railIcon, 1.8);
    // From the bottom up: padding 14, a divider with 12px margins, the two
    // links (padding 24, gap 48), another divider.
    const d2 = H - 14 - 12 - 1;
    const icon2 = d2 - 12 - 24 - 11;
    const icon1 = icon2 - 22 - 48;
    const d1 = icon1 - 11 - 24 - 12 - 1;
    ctx.fillStyle = C.railBorder;
    ctx.fillRect(0, d1, m.rail - 1, 1);
    ctx.fillRect(0, d2, m.rail - 1, 1);
    icon(ctx, ICONS.extLink, m.rail / 2, icon1, 22, C.railLink, 1.8);
    icon(ctx, ICONS.extLink, m.rail / 2, icon2, 22, C.railLink, 1.8);
  }

  function drawComposer(cx: number, cy: number, cw: number, tb: TextBlock, typed: string, caret: boolean, generating: boolean, disclaimer: boolean) {
    const lines = Math.max(1, tb.lines.length);
    const h = composerHFor(lines);
    pill(cx, cy, cw, h, m.composerRadius, C.pill, C.pillBorder);
    const mid = cy + h / 2;
    icon(ctx, ICONS.plus, cx + m.composerPadX + m.iconBtn / 2, mid, 24, C.icon, 2);
    const ix = inputX(cx);
    const ty = mid - (lines * m.inputLH + 2 * m.inputPadY) / 2 + m.inputPadY;
    if (typed) drawText(ctx, tb, ix, ty, C.text);
    else label('Ask ChatGPT', ix, ty + m.inputLH / 2, m.inputSize, 400, C.placeholder);
    if (caret) {
      const last = tb.lines[tb.lines.length - 1];
      const ch = m.inputSize * 1.15;
      ctx.fillStyle = C.text;
      ctx.fillRect(ix + (last?.w ?? 0), ty + (lines - 1) * m.inputLH + (m.inputLH - ch) / 2, 1.5, ch);
    }
    if (disclaimer && !typed) label('ChatGPT is AI and can make mistakes.', cx + cw / 2, mid, m.disclaimerSize, 400, C.grey, 'center');
    const sendX = cx + cw - m.composerPadX - m.iconBtn / 2;
    icon(ctx, ICONS.mic, sendX - m.iconBtn - m.composerGap, mid, 24, C.icon, 1.8);
    if (generating) {
      pill(sendX - m.iconBtn / 2, mid - m.iconBtn / 2, m.iconBtn, m.iconBtn, m.iconBtn / 2, C.text);
      pill(sendX - 5, mid - 5, 10, 10, 2, '#000');
    } else {
      const on = !!typed;
      pill(sendX - m.iconBtn / 2, mid - m.iconBtn / 2, m.iconBtn, m.iconBtn, m.iconBtn / 2, on ? C.text : C.sendOff);
      icon(ctx, ICONS.arrowUp, sendX, mid, 24, on ? '#000' : C.sendOffIcon, 2.2);
    }
  }

  function drawLanding(t: number) {
    drawHeader(0, W);
    const n = typedCount(t);
    const tb = typedLayout(n);
    const g = landingGeom(Math.max(1, tb.lines.length));
    label('Where should we begin?', W / 2, g.headingY + headingLH / 2, m.headingSize, 400, C.text, 'center');
    // The caret holds solid while keys land, then blinks.
    const focused = t >= T_CLICK;
    const typing = t >= T_TYPE && t < T_TYPED + 0.15;
    const caret = focused && (typing || Math.floor((t - T_CLICK) * 2) % 2 === 0);
    drawComposer(cxL, g.composerY, cwL, tb, question.slice(0, n), caret, false, false);
    ctx.font = font(m.chipSize, {});
    const chipW = ctx.measureText('What can you do?').width + 2 * m.chipPadX;
    pill(W / 2 - chipW / 2, g.chipY, chipW, m.chipH, m.chipH / 2, null, C.chipBorder);
    label('What can you do?', W / 2, g.chipY + m.chipH / 2, m.chipSize, 400, C.text, 'center');
    drawText(ctx, footerText, m.footerPadX, H - m.footerPadY - blockH(footerText), C.grey, { align: 'center', width: W - 2 * m.footerPadX });
  }

  function drawUpsellButtons(x: number, y: number) {
    pill(x, y, loginW, m.upsellBtnH, m.upsellBtnH / 2, C.text);
    label('Log in', x + loginW / 2, y + m.upsellBtnH / 2, m.btnSize, 500, '#000', 'center');
    const sx = x + loginW + 8;
    pill(sx, y, signupW, m.upsellBtnH, m.upsellBtnH / 2, null, C.signupBorder);
    label('Sign up for free', sx + signupW / 2, y + m.upsellBtnH / 2, m.btnSize, 500, C.text, 'center');
  }

  function drawChat(t: number) {
    drawRail();
    drawHeader(mainX, mainW);
    const shown = shownAt(t);
    const done = t >= T_STREAMED;
    const highlight = t >= T_HALF;
    const scroll = highlight ? frozenScroll : autoScroll(shown, done);

    ctx.save();
    ctx.beginPath();
    ctx.rect(mainX, threadTop, mainW, visibleH(done));
    ctx.clip();
    ctx.translate(0, threadTop - scroll);

    pill(bubbleX, innerTop, bubbleW, bubbleH, m.bubbleRadius, C.bubble);
    drawText(ctx, bubbleText, bubbleX + m.bubblePadX, innerTop + m.bubblePadY, C.text);

    if (shown <= 0) {
      const ly = asstTop + m.loadingMinH / 2;
      const lx = colX + m.asstPadX;
      if (t < T_DOT_END) {
        const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * (((t - T_SEND) % 1.1) / 1.1));
        ctx.globalAlpha = 0.6 + 0.4 * s;
        ctx.fillStyle = C.text;
        ctx.beginPath();
        ctx.arc(lx + m.dot / 2, ly, (m.dot / 2) * (0.85 + 0.25 * s), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.font = font(m.asstSize, {});
        const tw = ctx.measureText('Searching the web').width;
        const band = lx + tw * (1.4 - 1.8 * (((t - T_DOT_END) % 2.2) / 2.2));
        const gr = ctx.createLinearGradient(band - tw * 0.3, 0, band + tw * 0.3, 0);
        gr.addColorStop(0, C.shimmerBase);
        gr.addColorStop(0.5, C.shimmerBand);
        gr.addColorStop(1, C.shimmerBase);
        ctx.fillStyle = gr;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText('Searching the web', lx, ly);
      }
    } else {
      for (const l of laid) {
        if (l.block.start >= shown) break;
        const y = asstTop + l.y;
        if (l.block.kind === 'li') {
          ctx.fillStyle = C.prose;
          ctx.beginPath();
          ctx.arc(l.x - m.liPL - 13, y + m.asstLH / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (highlight && l === nameLaid) {
          // Grows under the drag, then holds the name plus its space.
          const right = t >= T_DRAG[1] ? selEnd : selectedTo(cursorAt(t).x);
          ctx.fillStyle = C.selection;
          ctx.fillRect(nameRect.x, asstTop + nameRect.y, right - nameRect.x, nameRect.h);
        }
        drawText(ctx, l.tb, l.x, y, C.prose, { limit: shown - l.block.start });
      }
      if (done) {
        const ay = asstTop + asstBodyH(total) + m.actionsMT;
        let ax = colX + m.asstPadX + m.actionsML;
        for (const p of [ICONS.copy, ICONS.share]) {
          icon(ctx, p, ax + m.actionBtn / 2, ay + m.actionBtn / 2, m.actionIcon, C.action, 1.8);
          ax += m.actionBtn + m.actionsGap;
        }
      }
    }
    ctx.restore();

    const by = H - m.bottomPadB - composerHChat;
    drawComposer(cxC, by, cwC, typedLayout(0), '', false, !done, done);
    if (done) {
      const uy = by - m.bottomGap - upsellH;
      pill(cxC, uy, upsellW, upsellH, m.upsellRadius, C.pill, C.pillBorder);
      drawText(ctx, upsellText, cxC + m.upsellPadL, uy + (upsellH - blockH(upsellText)) / 2, C.text);
      drawUpsellButtons(cxC + upsellW - m.upsellPadR - upsellBtnsW, uy + (upsellH - m.upsellBtnH) / 2);
    }
  }

  // Everything is drawn in CSS px on a canvas RENDER_SCALE times the screen:
  // the base transform is the scale, and the zoom and the pointer ride on it.
  const S = RENDER_SCALE;
  const draw = (t: number) => {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const z = zoomAt(t);
    if (z > 1) {
      const s = zoomShift(z);
      ctx.setTransform(z * S, 0, 0, z * S, s.x * S, s.y * S);
    }
    if (t < T_SEND) drawLanding(t);
    else drawChat(t);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const c = cursorAt(t);
    drawPointer(ctx, pointerAt(t, c), c.x, c.y);
  };
  return { draw, typing: { start: T_TYPE, end: T_TYPED }, seconds, beats, pulseAt: T_PULSE };
}

// The keyboard under the typing: the app's own sample, laid across the typing
// stretch the way Vids lays it over a clip (same helpers, same gain), mixed
// offline into a bed the length of the clip. Which second of the sample it
// opens on follows the question, so the same inputs still give the same file.
async function keyboardBed(question: string, typing: { start: number; end: number }, seconds: number): Promise<AudioBuffer> {
  const octx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const sample = await decodeAudio(octx, SFX_URL);
  const span = { start: typing.start, end: typing.end + 0.12 };
  const from = mulberry32(hashStr(question) ^ 0x9e3779b9)() * Math.max(0, sample.duration - (span.end - span.start) - 0.5);
  scheduleLoop(octx, sample, span, DEFAULT_SFX_GAIN, { from });
  return octx.startRendering();
}

// ── Render + encode ─────────────────────────────────────────────────────────
export async function renderChatVideo(o: RenderOptions): Promise<RenderResult> {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video. Use Chrome or Edge.');
  const mb = await import('mediabunny');
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W * RENDER_SCALE;
  canvas.height = VIDEO_H * RENDER_SCALE;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  await loadPointers();
  const { draw, typing, seconds, beats, pulseAt } = createClip(ctx, o);
  const frames = Math.round(seconds * FPS);
  o.onPlanned?.({ beats, pulseAt, seconds, width: canvas.width, height: canvas.height });

  // H.264 in an MP4 wherever the browser can encode it (Chrome and Edge on a
  // normal machine); VP9/VP8 in a WebM otherwise.
  const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width: canvas.width, height: canvas.height });
  if (!codec) throw new Error('No video encoder is available in this browser.');
  const mp4 = codec === 'avc';

  // The keyboard track. Skipped, not fatal, if the sound can't be mixed or
  // encoded here: the clip still goes out, silent.
  const wanted: AudioCodec[] = mp4 ? ['aac'] : ['opus'];
  const audioCodec = await mb.getFirstEncodableAudioCodec(wanted, { numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  let bed: AudioBuffer | null = null;
  if (audioCodec) {
    try { bed = await keyboardBed(o.question, typing, seconds); } catch (err) { console.error('[chatgpt video] keyboard sound skipped:', err); }
  }

  const output = new mb.Output({
    format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  // Written as generously as the build writes its own file (lib/vidsPlan
  // videoBitrate): this is the first of two H.264 passes the picture goes
  // through, and it is the one with the small text in it.
  const source = new mb.CanvasSource(canvas, {
    codec,
    bitrate: videoBitrate(canvas.width, canvas.height, FPS),
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(source, { frameRate: FPS });
  const audio = bed && audioCodec ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: 128_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();
  try {
    if (audio && bed) await audio.add(bed);
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
      draw(i / FPS);
      // Resolves once the encoder can take more, so this loop never runs ahead.
      await source.add(i / FPS, 1 / FPS);
      o.onProgress?.(i + 1, frames);
      if (i % 6 === 5) await new Promise(r => setTimeout(r, 0));
    }
  } catch (err) {
    await output.cancel().catch(() => { /* already gone */ });
    throw err;
  }
  await output.finalize();
  const buf = output.target.buffer;
  if (!buf) throw new Error('The encoder produced nothing.');
  const slug = safeExportName(o.name).toLowerCase().replace(/\s+/g, '-') || 'chatgpt';
  return {
    blob: new Blob([buf], { type: mp4 ? 'video/mp4' : 'video/webm' }),
    filename: `chatgpt-${slug}-${o.direction}.${mp4 ? 'mp4' : 'webm'}`,
    beats,
    pulseAt,
    seconds,
    width: canvas.width,
    height: canvas.height,
    poster: await poster(canvas, () => draw(seconds / 2)),
  };
}

/** A frame out of the middle of the clip, the size the library's own posters
 *  are (lib/vids-client probeVideoFile), so the card shows the answer rather
 *  than an empty search bar. Never throws: no poster is not no clip. */
function poster(canvas: HTMLCanvasElement, drawMiddle: () => void): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      drawMiddle();
      const k = Math.min(1, POSTER_W / canvas.width);
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(canvas.width * k));
      small.height = Math.max(1, Math.round(canvas.height * k));
      const sctx = small.getContext('2d');
      if (!sctx) { resolve(null); return; }
      smoothScaling(sctx).drawImage(canvas, 0, 0, small.width, small.height);
      small.toBlob((b) => resolve(b), 'image/jpeg', 0.82);
    } catch {
      resolve(null);
    }
  });
}

// ── The whole errand: ask, then render ──────────────────────────────────────
export interface ClipProgress { stage: 'ask' | 'render'; frac: number | null }
export interface MakeClipOptions {
  name: string;
  direction: Direction;
  question: string;
  signal?: AbortSignal;
  onProgress?: (p: ClipProgress) => void;
  /** The answer and the clip's layout, once both are known and before the
   *  frames are drawn — see RenderOptions.onPlanned. */
  onPlanned?: (p: ClipPlan & { reply: Reply }) => void;
}
/** One answer from the model for the question, then the recording of it. */
export async function makeChatGptClip(o: MakeClipOptions): Promise<RenderResult & { reply: Reply }> {
  o.onProgress?.({ stage: 'ask', frac: null });
  const reply = await askChatGpt(o.name, o.direction, [{ role: 'user', content: o.question }], o.signal);
  const out = await renderChatVideo({
    name: o.name,
    direction: o.direction,
    question: o.question,
    reply,
    signal: o.signal,
    onProgress: (done, total) => o.onProgress?.({ stage: 'render', frac: done / total }),
    onPlanned: (p) => o.onPlanned?.({ ...p, reply }),
  });
  return { ...out, reply };
}
