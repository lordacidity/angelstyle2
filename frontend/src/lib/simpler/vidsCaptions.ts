// Captions for a build: where they may go, how many fit, when each is on screen,
// and how they are drawn. Pure logic apart from the one canvas call at the
// bottom — the live preview, the exporter and the route that writes the words
// all share it, so the stage and the file agree frame-for-frame.
//
// The windows that carry text, all handed over already aligned by the timeline
// (see buildPlan):
//
//   Start    [0, dur(start))            one caption, the hook. It is the
//                                       persona's own bit, so it comes from the
//                                       persona's context.
//   Top A    [splitStart, endStart)     which is EXACTLY Bottom A followed by
//                                       Bottom B — the screen recording. So a
//                                       caption timed inside Bottom A's share
//                                       lines up with Bottom A by construction,
//                                       and likewise for Bottom B.
//   End      [endStart, total)          one caption, across the whole of it.
//                                       Every build finishes on him showing
//                                       what he made, and over all of that the
//                                       same call to action every time —
//                                       comment "<word>" for the link, the word
//                                       matched to the video. It is up from the
//                                       first frame of End to the last: the one
//                                       thing the viewer has to leave holding
//                                       gets the whole closing phase, and never
//                                       shares it with a line about the money.
//
// Top B has no window of its own: it plays across exactly the same stretch as
// End, and a caption is drawn on the whole frame anyway, so the End line is the
// one line over that closing phase.
//
// Where the lines land depends on whether the clip has been marked up in the
// editor (select a stretch, press G, say what happens there):
//
//   marked     one caption per mark, starting where its mark does. The marks
//              are in clip seconds, so they are mapped through the slot's
//              trim and speed onto the timeline first.
//   unmarked   fall back to spreading whatever was written evenly across the
//              clip — right for footage nobody has annotated, and the only
//              thing possible without knowing what happens when.
//   placed     Bottom A on Fast: two lines, each at the moment the writer
//              chose for it (CaptionLine.at, in clip seconds, mapped the way
//              the marks are), kept in order and apart — see `placed`.
//
// However it started, a line stays up until the next line comes up, so there
// is always a caption on screen: the hook holds until the first direction,
// each direction until the next, and the closing line to the very end (see
// `hold`). The exception is the seam between Bottom A and Bottom B, which is a
// hard cut — the two are different screen recordings, and a line written for
// one reads as a lie over the other. No Bottom A line is ever on screen over
// Bottom B: A's last comes down exactly where A ends, and B's first comes up
// exactly where B starts, pulled back off its mark when that mark is a beat in
// so the cut swaps the words rather than leaving B bare. The one place two
// marks may share a line is that same seam: when A's last stretch or B's first
// is too brief to carry a line of its own, the writer is asked for one line
// across both (seamNeedsMerge), and it plays over A's tail while B's next line
// takes the cut.
//
// One line may be two captions: a " / " in its text splits it, and the parts
// take turns across the stretch that line had — a marked moment's own span, or
// an unmarked clip's share — so "go to chatgpt / see who's trending rn" puts
// the first up where the moment starts and the second halfway through it. The
// writer is told to do this where a step is really two, and it is what to type
// by hand for the same effect. Start's hook and End's comment line never split:
// each is one written line with a window to itself (see buildCaptions).
//
// Emoji in a caption are painted from the app's own Apple images (lib/emoji,
// the PNGs under /public/emoji) rather than the OS's glyph for them, so the
// stage and the file show the same emoji the Emojis drawer does — on Windows
// the font would draw the flat Segoe ones straight into the export.

import { DEFAULT_BARS, regionRect, type BarsLayout, type Plan, type PlanItem } from '@/lib/simpler/vidsPlan';
import {
  emojiAdvance, getEmojiImage, measureRichWidth, preloadEmojiImagesForText, splitEmojiTokens, wrapRichText,
} from '@/lib/emoji';

/** Where a line sits on the frame: a share of the width and height, measured to
 *  the middle of the whole block, so a two-line caption grows either side of the
 *  point it was dropped on. Set by dragging it on the stage; unset means the
 *  default placement for its section. */
export interface CaptionPos { x: number; y: number }

/** One written line. `oneLine` shrinks the type until it fits across in one go,
 *  for a caption that would otherwise wrap and take up half the screen. */
export interface CaptionLine {
  text: string;
  oneLine: boolean;
  /** Where it was dragged to, if it has been. */
  pos?: CaptionPos;
  /** When it comes up, when the writer chose that itself — Bottom A on Fast
   *  (see `placed`). In CLIP seconds, like a mark, so it stays on the moment it
   *  was written for whatever the slot's trim and speed do afterwards. */
  at?: number;
}

export const capLine = (text: string, oneLine = false): CaptionLine => ({ text, oneLine });

/** The groups of written lines — the sections of the build that carry text.
 *  `end` is the one line over the closing clip: the comment line. */
export type CaptionGroup = 'start' | 'bottomA' | 'bottomB' | 'end';

/** Which written line a caption came from, so a drag on the stage knows what to
 *  move. Start, Payoff and End carry one line each, so their index is always 0. */
export interface CaptionRef { group: CaptionGroup; index: number }

/** One line by default over the screen recordings and the sign-off: those are
 *  directions and a call to action, and a wrapped block covers the very thing on
 *  screen it is pointing at. The hook is left to wrap — it is the long one. */
export const ONE_LINE_DEFAULT: Record<CaptionGroup, boolean> = {
  start: false, bottomA: true, bottomB: true, end: true,
};

/** Where on the frame a line sits. 'middle' is the middle of the black bar
 *  between the two halves rather than the middle of the frame, so the line
 *  reads off the black instead of over either picture. Start's hook is the
 *  exception: Start plays full screen with the persona in the middle of it, so
 *  its one line goes across the top rather than over their face. */
export type CaptionPlace = 'middle' | 'top';

/** A line and the stretch of finished video it sits over, in timeline seconds. */
export interface Caption extends CaptionLine {
  start: number;
  end: number;
  place: CaptionPlace;
  ref: CaptionRef;
}

/** On a clip nobody has marked up, aim for a line every ~2.5s and never give
 *  one a share under MIN_SHARE — short enough to keep pace with the screen,
 *  long enough to read. A marked clip takes its timing from its marks. */
export const MIN_SHARE = 1.5;
const TARGET_EVERY = 2.5;
/** A stretch either side of the Bottom A → Bottom B seam shorter than this
 *  can't carry a line of its own, so the two are written as one line. */
export const SEAM_MERGE_UNDER = 1.5;
/** How many lines Bottom A carries on Fast — the search and the pick, nearly
 *  always — each placed by the writer rather than one per mark. */
export const FAST_BOTTOM_A_CAPTIONS = 2;

export interface Span { start: number; end: number }

/** One of a clip's marks, moved onto the build's timeline. */
export interface TimedMark extends Span { text: string }

/** A stretch a build can caption, with whatever the clip in it has been marked
 *  up with. `marks` empty means nobody annotated that clip. */
export interface CaptionWindow extends Span {
  marks: TimedMark[];
  /** The slot's in point, kept length and rate — what maps a clip second onto
   *  this window, for a placed line's `at` as for the marks. */
  clip: { from: number; kept: number; speed: number };
}

/** The captionable stretches, each already lined up with the clip it belongs to.
 *  Any may be null — a build need not have every slot filled. */
export interface CaptionWindows {
  /** The full-screen opening. */
  start: CaptionWindow | null;
  /** Bottom A's share of the Top A window. */
  bottomA: CaptionWindow | null;
  /** Bottom B's share of it. */
  bottomB: CaptionWindow | null;
  /** The closing phase — End on the bottom, Top B above it — carrying the one
   *  comment line across the whole of it. */
  end: CaptionWindow | null;
}

/** Clip second → timeline second for one slot, undoing the trim and applying the
 *  speed. Outside the kept range it returns null: the build never plays that
 *  part of the clip, so a mark there has nothing to sit over. */
function onTimeline(item: PlanItem, clipTime: number): number | null {
  const from = item.trimStart;
  const to = item.trimStart + item.sourceLength;
  if (clipTime < from - 1e-6 || clipTime > to + 1e-6) return null;
  return item.start + (clipTime - from) / item.speed;
}

function windowFor(plan: Plan, slot: 'start' | 'bottomA' | 'bottomB' | 'end'): CaptionWindow | null {
  const item = plan.items.find((i) => i.slot === slot);
  if (!item || item.end <= item.start) return null;

  const marks: TimedMark[] = [];
  for (const m of item.video.marks ?? []) {
    const start = onTimeline(item, m.start);
    // A mark running past the trim still counts — it just ends where the slot
    // does, which is where the viewer stops seeing that stretch anyway.
    const end = onTimeline(item, m.end) ?? item.end;
    if (start === null || end - start < 0.05) continue;
    marks.push({ start, end: Math.min(end, item.end), text: m.text });
  }
  marks.sort((a, b) => a.start - b.start);
  return {
    start: item.start, end: item.end, marks,
    clip: { from: item.trimStart, kept: item.sourceLength, speed: item.speed },
  };
}

/** Read the captionable windows straight off a built plan. Bottom A and Bottom B
 *  are used as-is: Top A rides exactly across the pair of them, so their own
 *  spans are the alignment. */
export function captionWindows(plan: Plan): CaptionWindows {
  return {
    start: windowFor(plan, 'start'),
    bottomA: windowFor(plan, 'bottomA'),
    bottomB: windowFor(plan, 'bottomB'),
    end: windowFor(plan, 'end'),
  };
}

/** How many lines a stretch of `length` seconds can hold without crowding: one
 *  every ~2.5s, and never so many that any of them falls under MIN_SHARE. */
export function captionCount(length: number): number {
  if (length < MIN_SHARE) return 0;
  const ceiling = Math.floor(length / MIN_SHARE);
  return Math.max(1, Math.min(ceiling, Math.round(length / TARGET_EVERY)));
}

/** Whether Bottom A's last mark and Bottom B's first should be written as one
 *  line: yes when either stretch — A's last mark to the end of A, or B's first
 *  mark to its second — is too brief for a line of its own. Only ever at the
 *  seam; everywhere else every mark keeps its own line. Both clips have to be
 *  marked up for the two moments to be known. */
export function seamNeedsMerge(w: CaptionWindows): boolean {
  const a = w.bottomA;
  const b = w.bottomB;
  if (!a?.marks.length || !b?.marks.length) return false;
  const tailA = a.end - a.marks[a.marks.length - 1].start;
  const headB = (b.marks[1]?.start ?? b.end) - b.marks[0].start;
  return tailA < SEAM_MERGE_UNDER || headB < SEAM_MERGE_UNDER;
}

/** The mark in a line's text that makes it two captions: a slash with space
 *  either side, so "w/" and the slashes in a URL are left alone. */
const SPLIT = /\s\/\s/;

/** The parts a line's text splits into — the whole thing when there is no
 *  " / " in it. Blank parts are dropped. */
export const splitParts = (text: string): string[] =>
  text.split(SPLIT).map((s) => s.trim()).filter(Boolean);

/** Cut `parts` down to what a stretch of `length` seconds can hold at MIN_SHARE
 *  each: whatever no longer fits is folded into the last part that does, so no
 *  words are lost, only the pause between them. */
function fitParts(parts: string[], length: number): string[] {
  const k = Math.max(1, Math.min(parts.length, Math.floor(length / MIN_SHARE)));
  if (parts.length <= k) return parts;
  return [...parts.slice(0, k - 1), parts.slice(k - 1).join(', ')];
}

/** How many lines a window wants: one per mark, or one every ~2.5s unmarked. */
export const wantedCount = (w: CaptionWindow | null): number =>
  (!w ? 0 : w.marks.length ? w.marks.length : captionCount(w.end - w.start));

/** One caption per mark that has a line written for it, starting where the mark
 *  does. When it comes down is settled afterwards by `hold` — until then it
 *  runs to the end of the window. A mark left blank gets no caption of its
 *  own: the line before it stays up over that stretch. A split line takes
 *  turns across the mark's own stretch, so its second half is still up while
 *  the moment it describes is on screen. */
function onMarks(
  lines: CaptionLine[],
  w: CaptionWindow,
  place: CaptionPlace,
  group: CaptionGroup,
  /** Anchor the first line that gets written at the window's own start rather
   *  than at its mark — what Bottom B needs, since nothing before it may hold
   *  across the seam to cover the beat before its first mark. */
  fromWindowStart = false,
): Caption[] {
  const out: Caption[] = [];
  w.marks.forEach((mark, index) => {
    const l = lines[index];
    if (!l?.text.trim()) return;
    const head = fromWindowStart && !out.length ? Math.min(w.start, mark.start) : mark.start;
    const span = mark.end - head;
    const parts = fitParts(splitParts(l.text), span);
    parts.forEach((text, j) => {
      out.push({ ...l, text, start: head + (span * j) / parts.length, end: w.end, place, ref: { group, index } });
    });
  });
  return out;
}

/** Spread `lines` evenly across the window — what an unmarked clip gets. Each
 *  sits at the head of its share and, once `hold` has run, stays up until the
 *  next; extras beyond what fits are dropped rather than squeezed, since a
 *  caption nobody can read is worse than one fewer. */
function spread(lines: CaptionLine[], w: Span, place: CaptionPlace, group: CaptionGroup): Caption[] {
  const length = w.end - w.start;
  // Kept with the index each line was written at, not the index it ends up at:
  // that is what a drag writes back to, and a blank line earlier in the list
  // must not shift it. A split line is simply two entries from the one index.
  const clean = lines.flatMap((line, index) => splitParts(line.text).map((text) => ({ line, text, index })));
  const n = Math.min(clean.length, captionCount(length));
  if (n < 1) return [];

  const slot = length / n;
  return clean.slice(0, n).map(({ line: l, text, index }, i) => (
    { ...l, text, start: w.start + i * slot, end: w.end, place, ref: { group, index } }
  ));
}

/** Clip seconds onto the window, through the slot's trim and speed — the same
 *  mapping as the marks, clamped to the kept range so a time outside it lands
 *  on the nearer edge rather than nowhere. */
function clipToWindow(w: CaptionWindow, t: number): number {
  const { from, kept, speed } = w.clip;
  return w.start + (Math.min(Math.max(t, from), from + kept) - from) / speed;
}

/** Lines the writer placed itself: Bottom A on Fast, where it chose both what
 *  each says and the moment it goes up (CaptionLine.at). Kept in order, inside
 *  the window and at least MIN_SHARE apart, so each can be read whatever time
 *  came back. A split line takes turns across its stretch, up to the next. */
function placed(lines: CaptionLine[], w: CaptionWindow, place: CaptionPlace, group: CaptionGroup): Caption[] {
  const timed = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.at != null && line.text.trim())
    .map(({ line, index }) => ({ line, index, at: clipToWindow(w, line.at ?? 0) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, captionCount(w.end - w.start));
  let floor = w.start;
  const starts = timed.map(({ at }, i) => {
    const latest = w.end - (timed.length - i) * MIN_SHARE;
    const s = Math.min(Math.max(at, floor), Math.max(floor, latest));
    floor = s + MIN_SHARE;
    return s;
  });
  return timed.flatMap(({ line, index }, i) => {
    const span = (starts[i + 1] ?? w.end) - starts[i];
    const parts = fitParts(splitParts(line.text), span);
    return parts.map((text, j) => ({
      ...line, text, start: starts[i] + (span * j) / parts.length, end: w.end, place, ref: { group, index },
    }));
  });
}

/** Lay lines over a window: where the writer placed them when it did, on its
 *  marks when it has them, evenly when it does not. */
export function layoutCaptions(
  lines: CaptionLine[],
  window: CaptionWindow | null,
  group: CaptionGroup,
  place: CaptionPlace = 'middle',
): Caption[] {
  if (!window) return [];
  if (lines.some((l) => l.at != null)) return placed(lines, window, place, group);
  return window.marks.length
    // Bottom B opens on its own first line — see the seam note in the header.
    ? onMarks(lines, window, place, group, group === 'bottomB')
    : spread(lines, window, place, group);
}

/** What a build's captions are written as: one hook over Start, a line per mark
 *  over each screen recording (the arrays line up with the marks by index; a
 *  blank means the line before holds over that mark, which is how a merged
 *  seam is carried), and the closing line over End. Editable by hand after the
 *  model drafts it. */
export interface CaptionLines {
  /** The hook. Start only ever carries one. */
  start: CaptionLine;
  bottomA: CaptionLine[];
  bottomB: CaptionLine[];
  /** Over the winnings: the comment line, and nothing else. One line. */
  end: CaptionLine;
}

export const EMPTY_LINES: CaptionLines = {
  start: capLine('', ONE_LINE_DEFAULT.start),
  bottomA: [],
  bottomB: [],
  end: capLine('', ONE_LINE_DEFAULT.end),
};

/** The laid-out captions, kept per window as well as pooled: the panel shows
 *  each group beside the clip it belongs to, the renderers only want `all`. */
export interface LaidOutCaptions {
  start: Caption[];
  bottomA: Caption[];
  bottomB: Caption[];
  end: Caption[];
  /** Every caption on the build, in timeline order. */
  all: Caption[];
}

/** A window that carries exactly one line — Start's hook, End's comment line.
 *  `onMark` lets it wait for the clip's first mark, which is where the moment
 *  was said to be; without one it simply opens the window and runs to the end. */
function single(
  line: CaptionLine,
  w: CaptionWindow | null,
  group: CaptionGroup,
  place: CaptionPlace = 'middle',
  onMark = true,
): Caption[] {
  if (!w || !line.text.trim()) return [];
  const start = onMark ? w.marks[0]?.start ?? w.start : w.start;
  return [{ ...line, start, end: w.end, place, ref: { group, index: 0 } }];
}

/** The order the windows play in. */
const GROUP_ORDER: readonly CaptionGroup[] = ['start', 'bottomA', 'bottomB', 'end'];

/** Settle when each line comes down: the moment the next one comes up, so
 *  there is always a caption on screen. Within a window that is simply the
 *  next line. The last line of a window runs to the window's end — and when
 *  the window straight after it has lines, on across the seam until the first
 *  of them, since a screen recording whose first mark is a beat in, or Bottom
 *  B with its first line merged into A's last, would otherwise go bare. A line
 *  never holds through a whole window that has no lines of its own: with
 *  nothing written for a clip yet, the previous line comes down where the clip
 *  does rather than sitting over footage it says nothing about.
 *
 *  Captions are therefore never overlapping, which is what lets `captionAt`
 *  take the first match. */
function hold(all: Caption[], windows: CaptionWindows): void {
  const present = GROUP_ORDER.filter((g) => windows[g]);
  all.forEach((c, i) => {
    const own = windows[c.ref.group];
    if (!own) return;
    const next = all[i + 1];
    if (!next) { c.end = own.end; return; }
    if (next.ref.group === c.ref.group) { c.end = next.start; return; }
    const following = present[present.indexOf(c.ref.group) + 1];
    const across = next.ref.group === following ? next.start : own.end;
    // Bottom A stops dead at its own end whatever comes next: the A → B seam is
    // a hard cut (see the header). Every other seam may still be held across.
    c.end = c.ref.group === 'bottomA' ? Math.min(across, own.end) : across;
  });
}

export function buildCaptions(windows: CaptionWindows, lines: CaptionLines): LaidOutCaptions {
  // Start's hook is the one line that isn't centred — see CaptionPlace.
  const start = single(lines.start, windows.start, 'start', 'top');
  const bottomA = layoutCaptions(lines.bottomA, windows.bottomA, 'bottomA');
  const bottomB = layoutCaptions(lines.bottomB, windows.bottomB, 'bottomB');
  // The closing clip carries the comment line and nothing else, across the whole
  // of it: it is up from End's first frame (`onMark` off, so a marked-up closing
  // clip doesn't hold it back) and `hold` runs it to the very last.
  const end = single(lines.end, windows.end, 'end', 'middle', false);
  // The per-group arrays hold the same objects `all` does, so settling the
  // ends here settles them everywhere.
  const all = [...start, ...bottomA, ...bottomB, ...end].sort((a, b) => a.start - b.start);
  hold(all, windows);
  return { start, bottomA, bottomB, end, all };
}

/** The line on screen at time `t`, if any. */
export const captionAt = (captions: Caption[], t: number): Caption | undefined =>
  captions.find((c) => t >= c.start && t < c.end);

// ── Fixed lines ───────────────────────────────────────────────────────────────
// Three of a build's captions are chosen rather than written. Bottom A is always
// the rendered ChatGPT recording now, marked by the renderer beat for beat
// (search, wait, pick — lib/simpler/vidsBottom bottomAMarks), and its middle two beats
// say nothing that changes from one build to the next: the answer is loading,
// then he takes the name off it. A model writing those fresh each time only
// finds new ways to say the same thing, so they come from a fixed set instead —
// one at random, swapped by hand from the dropdown beside the line in the
// captions rail. Bottom B's opener is fixed outright: it is the line that has to
// carry the address, and it is the same every build.
//
// Bottom A's two are rolled an emoji as well as a line — the hourglass half the
// time on the wait, one of three faces a fifth each on the pick — so the same
// words don't land the same way twice. Bottom B's opener never takes one: it is
// the address, and it reads as an instruction.

/** Where the person's name goes in a fixed line. */
const NAME = '{name}';

/** Bottom A's second caption — waiting on the answer to load. */
export const BOTTOM_A_WAIT: readonly string[] = [
  'let it cook...',
  'wait for it to load',
  'patience...',
  'let it marinate',
  'give it a sec...',
];

/** Bottom A's third caption — taking the name off the answer. The ones without
 *  {name} in them stand on their own, which is what a build with no name to
 *  fill in is left to choose from. */
export const BOTTOM_A_PICK: readonly string[] = [
  `choose ${NAME}`,
  'target acquired',
  `lock in ${NAME}`,
  `eyes on ${NAME}`,
  'locked in',
  `${NAME} it is`,
  `going with ${NAME}`,
  'pick your fighter',
];

/** Bottom B's first caption, every build: the address, then the search. Two
 *  captions out of the one line — the " / " splits it (see splitParts) — so
 *  "go to pauv.com" opens the clip and "search <name>" follows on the same
 *  moment. Without a name there is nothing to search, so it is the address
 *  alone. */
export const bottomBOpen = (name: string): string =>
  (name ? `go to pauv.com / search ${name}` : 'go to pauv.com');

const needsName = (line: string) => line.includes(NAME);
const withName = (line: string, name: string) => line.split(NAME).join(name);

/** What each of Bottom A's chosen lines may end on, listed once per share so
 *  taking one at random gives the odds asked for: the wait line ends on the
 *  hourglass half the time, the pick line on one of three faces a fifth each and
 *  on nothing the other two fifths. `null` is no emoji.
 *
 *  Stored as the plain character and nothing more: the stage and the exporter
 *  paint every caption emoji from the app's own Apple images (see the note at
 *  the top of this file), so that is already the Apple one wherever it is
 *  drawn. All four are in the app's set, with a PNG under /public/emoji. */
const FIXED_EMOJI: Record<number, readonly (string | null)[]> = {
  1: ['⏳', null],
  2: ['👀', '😤', '🎯', null, null],
};

const anyOf = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Every emoji a fixed line can end up carrying, longest first so a line ending
 *  on one is matched by the whole of it. */
const ROLLED = Object.values(FIXED_EMOJI).flat()
  .filter((e): e is string => !!e)
  .sort((a, b) => b.length - a.length);

/** A fixed line with whatever emoji was rolled onto it taken back off — what the
 *  dropdown matches on, so a line that came up with an hourglass still shows as
 *  the line it is. */
export function bareFixedLine(text: string): string {
  const t = text.trimEnd();
  const hit = ROLLED.find((e) => t.endsWith(e));
  return hit ? t.slice(0, -hit.length).trimEnd() : t;
}

/** Swap the words of a fixed line for another of the set, keeping whatever emoji
 *  this one was rolled — picking different words is not a re-roll. */
export function swapFixedLine(current: string, line: string): string {
  const bare = bareFixedLine(current);
  const emoji = current.trimEnd().slice(bare.length).trim();
  return emoji ? `${line} ${emoji}` : line;
}

/** The fixed lines a row may be swapped between, the name already filled in —
 *  null for a row that is written rather than chosen. Bottom A's first line
 *  still describes what he searched, so it is the model's to write. */
export function fixedChoices(group: CaptionGroup, index: number, name: string): readonly string[] | null {
  const bank = group !== 'bottomA' ? null
    : index === 1 ? BOTTOM_A_WAIT
    : index === 2 ? BOTTOM_A_PICK
    : null;
  if (!bank) return null;
  const usable = name ? bank : bank.filter((l) => !needsName(l));
  return (usable.length ? usable : bank).map((l) => withName(l, name));
}

/** One of a row's fixed lines at random, with its emoji rolled on the side —
 *  null where the row is written rather than chosen. */
export function fixedLine(group: CaptionGroup, index: number, name: string): string | null {
  const choices = fixedChoices(group, index, name);
  if (!choices?.length) return null;
  const line = anyOf(choices);
  const emoji = group === 'bottomA' ? anyOf(FIXED_EMOJI[index] ?? [null]) : null;
  return emoji ? `${line} ${emoji}` : line;
}

// ── Look ──────────────────────────────────────────────────────────────────────
// Four presets rather than a pile of controls: the point is to pick one and get
// on with it. Every size is a share of the frame width, so a preset looks the
// same at 1080×1920 as it does at 1920×1080.

export interface CaptionStyle {
  id: string;
  label: string;
  /** One line for the picker. */
  note: string;
  family: string;
  weight: number;
  /** Type size as a share of the frame width. */
  size: number;
  color: string;
  /** How the words are cased on the frame, whatever was typed: 'as-written'
   *  leaves them alone. */
  letterCase: 'upper' | 'lower' | 'as-written';
  /** Black outline, as a share of the type size. 0 for none. */
  stroke: number;
  /** Drop shadow blur, as a share of the frame width. */
  shadow: number;
  /** Letter spacing, as a share of the type size. */
  tracking: number;
}

/** The looks on offer. The builder picks one at random for each build, the
 *  way it picks the song — none of them is the default. (Impact, big outlined
 *  caps, was retired; a build written down with it comes back as Clean.) */
export const CAPTION_STYLES: readonly CaptionStyle[] = [
  {
    id: 'clean', label: 'Clean', note: 'white, plain',
    family: 'Inter, "Helvetica Neue", Arial, sans-serif',
    weight: 700, size: 0.053, color: '#ffffff', letterCase: 'as-written', stroke: 0, shadow: 0.012, tracking: 0,
  },
  {
    id: 'soft', label: 'Soft', note: 'lighter and smaller',
    family: 'Inter, "Helvetica Neue", Arial, sans-serif',
    weight: 500, size: 0.042, color: '#f4f4f5', letterCase: 'as-written', stroke: 0, shadow: 0.022, tracking: 0.012,
  },
  {
    id: 'gold', label: 'Gold', note: 'yellow, outlined',
    family: 'Inter, "Helvetica Neue", Arial, sans-serif',
    weight: 800, size: 0.057, color: '#ffd84d', letterCase: 'as-written', stroke: 0.09, shadow: 0.008, tracking: 0,
  },
];

/** What stands in before a style has been rolled, and what an export with no
 *  style given draws in. Not what a build lands on — see CAPTION_STYLES. */
export const DEFAULT_CAPTION_STYLE = CAPTION_STYLES[0].id;
/** The style with this id, or the stand-in for one that no longer exists. */
export const captionStyle = (id: string): CaptionStyle =>
  CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];

// ── How big ───────────────────────────────────────────────────────────────────
// A look comes at the size it was drawn at, and the slider under the picker
// moves that either way. It is a multiple rather than a size of its own, so it
// means the same thing whichever look is on, and 1 is always the look as
// designed.

export const DEFAULT_CAPTION_SCALE = 1;
export const MIN_CAPTION_SCALE = 0.6;
export const MAX_CAPTION_SCALE = 1.8;
export const CAPTION_SCALE_STEP = 0.05;
export const clampCaptionScale = (v: number): number => (Number.isFinite(v)
  ? Math.round(Math.min(MAX_CAPTION_SCALE, Math.max(MIN_CAPTION_SCALE, v)) * 100) / 100
  : DEFAULT_CAPTION_SCALE);

/** A look at `scale`. Only two of its numbers are sizes of their own: the type
 *  and the shadow, both shares of the frame. The outline and the letter
 *  spacing are shares of the TYPE size, so they come along on their own and
 *  the words keep their proportions at any size. */
export const scaleCaptionStyle = (style: CaptionStyle, scale: number): CaptionStyle => {
  const k = clampCaptionScale(scale);
  return k === DEFAULT_CAPTION_SCALE ? style : { ...style, size: style.size * k, shadow: style.shadow * k };
};

/** How wide a line may run before it wraps. */
const MAX_LINE_OF_WIDTH = 0.86;
const LINE_HEIGHT = 1.22;
/** A one-line caption will not shrink past this much of its normal size — below
 *  it the text is too small to read, and wrapping was the better answer. */
const MIN_ONE_LINE_SCALE = 0.45;
/** The gap between the top edge of the picture and the top of a top-placed
 *  block, as a share of the frame height — a little way in from the edge, so
 *  the hook sits below the very top of the video without reaching the face in
 *  the middle of it. The block hangs from that line and grows downward, so one
 *  line and three lines start in exactly the same place. */
const TOP_GAP = 0.09;

/** Greedy word wrap to `maxWidth`, with each emoji measured as the image it is
 *  drawn as. A single word too long to fit stays on its own line rather than
 *  being broken — captions are short, and a hyphenated word mid-screen reads
 *  worse than one long line. */
const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, emojiSize: number): string[] =>
  wrapRichText(ctx, text.replace(/\s+/g, ' ').trim(), maxWidth, emojiSize);

/** Where a caption's block lands and how it is set, worked out on `ctx` without
 *  painting anything. The stage measures with this to know what a pointer is
 *  over, and drawCaption paints from the very same numbers — so what you can
 *  grab is exactly what you can see. */
export interface CaptionLayout {
  /** The text as it will be painted, already wrapped. */
  lines: string[];
  font: string;
  spacing: string;
  size: number;
  /** Baseline to baseline. */
  step: number;
  /** Middle of the first line — the text is drawn centred on this point. */
  x: number;
  top: number;
  /** The whole block on the frame, in frame pixels. */
  box: { x: number; y: number; w: number; h: number };
}

const fontOf = (style: CaptionStyle, px: number) => `${style.weight} ${px}px ${style.family}`;
// letterSpacing is Chromium-only; the exporter already requires WebCodecs, and a
// browser without it simply renders at the default spacing.
type Spaced = CanvasRenderingContext2D & { letterSpacing?: string };

export function layoutCaption(
  ctx: CanvasRenderingContext2D,
  caption: Caption,
  W: number,
  H: number,
  style: CaptionStyle,
  bars: BarsLayout = DEFAULT_BARS,
): CaptionLayout | null {
  const raw = caption.text.trim();
  if (!raw) return null;
  const text = style.letterCase === 'upper' ? raw.toUpperCase()
    : style.letterCase === 'lower' ? raw.toLowerCase()
    : raw;
  const maxWidth = W * MAX_LINE_OF_WIDTH;

  // Measuring leaves the context as it found it; drawCaption sets the font it is
  // handed back rather than relying on what was left behind.
  ctx.save();
  let size = Math.round(W * style.size);
  const apply = (px: number) => {
    ctx.font = fontOf(style, px);
    (ctx as Spaced).letterSpacing = `${(px * style.tracking).toFixed(2)}px`;
  };
  apply(size);

  let lines: string[];
  if (caption.oneLine) {
    // Shrink until the whole thing fits across, rather than letting it wrap.
    const w = measureRichWidth(ctx, text, size);
    const needed = w > maxWidth ? Math.floor(size * (maxWidth / w)) : size;
    const floor = Math.round(size * MIN_ONE_LINE_SCALE);
    size = Math.max(floor, needed);
    apply(size);
    // A caption so long that one line would mean unreadable type gets the
    // smallest size we allow and then wraps anyway — "one line" is a request,
    // and honouring it literally here would run the words off the frame.
    lines = needed < floor ? wrap(ctx, text, maxWidth, size) : [text];
  } else {
    lines = wrap(ctx, text, maxWidth, size);
  }

  // Emoji are drawn a type-size square, so they are measured as one too.
  const step = Math.round(size * LINE_HEIGHT);
  const widest = lines.reduce((m, l) => Math.max(m, measureRichWidth(ctx, l, size)), 0);
  ctx.restore();

  // The middle of the block: a caption dropped somewhere is anchored there, and
  // the two defaults are worked out to the same point so a drag picks up exactly
  // where the caption already is.
  const blockH = (lines.length - 1) * step;
  const cx = caption.pos ? W * caption.pos.x : W / 2;
  // A top-placed caption is measured from the picture, not the frame: with
  // outer bars on, the video starts below them, and Start sits lower still
  // (START_DROP), and the line belongs against that edge rather than floating
  // over the black.
  const pictureTop = regionRect('full', W, H, bars).y;
  // A middle-placed caption sits on the black bar between the two halves, not
  // at the middle of the frame — that is what keeps it off both pictures. Taken
  // from the regions themselves rather than worked out here, so it follows the
  // split wherever that moves (lib/simpler/vidsPlan TOP_SHORTER). With the middle bar
  // turned off the two regions meet, and the line lands on the seam.
  const topRect = regionRect('top', W, H, bars);
  const barMiddle = (topRect.y + topRect.h + regionRect('bottom', W, H, bars).y) / 2;
  const cy = caption.pos
    ? H * caption.pos.y
    : caption.place === 'top' ? pictureTop + H * TOP_GAP + step / 2 + blockH / 2
    : barMiddle;
  const top = cy - blockH / 2;

  return {
    lines,
    font: fontOf(style, size),
    spacing: `${(size * style.tracking).toFixed(2)}px`,
    size,
    step,
    x: cx,
    top,
    box: { x: cx - widest / 2, y: top - step / 2, w: widest, h: blockH + step },
  };
}

/** Paint one wrapped line centred on `cx` with its middle at `y`: the words in
 *  the current font, and every emoji as the Apple image from the app's own set
 *  (lib/emoji) rather than whatever glyph the OS would draw for it. The stroke
 *  pass outlines the words only; an image needs no outline. An image not yet
 *  loaded falls back to the OS glyph for that frame and is swapped in on the
 *  next — preloadCaptionEmoji is what keeps that off an export. The advance
 *  is the one measureRichWidth counted, so the line lands where layoutCaption
 *  measured it. */
function paintLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  cx: number,
  y: number,
  emojiSize: number,
  pass: 'stroke' | 'fill',
): void {
  let cursor = cx - measureRichWidth(ctx, line, emojiSize) / 2;
  for (const tok of splitEmojiTokens(line)) {
    if (tok.type === 'text') {
      if (pass === 'stroke') ctx.strokeText(tok.value, cursor, y);
      else ctx.fillText(tok.value, cursor, y);
      cursor += ctx.measureText(tok.value).width;
      continue;
    }
    const adv = emojiAdvance(emojiSize);
    if (pass === 'fill') {
      const img = getEmojiImage(tok.value);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, cursor + (adv - emojiSize) / 2, y - emojiSize / 2, emojiSize, emojiSize);
      } else {
        ctx.fillText(tok.value, cursor, y);
      }
    }
    cursor += adv;
  }
}

/** Fetch the Apple image for every emoji these captions use, so the first
 *  frame that carries one is drawn with it: the exporter waits on this before
 *  rendering, and the stage paints again once it settles. */
export const preloadCaptionEmoji = (captions: readonly Caption[]): Promise<void> =>
  preloadEmojiImagesForText(captions.map((c) => c.text).join(' '));

/** Across the middle of the frame in the chosen style, across the top for a
 *  caption placed there (Start's hook), or wherever it was dragged to. The
 *  shadow is not decoration: Bottom A and Bottom B are screen recordings, and
 *  text over a light-mode browser window would otherwise vanish. */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  caption: Caption,
  W: number,
  H: number,
  style: CaptionStyle,
  bars: BarsLayout = DEFAULT_BARS,
): void {
  const laid = layoutCaption(ctx, caption, W, H, style, bars);
  if (!laid) return;
  const { lines, step, x, top } = laid;

  ctx.save();
  // Each line is walked token by token from its left edge (paintLine), so the
  // context is left-aligned and the centring is done there.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = laid.font;
  (ctx as Spaced).letterSpacing = laid.spacing;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = Math.round(W * style.shadow);
  if (style.stroke > 0) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = laid.size * style.stroke;
    ctx.strokeStyle = '#000';
    lines.forEach((l, i) => paintLine(ctx, l, x, top + i * step, laid.size, 'stroke'));
    // The outline already separates the text from the picture; a shadow on top
    // of it just muddies the letterforms.
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = style.color;
  lines.forEach((l, i) => paintLine(ctx, l, x, top + i * step, laid.size, 'fill'));
  ctx.restore();
}
