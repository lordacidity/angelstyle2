// Pure timeline + layout logic for the Vids builder — no DOM at import time, so
// the live preview (VidsBuilder) and the exporter (vidsCompose) share it and
// agree frame-for-frame.
//
// The six slots and how they play out:
//   Start     full screen, first.
//   Bottom A  bottom half, right after Start. Bottom B follows it, End follows that.
//   Top A     top half from the moment the split begins, and it keeps going
//             through Bottom A and Bottom B…
//   Top B     …until End starts, when the top switches to Top B. Top B + End run
//             together and the video finishes when TOP B does: the last phase is
//             as long as Top B, and End is fitted to it — holding its last frame
//             if it is shorter, cut off if it is longer.
// A clip shorter than its window holds its last frame; a longer one is cut. Top A
// is the exception: its window is the whole bottom sequence and its own clip is
// usually far shorter, so it runs again from the start rather than freezing.
// Any slot may be left empty — the sequence simply skips it.
//
// Where the clips come from: Start, Top A and Top B are never chosen one by one
// — they are the three parts of a *persona*, a named bundle in the Persona
// folder, and choosing one persona fills all three at once. Only Bottom A,
// Bottom B and End are picked individually, each from the folder of that name.
// So the library has four top-level folders, not six.
//
// Layout: optional black bars (a middle bar between the halves, and top/bottom
// bars around the whole frame) shrink the regions; each clip is auto-fitted to
// its region (default: exact height, so its top and bottom edges land on the
// bars / section edges) and then nudged by the user's zoom + offset, which are
// stored *relative* to that fit so toggling a bar re-fits without losing them.

import { isPhoto } from '@/lib/vids-types';
import type { PersonaPart, VidRow } from '@/lib/vids-types';

export type SlotId = 'start' | 'topA' | 'topB' | 'bottomA' | 'bottomB' | 'end';
export type Region = 'full' | 'top' | 'bottom';
/** height = match the region's height exactly (width crops or letterboxes);
 *  width  = match its width exactly (height crops or letterboxes). */
export type Fit = 'height' | 'width';
export type Align = 'start' | 'center' | 'end';

export interface Rect { x: number; y: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SlotMeta {
  id: SlotId;
  label: string;
  /** Top-level library folder that feeds this slot (matched case-insensitively).
   *  The three persona slots all name the Persona folder — they are filled as a
   *  bundle, so no folder maps to any one of them on its own. */
  folder: string;
  /** 'persona' = arrives with the chosen persona; 'folder' = picked by hand. */
  source: 'persona' | 'folder';
  hint: string;
}

/** The Persona folder's name, and the three slots one persona fills. */
export const PERSONA_FOLDER = 'Persona';

export const SLOTS: readonly SlotMeta[] = [
  { id: 'start',   label: 'Start',    folder: PERSONA_FOLDER, source: 'persona', hint: 'full screen, plays first' },
  { id: 'topA',    label: 'Top A',    folder: PERSONA_FOLDER, source: 'persona', hint: 'top half while Bottom A + B play' },
  { id: 'topB',    label: 'Top B',    folder: PERSONA_FOLDER, source: 'persona', hint: 'top half once End starts — sets how long that last phase runs' },
  { id: 'bottomA', label: 'Bottom A', folder: 'Bottom A',     source: 'folder',  hint: 'bottom half, right after Start' },
  { id: 'bottomB', label: 'Bottom B', folder: 'Bottom B',     source: 'folder',  hint: 'bottom half, after Bottom A' },
  { id: 'end',     label: 'End',      folder: 'End',          source: 'folder',  hint: 'bottom half after Bottom B — runs as long as Top B' },
];

export const SLOT_META: Record<SlotId, SlotMeta> = Object.fromEntries(SLOTS.map((s) => [s.id, s])) as Record<SlotId, SlotMeta>;

/** Start / Top A / Top B, in the order a persona lists them. */
export const PERSONA_SLOTS = SLOTS.filter((s) => s.source === 'persona').map((s) => s.id);
/** Which slot each of a persona's three clip fields fills. */
export const PERSONA_PART_SLOT: Record<PersonaPart, SlotId> = { startId: 'start', topAId: 'topA', topBId: 'topB' };
/** Bottom A / Bottom B / End — the slots with a folder of their own. */
export const FOLDER_SLOTS = SLOTS.filter((s) => s.source === 'folder').map((s) => s.id);

/** The four top-level folders the library keeps: Persona, Bottom A, Bottom B, End. */
export const LIBRARY_FOLDERS: readonly string[] = [PERSONA_FOLDER, ...FOLDER_SLOTS.map((id) => SLOT_META[id].folder)];

export const isPersonaFolderName = (name: string) => name.trim().toLowerCase() === PERSONA_FOLDER.toLowerCase();

/** The minimum a folder row needs for the tree helpers below. */
export interface FolderNode { id: string; parentId: string | null; name: string }

/** Every folder id that counts as `name`: each top-level folder called that,
 *  plus everything nested under them. There is normally exactly one, but two
 *  visitors opening the tab at the same moment used to be able to create a
 *  second, so the UI treats same-named folders as one place rather than
 *  stranding whatever was filed in the loser. */
export function folderGroupIds(folders: readonly FolderNode[], name: string): Set<string> {
  const want = name.trim().toLowerCase();
  const ids = new Set(
    folders.filter((f) => !f.parentId && f.name.trim().toLowerCase() === want).map((f) => f.id),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
  }
  return ids;
}

/** Which slot a top-level folder feeds, for the three hand-picked slots. Persona
 *  deliberately returns null: it feeds three slots at once, so a clip filed there
 *  can't be routed by folder alone. */
export function slotForFolderName(name: string): SlotId | null {
  const n = name.trim().toLowerCase();
  return SLOTS.find((s) => s.source === 'folder' && s.folder.toLowerCase() === n)?.id ?? null;
}

// Drag payload types — a library clip (video id) and a whole persona (persona
// id). Shared by the library cards (sources) and the slot / persona cards and
// folder rows (targets).
export const VID_DRAG_MIME = 'application/x-pauv-vid';
export const PERSONA_DRAG_MIME = 'application/x-pauv-persona';

// ── Layout ────────────────────────────────────────────────────────────────────

/** User adjustment on top of the auto-fit: zoom about the fitted centre, then shift (output px). */
export interface Transform { zoom: number; dx: number; dy: number }
export const DEFAULT_TRANSFORM: Transform = { zoom: 1, dx: 0, dy: 0 };
export const isDefaultTransform = (t: Transform) => t.zoom === 1 && t.dx === 0 && t.dy === 0;

export interface BarsLayout {
  /** Black bar between the top and bottom halves. */
  middle: boolean;
  middleSize: number;   // output px
  /** Black bars across the top and bottom of the whole frame (every phase). */
  outer: boolean;
  outerSize: number;    // output px, each
}
export const DEFAULT_BARS: BarsLayout = { middle: true, middleSize: 100, outer: true, outerSize: 130 };

/** In / out points in clip seconds; `end: null` = play to the clip's end. */
/** Bits per pixel per frame to aim for. High for H.264 — these clips get
 *  re-encoded every time they are edited, and the loss compounds, so the floor
 *  is set where a single pass is visually free rather than merely acceptable.
 *  A clip that goes through Prep twice and then a build has been encoded three
 *  times before anyone sees it, so the floor is what the third pass has left to
 *  work with, not the first. */
const TARGET_BPP = 0.16;
/** Past this there is nothing left to win and the files get silly. */
const MAX_BITRATE = 40_000_000;
/** Headroom over what the source already spends: re-encoding the same picture
 *  costs more bits than encoding it did the first time. */
const REENCODE_HEADROOM = 1.25;

/** What to give the encoder for a picture this size. `sourceBitrate`, when the
 *  input's own rate is known, keeps a clip that was already generously encoded
 *  from being squeezed down a step on the way through. */
export function videoBitrate(width: number, height: number, fps: number, sourceBitrate = 0): number {
  const floor = width * height * Math.max(1, fps) * TARGET_BPP;
  const want = Math.max(floor, Number.isFinite(sourceBitrate) ? sourceBitrate : 0) * REENCODE_HEADROOM;
  return Math.round(Math.min(want, MAX_BITRATE));
}

export interface Trim { start: number; end: number | null }
export const DEFAULT_TRIM: Trim = { start: 0, end: null };
export const isTrimmed = (t: Trim) => t.start > 0 || t.end !== null;
export const MIN_TRIM_LENGTH = 0.1;

// Playback rate for one clip. 2 means it plays twice as fast and takes half as
// long on the timeline; the kept range of the source is unchanged. Audio keeps
// its pitch — it is time-stretched rather than resampled, in both the preview
// and the export, so a sped-up clip still sounds like itself and the two always
// agree (see lib/vidsAudio).
/** How long a still runs when nothing else decides. End is the usual home for
 *  one, and End is normally as long as Top B — so this is only reached by a
 *  build with no Top B, where the photo is simply held for a beat. Trim and
 *  speed mean nothing to a photo, so it is this or the window it is fitted to. */
export const PHOTO_LENGTH = 4;

export const DEFAULT_SPEED = 1;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
/** The one-click rates, everywhere a speed control appears. Small steps up from
 *  as-shot: enough to tighten a clip without it reading as sped up. The slider
 *  still covers MIN_SPEED…MAX_SPEED for anything else. */
export const SPEED_PRESETS = [1, 1.1, 1.25, 1.5] as const;
export const isDefaultSpeed = (v: number) => Math.abs(v - DEFAULT_SPEED) < 1e-6;
export const clampSpeed = (v: number) =>
  Number.isFinite(v) ? clamp(v, MIN_SPEED, MAX_SPEED) : DEFAULT_SPEED;
/** The rate a clip's file was rendered at, when that is not as shot — what the
 *  picker and the library show beside the length, so a clip that has been
 *  sped up says so. Null for as shot, or a clip that has never been through
 *  Prep (whose file is its recording). */
export const renderedSpeed = (v: Pick<VidRow, 'edit'>): number | null =>
  (v.edit && !isDefaultSpeed(v.edit.speed) ? v.edit.speed : null);
/** "1.25×", "2×". */
export const fmtSpeed = (s: number) => `${s.toFixed(2).replace(/\.?0+$/, '')}×`;

/** What a bottom clip opens at the first time it is edited — on its way in
 *  through the upload pipeline, before it has ever been saved. Screen
 *  recordings run slow to watch back, and every one of them wants the same
 *  nudge, so the intake starts them there rather than leaving it to be
 *  remembered clip by clip.
 *
 *  The save renders it into the footage and writes it down beside the
 *  recording (VidEdit), so opening that clip again shows it at 1.25x on the
 *  recording — there to take off — and it never stacks: every render starts
 *  from the recording. */
export const INTAKE_SPEED = 1.25;
/** The slots that get it — the two screen recordings. Start, Top A and Top B
 *  are a person talking and play as shot; End is the pay-off and does too. */
export const INTAKE_SPEED_SLOTS: readonly SlotId[] = ['bottomA', 'bottomB'];
/** The speed a clip on its way into `slot` opens at. Anything else — a
 *  persona part, an End, footage going to the Inbox — opens as shot. */
export const intakeSpeed = (slot: SlotId | null): number =>
  (slot && INTAKE_SPEED_SLOTS.includes(slot) ? INTAKE_SPEED : DEFAULT_SPEED);

// ── Bottom A's pace ───────────────────────────────────────────────────────────
// Bottom A is the long screen recording, and the stretch people have said
// drags. Fast speeds it up until it runs FAST_BOTTOM_A_LENGTH on the timeline,
// whatever its length — the picture and the typing it carries, and nothing
// else: the song and the room tone run under the whole timeline and are never
// sped. Fast never slows a clip down, so one already shorter than that plays
// at its own speed, and it is never slower than the speed the slot is set to.
// Normal plays it at its own speed, as set on the slot. Every new video starts
// on Fast.

export type BottomAPace = 'normal' | 'fast';
export const BOTTOM_A_PACES: readonly BottomAPace[] = ['normal', 'fast'];
/** What every new video starts Bottom A on. */
export const DEFAULT_BOTTOM_A_PACE: BottomAPace = 'fast';
/** How long Bottom A runs on Fast, in timeline seconds. */
export const FAST_BOTTOM_A_LENGTH = 10;
/** The most Fast will speed a clip up: the fastest a <video> will play before
 *  the browser refuses the rate. A clip longer than this many times
 *  FAST_BOTTOM_A_LENGTH runs a little over rather than breaking the preview. */
export const MAX_FAST_SPEED = 16;
/** A pace off a stored record. One written before there was a choice played
 *  Bottom A at its own speed, so anything but Fast reads as Normal — not as
 *  the default a new video starts on. */
export const cleanBottomAPace = (v: unknown): BottomAPace => (v === 'fast' ? 'fast' : 'normal');

/** The rate a slot actually plays at, with `kept` clip seconds of it: its own
 *  speed, except Bottom A on Fast. */
export function slotSpeed(slot: SlotId, speed: number, kept: number, pace: BottomAPace): number {
  const own = clampSpeed(speed);
  if (slot !== 'bottomA' || pace !== 'fast' || !(kept > 0)) return own;
  return Math.max(own, Math.min(MAX_FAST_SPEED, kept / FAST_BOTTOM_A_LENGTH));
}

// The kept range of a clip, clamped to what the clip actually has.
export function trimmedRange(trim: Trim, full: number): { start: number; end: number } {
  const start = clamp(trim.start, 0, full);
  const end = clamp(trim.end ?? full, start, full);
  return { start, end };
}
export function trimmedLength(trim: Trim, full: number | null): number | null {
  if (full == null) return null;
  const r = trimmedRange(trim, full);
  return Math.max(0, r.end - r.start);
}

/** How long the kept range occupies on the timeline once sped up or slowed. */
export function timelineLength(trim: Trim, full: number | null, speed: number): number | null {
  const kept = trimmedLength(trim, full);
  return kept == null ? null : kept / clampSpeed(speed);
}

/** Where a clip lands in a slot the moment it is picked, before anyone drags or
 *  zooms it. Start plays full screen, and a phone-shot clip fitted to that whole
 *  frame's height sits narrow with black either side — matching the width and
 *  pushing in a quarter fills it instead. The half-height slots have no such
 *  problem, so they keep the plain height fit. */
export const SLOT_PLACEMENT: Partial<Record<SlotId, { fit: Fit; align: Align; transform: Transform }>> = {
  start: { fit: 'width', align: 'center', transform: { zoom: 1.25, dx: 0, dy: 0 } },
};

/** The fit / align / transform a freshly picked clip gets. A slot with a
 *  placement of its own always opens there; the rest carry over whatever fit and
 *  align the slot was already using, and start from the untouched auto-fit. */
export function slotPlacement(
  slot: SlotId,
  prev?: { fit?: Fit; align?: Align },
): { fit: Fit; align: Align; transform: Transform } {
  const preset = SLOT_PLACEMENT[slot];
  if (preset) return { fit: preset.fit, align: preset.align, transform: { ...preset.transform } };
  return {
    fit: prev?.fit ?? 'height',
    align: prev?.align ?? 'center',
    transform: { ...DEFAULT_TRANSFORM },
  };
}

export interface SlotPick {
  video: VidRow;
  /** True for every clip except one saved out of Prep with the keyboard sound
   *  on it. Prep always drops the footage's own audio, so an un-muted slot can
   *  only ever contribute typing — the export stays silent apart from that. */
  muted: boolean;
  fit: Fit;
  align: Align;
  transform: Transform;
  trim: Trim;
  /** Playback rate; 1 = as shot. Shortens the slot's window on the timeline. */
  speed: number;
}
export type Picks = Partial<Record<SlotId, SlotPick>>;

/** A slot's pick the moment a clip lands in it. A clip is silent unless Prep
 *  baked the keyboard into it; that is the only audio a build ever carries.
 *  Fit / align carry over from whatever the slot held before unless the slot
 *  has a placement of its own (Start does); position and trim are per clip,
 *  so a new clip starts from that placement, untrimmed, as shot. */
export function freshPick(slot: SlotId, video: VidRow, prev?: { fit?: Fit; align?: Align }): SlotPick {
  return {
    video,
    muted: !video.hasSfx,
    ...slotPlacement(slot, prev),
    trim: { ...DEFAULT_TRIM },
    speed: DEFAULT_SPEED,
  };
}

export interface PlanItem {
  slot: SlotId;
  video: VidRow;
  start: number;     // timeline seconds
  end: number;
  region: Region;
  fit: Fit;
  align: Align;
  transform: Transform;
  muted: boolean;
  trimStart: number;       // clip seconds where this window starts playing from
  duration: number;        // how long this window is on the TIMELINE (speed applied)
  sourceLength: number;    // length of the kept range in CLIP seconds (duration * speed)
  speed: number;           // playback rate; clip seconds advance this fast per timeline second
  sourceDuration: number;  // the whole clip
  /** Run the clip again from its in point when it reaches the end, for as long
   *  as the window stays open, instead of holding the last frame. Top A only —
   *  it rides the whole bottom sequence and is usually far shorter than it, and
   *  a face frozen up top for ten seconds reads as a broken video. */
  loop: boolean;
}

export interface Plan {
  items: PlanItem[];
  total: number;
  bars: BarsLayout;
}

// `durations` (by video id) are the browser-measured lengths, which win over
// the value stored at upload time (that one can be missing for odd codecs).
// `bottomAPace` is Normal or Fast — see slotSpeed; left out, every clip plays
// at its own speed.
export function buildPlan(
  picks: Picks,
  durations: Record<string, number> = {},
  bars: BarsLayout = DEFAULT_BARS,
  bottomAPace: BottomAPace = 'normal',
): Plan {
  // A photo has no length of its own, nothing to trim and no rate to play at:
  // it is one frame held for as long as its window is open. Giving it a length
  // here rather than special-casing further down is what lets every slot, every
  // offset and the whole timeline below carry on knowing nothing about stills.
  const photo = (id: SlotId): boolean => !!picks[id] && isPhoto(picks[id]!.video);
  const fullDur = (id: SlotId): number => {
    const p = picks[id];
    if (!p) return 0;
    if (isPhoto(p.video)) return PHOTO_LENGTH;
    return Math.max(0, durations[p.video.id] ?? p.video.duration ?? 0);
  };
  const range = (id: SlotId) => (photo(id)
    ? { start: 0, end: PHOTO_LENGTH }
    : trimmedRange(picks[id]?.trim ?? DEFAULT_TRIM, fullDur(id)));
  /** Kept range in clip seconds. */
  const kept = (id: SlotId): number => {
    const r = range(id);
    return Math.max(0, r.end - r.start);
  };
  // Bottom A on Fast plays at whatever rate fits it — see slotSpeed.
  const rate = (id: SlotId) => (photo(id)
    ? DEFAULT_SPEED
    : slotSpeed(id, picks[id]?.speed ?? DEFAULT_SPEED, kept(id), bottomAPace));
  /** The same range on the timeline, which is what every offset below is in. */
  const dur = (id: SlotId): number => kept(id) / rate(id);
  const has = (id: SlotId) => !!picks[id] && dur(id) > 0;

  const items: PlanItem[] = [];
  const push = (slot: SlotId, start: number, end: number, region: Region) => {
    const p = picks[slot];
    if (!p || end <= start) return;
    items.push({
      slot, video: p.video, start, end, region,
      fit: p.fit, align: p.align, transform: p.transform ?? DEFAULT_TRANSFORM,
      muted: p.muted, trimStart: range(slot).start,
      duration: dur(slot), sourceLength: kept(slot), speed: rate(slot),
      sourceDuration: fullDur(slot),
      // Only Top A goes round again — every other window either sizes itself to
      // its clip or is a deliberate hold (End against Top B).
      // A still has nothing to go round: it is the same frame either way.
      loop: slot === 'topA' && !photo(slot) && kept(slot) > 0 && end - start > dur(slot) + 1e-3,
    });
  };

  let t = 0;
  if (has('start')) {
    push('start', 0, dur('start'), 'full');
    t = dur('start');
  }
  const splitStart = t;

  // Bottom half runs Bottom A → Bottom B → End back to back. End is the one
  // window that isn't sized by its own clip: Top B decides how long the closing
  // phase lasts, and End fills it — holding its last frame if it is shorter than
  // Top B, cut off if it is longer. (Without a Top B there is nothing to match,
  // so End simply plays its own length.)
  let endStart: number | null = null;
  for (const s of ['bottomA', 'bottomB', 'end'] as const) {
    if (!has(s)) continue;
    const span = s === 'end' && has('topB') ? dur('topB') : dur(s);
    if (s === 'end') endStart = t;
    push(s, t, t + span, 'bottom');
    t += span;
  }
  let total = t;

  // Top half: Top A rides along the whole bottom sequence, handing over to
  // Top B the moment End begins. With only one of them present it just stays.
  const topFirst: SlotId | null = has('topA') ? 'topA' : has('topB') ? 'topB' : null;
  const topSecond: SlotId | null = has('topA') && has('topB') ? 'topB' : null;
  if (topFirst) {
    if (total > splitStart) {
      const switchAt = topSecond && endStart !== null ? endStart : total;
      push(topFirst, splitStart, switchAt, 'top');
      if (topSecond && endStart !== null) push(topSecond, endStart, total, 'top');
    } else {
      // Nothing on the bottom — the tops simply play back to back up top.
      push(topFirst, t, t + dur(topFirst), 'top');
      t += dur(topFirst);
      if (topSecond) {
        push(topSecond, t, t + dur(topSecond), 'top');
        t += dur(topSecond);
      }
      total = t;
    }
  }

  items.sort((a, b) => a.start - b.start);
  return { items, total, bars };
}

// The picture area for a region once the bars have taken their share.
/** Start sits a little down the frame rather than dead centre: its picture
 *  begins this much of the frame height below the top bar, and the bottom edge
 *  stays where the split phases have theirs, so the persona rides lower and the
 *  cut to the screen recording keeps its floor. The hook is measured from the
 *  same edge (lib/vidsCaptions), so it comes down with the picture. */
export const START_DROP = 0.06;

export function regionRect(region: Region, W: number, H: number, bars: BarsLayout = DEFAULT_BARS): Rect {
  const o = bars.outer ? clamp(bars.outerSize, 0, H / 2 - 1) : 0;
  const innerY = o;
  const innerH = H - 2 * o;
  if (region === 'full') {
    const d = Math.min(Math.round(H * START_DROP), innerH - 1);
    return { x: 0, y: innerY + d, w: W, h: innerH - d };
  }
  const m = bars.middle ? clamp(bars.middleSize, 0, innerH - 2) : 0;
  const half = (innerH - m) / 2;
  return { x: 0, y: region === 'top' ? innerY : innerY + half + m, w: W, h: half };
}

// Where a sw×sh source lands inside `region` before any user adjustment:
// 'height' matches the region's height exactly, 'width' its width; the other
// axis then either overflows (cropped by the region clip) or falls short
// (black). `align` picks which side survives a crop / where a short picture sits.
export function fittedRect(sw: number, sh: number, region: Rect, fit: Fit, align: Align): Rect {
  const scale = fit === 'height' ? region.h / sh : region.w / sw;
  const w = sw * scale;
  const h = sh * scale;
  const f = align === 'start' ? 0 : align === 'center' ? 0.5 : 1;
  return { x: region.x + (region.w - w) * f, y: region.y + (region.h - h) * f, w, h };
}

// The fitted rect with the user's zoom (about its centre) and shift applied.
export function placedRect(sw: number, sh: number, region: Rect, fit: Fit, align: Align, transform: Transform = DEFAULT_TRANSFORM): Rect {
  const base = fittedRect(sw, sh, region, fit, align);
  const w = base.w * transform.zoom;
  const h = base.h * transform.zoom;
  const cx = base.x + base.w / 2 + transform.dx;
  const cy = base.y + base.h / 2 + transform.dy;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The transform offset that puts the clip dead centre in its region on one
 *  axis, leaving the other axis and the zoom alone. Zoom scales about the fitted
 *  centre, so the centre only depends on the offset — this is exact at any zoom. */
export function centredOffset(
  sw: number, sh: number, region: Rect, fit: Fit, align: Align, axis: 'x' | 'y',
): number {
  const base = fittedRect(sw, sh, region, fit, align);
  return axis === 'x'
    ? region.x + region.w / 2 - (base.x + base.w / 2)
    : region.y + region.h / 2 - (base.y + base.h / 2);
}

/** Canvas 2D scales with a cheap filter by default, and every frame in this
 *  section is scaled at least once — a clip into its half of the frame, the
 *  composite onto the stage. `high` is the difference between a downscale that
 *  keeps the text on a screen recording readable and one that doesn't, so every
 *  context that draws footage is put into it as soon as it is made. */
export function smoothScaling(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

export function drawInRegion(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  region: Rect,
  fit: Fit,
  align: Align,
  transform: Transform = DEFAULT_TRANSFORM,
): void {
  if (!sw || !sh) return;
  const r = placedRect(sw, sh, region, fit, align, transform);
  ctx.save();
  ctx.beginPath();
  ctx.rect(region.x, region.y, region.w, region.h);
  ctx.clip();
  ctx.drawImage(src, r.x, r.y, r.w, r.h);
  ctx.restore();
}
