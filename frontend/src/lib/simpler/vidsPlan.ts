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
import type { BoomSound } from '@/lib/simpler/vidsAudio';
import type { PersonaPart, VidRow, VidTheme } from '@/lib/vids-types';

export type SlotId = 'start' | 'topA' | 'topB' | 'bottomA' | 'bottomB' | 'end';
/** A BOOM's own layer. There can be any number of them on one video, and each
 *  needs a name of its own: the stage keeps an element per layer and seeks them
 *  independently, so two BOOMs sharing a name would be one element trying to be
 *  in two places. The tail is the BOOM's id — see BoomInsert. */
export type BoomLayerId = `boom:${string}`;
export const boomLayer = (id: string): BoomLayerId => `boom:${id}`;
/** The BOOM a layer belongs to — the other way round. */
export const boomIdOf = (slot: LayerId): string => slot.slice('boom:'.length);

/** Everything that can be on the frame: the six slots, plus however many BOOMs
 *  — which are not slots at all (nothing fills them, they hold no place in the
 *  sequence) but are pictures on the timeline all the same, so the plan, the
 *  stage and the exporter all need a name for them. */
export type LayerId = SlotId | BoomLayerId;
/** Where on the frame something is drawn. `frame` is the whole output, bars
 *  and all — the BOOM goes over everything, so it answers to nothing that
 *  shapes the sequence underneath it. */
export type Region = 'full' | 'top' | 'bottom' | 'frame';
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

/** The folders Edit & file works in — everything but Bottom A. Nobody shoots a
 *  Bottom A any more: the Build page's Bottom card renders the ChatGPT search
 *  itself and keeps it for that one video (lib/simpler/vidsLocal), so footage dropped
 *  in by hand is only ever a Bottom B, an End or a persona. The folder still
 *  exists in the library, holding whatever was filed there before; it is just
 *  not somewhere anything files itself any more. */
export const PREP_FOLDERS: readonly string[] = LIBRARY_FOLDERS.filter((name) => name !== SLOT_META.bottomA.folder);

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
// agree (see lib/simpler/vidsAudio).
/** How long a still runs when nothing else decides. End is the usual home for
 *  one, and End is normally as long as Top B — so this is only reached by a
 *  build with no Top B, where the photo is simply held for a beat. Trim and
 *  speed mean nothing to a photo, so it is this or the window it is fitted to. */
export const PHOTO_LENGTH = 4;

/** How long Top B plays, always: the closing phase is a fixed beat, not however
 *  much of him showing off got recorded. A longer clip is trimmed from the end
 *  down to this — the first TOP_B_LENGTH seconds of whatever was kept — and a
 *  shorter one simply plays out. Because End is sized to Top B (see buildPlan),
 *  capping it here is what makes every build's ending the same length, and what
 *  the End caption is up over from first frame to last. */
export const TOP_B_LENGTH = 5;

/** How long the BOOM is on screen, always — a hit, not a clip that happens to
 *  run for however long it was recorded. Whatever is filed as the BOOM is sped
 *  up or slowed down to land in exactly this, so swapping the file changes what
 *  it looks like and never how long it takes. */
export const BOOM_LENGTH = 2;

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

/** The rate that fits `len` clip seconds into `span` timeline seconds — what
 *  holds the BOOM to BOOM_LENGTH whatever is filed as it. Held inside the
 *  house's own bounds, so a file far off that length is cut short at the end
 *  (the usual fate of a clip longer than its window) rather than played at a
 *  rate no browser would honour. The house BOOM needs about 1.43. */
export const boomSpeed = (len: number, span: number): number =>
  (len > 0 && span > 0 ? clampSpeed(len / span) : DEFAULT_SPEED);
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
/** The slot that gets it — the screen recording you film yourself. Start, Top A
 *  and Top B are a person talking and play as shot; End is the pay-off and does
 *  too; Bottom A is rendered rather than filmed, and never comes in this way. */
export const INTAKE_SPEED_SLOTS: readonly SlotId[] = ['bottomB'];
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
  /** Bottom B only: sit dead centre, without the house's nudge to the left
   *  (BOTTOM_B_LEFT). The nudge is for a Pauv recording filmed off a screen,
   *  which is what every Bottom B was when it was written. One rendered to the
   *  frame (components/trade/trade-video, which is where Vids 2 gets its
   *  Bottom B) is already the page, whole and square on, and wants the middle.
   *  Absent or false anywhere else, so nothing that was nudged stops being. */
  centred?: boolean;
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
  slot: LayerId;
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
  /** Bottom B's, off its pick: no nudge to the left — see SlotPick.centred.
   *  Meaningless on anything else, and on a BOOM, which is over the whole
   *  frame rather than in a region of it. */
  centred?: boolean;
  /** False on a BOOM laid for its noise alone — see BoomInsert.picture. The
   *  item stays on the timeline; both renderers simply never draw it. */
  picture?: boolean;
  /** A sound laid under this item, beside it rather than in it. BOOMs only:
   *  every other layer is heard, if at all, out of its own file. Null for one
   *  set to make no noise. It is on the item rather than passed around beside
   *  the plan so the stage and the exporter read it from the same place they
   *  read where the picture goes. */
  sound?: BoomSound | null;
}

export interface Plan {
  items: PlanItem[];
  total: number;
  bars: BarsLayout;
}

// ── The BOOM ──────────────────────────────────────────────────────────────────
// A clip laid over the top of the finished video, on the moment the bar was
// pressed on, and as many of them as anyone cares to press in. It is not a slot
// and it is not another clip: it fills no place in the sequence, nothing waits
// for it, nothing under it is cut or moved, and the video is no longer for
// having it — it simply plays over whatever is underneath for as long as it
// lasts, which is always BOOM_LENGTH, whatever the clip itself runs for. The clip has nothing behind its picture and is painted onto
// nothing (itemBacking gives it none), so what it is over keeps playing through
// it. Over, here, means over the words as well as the pictures: see isBoomItem.
//
// It is filed in the Bottom B folder with the recordings (that is where clips
// go), and kept out of the list of people to trade on by name — see
// lib/simpler/vidsBottom.

/** One BOOM on the video: which clip, and where it lands. A build may carry as
 *  many as anyone cares to press in. */
export interface BoomInsert {
  /** This BOOM's own name, which its layer and its element are keyed on. Only
   *  has to be unlike the other BOOMs in the same build. */
  id: string;
  video: VidRow;
  /** Timeline seconds — where the bar was pressed. Pulled back so the whole
   *  thing fits when it lands too near the end — see boomPlanItem. */
  at: number;
  /** The bang it makes, chosen when it was laid. Null for a silent one. Kept
   *  per BOOM rather than per build, so two on one video can differ. */
  sound: BoomSound | null;
  /** False for a BOOM that is ONLY its noise: the bang lands on the moment and
   *  nothing is drawn — the video goes on showing whatever it was showing.
   *  It is still an item on the timeline, because that is what carries the
   *  sound and what the bar marks, so it comes off the same way any other
   *  does. Absent means the ordinary kind, with the picture. */
  picture?: boolean;
}

/** The BOOM is painted after the words rather than with the rest of the
 *  pictures: it goes over the whole video, and the captions are part of the
 *  video. Both renderers split the frame on this one call, so what is on the
 *  stage is layered the way the file is. */
export const isBoomItem = (i: Pick<PlanItem, 'slot'>): boolean => i.slot.startsWith('boom:');

/** One BOOM as a picture on the timeline, or null when there is no room for it
 *  or no clip to measure. Split out of buildPlan because the builder draws with
 *  it too: while you are choosing where a BOOM goes, the stage shows it landing
 *  there, and it can only be an honest preview if it is worked out by the very
 *  call that will place it.
 *
 *  It never makes the video any longer — it is pulled back to end on the last
 *  frame rather than run past it, so choosing the very end plays it in full
 *  instead of clipping it, and a video too short to hold the whole beat gives
 *  it what room there is. */
export function boomPlanItem(
  boom: BoomInsert,
  total: number,
  durations: Record<string, number> = {},
): PlanItem | null {
  if (total <= 0) return null;
  // Clip seconds, and the timeline seconds it is given: the second is fixed
  // (BOOM_LENGTH) and the first is whatever the clip happens to run for, so the
  // rate between them is what makes every BOOM the same beat — see boomSpeed.
  const soundOnly = boom.picture === false;
  const len = Math.max(0, durations[boom.video.id] ?? boom.video.duration ?? 0);
  const span = Math.min(BOOM_LENGTH, total);
  // The picture is pulled back so the whole beat fits before the last frame.
  // A sound-only one has no picture to fit, so it stays exactly on its moment;
  // its bang is cut by the end of the video rather than moved (scheduleOnce),
  // and BOOM_LENGTH is only how long its mark holds a place on the bar.
  const start = soundOnly
    ? clamp(boom.at, 0, Math.max(0, total - 1e-3))
    : clamp(boom.at, 0, Math.max(0, total - span));
  const end = Math.min(total, start + span);
  if (!(end > start)) return null;
  // Nothing to measure is fatal only when there is something to draw.
  if (!soundOnly && len <= 0) return null;
  const speed = boomSpeed(len, end - start);
  return {
    slot: boomLayer(boom.id), video: boom.video, start, end, region: 'frame',
    // Fitted to the frame's height: the BOOM is drawn to the shape of the
    // video rather than to a region inside it, because the whole frame is
    // what it is over. The house one is the frame's own 9:16, so nothing
    // of it is lost; a wider replacement would be cut at the sides.
    fit: 'height', align: 'center', transform: DEFAULT_TRANSFORM,
    // The picture makes no noise. A BOOM is heard, but what is heard is the
    // sound chosen for it (`sound` below), laid beside the picture rather than
    // taken out of it — so a clip filed with something already on its audio
    // track cannot double up with the bang picked for it.
    muted: true,
    // `sourceLength` is clip seconds and `duration` timeline seconds, and for
    // the BOOM they are deliberately not the same number: the rate between them
    // is the speed-up. Cut short of the whole clip only when one that long
    // would have to run faster than the house allows.
    trimStart: 0,
    duration: end - start,
    sourceLength: Math.min(len, (end - start) * speed),
    speed, sourceDuration: len, loop: false,
    sound: boom.sound,
    ...(soundOnly ? { picture: false } : {}),
  };
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
  booms: readonly BoomInsert[] = [],
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
  /** Kept range in clip seconds. Top B is capped at TOP_B_LENGTH: the ending is
   *  a fixed beat, so anything past it is trimmed off the end rather than
   *  stretching the whole closing phase. Capping it here rather than at the
   *  timeline means the item's own sourceLength is capped too, so the preview,
   *  the export and End's window all stop in the same place. */
  const kept = (id: SlotId): number => {
    const r = range(id);
    const len = Math.max(0, r.end - r.start);
    return id === 'topB' ? Math.min(len, TOP_B_LENGTH) : len;
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
      fit: p.fit, align: p.align, transform: p.transform ?? DEFAULT_TRANSFORM, centred: p.centred,
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
  // Top B, cut off if it is longer. Top B is itself capped at TOP_B_LENGTH, so
  // that phase is the same beat on every build. (Without a Top B there is nothing to match,
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

  // The BOOMs go on last, after the sort, because last is the whole point:
  // each is painted over every region there is (and over the captions — see
  // isBoomItem), and a clip starting later than one would otherwise be painted
  // over it. In the order they were pressed in, so two that overlap stack the
  // way they were laid. None of them lengthens the video — see boomPlanItem.
  for (const b of booms) {
    const item = boomPlanItem(b, total, durations);
    if (item) items.push(item);
  }
  return { items, total, bars };
}

// The picture area for a region once the bars have taken their share.
/** Start sits a little down the frame rather than dead centre: its picture
 *  begins this much of the frame height below the top bar, and the bottom edge
 *  stays where the split phases have theirs, so the persona rides lower and the
 *  cut to the screen recording keeps its floor. The hook is measured from the
 *  same edge (lib/simpler/vidsCaptions), so it comes down with the picture. */
export const START_DROP = 0.06;

/** How much of its height the top half gives up, as a share of the frame. The
 *  split phases used to be an even two halves either side of the middle bar;
 *  the top is now this much shorter, and the middle bar and the whole bottom
 *  half come up by exactly the same amount. The bottom KEEPS its height — the
 *  screen recording is the same size as it ever was, just higher up the frame —
 *  so what this leaves at the foot goes black, reading as a deeper bottom bar.
 *  A share of the height rather than a pixel count, so every preset shifts by
 *  the same proportion.
 *
 *  The clip up there does NOT shrink with the half: it is still fitted to the
 *  full height (topFitRect) and simply cut off at the new floor, so what this
 *  takes comes off the bottom of the picture rather than off the picture's
 *  size. The top of the shot is what is on screen either way. */
export const TOP_SHORTER = 0.04;

export function regionRect(region: Region, W: number, H: number, bars: BarsLayout = DEFAULT_BARS): Rect {
  // Over the top of everything, bars included: the BOOM is not part of the
  // sequence, so the layout that shapes the sequence doesn't shape it.
  if (region === 'frame') return { x: 0, y: 0, w: W, h: H };
  const o = bars.outer ? clamp(bars.outerSize, 0, H / 2 - 1) : 0;
  const innerY = o;
  const innerH = H - 2 * o;
  if (region === 'full') {
    const d = Math.min(Math.round(H * START_DROP), innerH - 1);
    return { x: 0, y: innerY + d, w: W, h: innerH - d };
  }
  const m = bars.middle ? clamp(bars.middleSize, 0, innerH - 2) : 0;
  const half = (innerH - m) / 2;
  // Taken off the top and off the top only: everything under it is the same
  // size, shifted up by `up`.
  const up = clamp(Math.round(H * TOP_SHORTER), 0, half - 1);
  return region === 'top'
    ? { x: 0, y: innerY, w: W, h: half - up }
    : { x: 0, y: innerY + half - up + m, w: W, h: half };
}

/** The box a clip is FITTED to, which is not always the box it is seen
 *  through. Only the top half differs: it is fitted to the half as it would be
 *  without TOP_SHORTER — same top edge, full height — and then seen through
 *  the shorter one. A clip fitted by height therefore starts exactly at the top
 *  of the half, at the size it has always been, and the shrink cuts the foot of
 *  the shot off instead of pulling the whole picture smaller. Everywhere else
 *  the two boxes are the same. */
export function fitRect(region: Region, W: number, H: number, bars: BarsLayout = DEFAULT_BARS): Rect {
  const r = regionRect(region, W, H, bars);
  if (region !== 'top') return r;
  const o = bars.outer ? clamp(bars.outerSize, 0, H / 2 - 1) : 0;
  const innerH = H - 2 * o;
  const m = bars.middle ? clamp(bars.middleSize, 0, innerH - 2) : 0;
  return { ...r, h: (innerH - m) / 2 };
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

/** How much of a source's own outer edge is never drawn, in source pixels.
 *
 *  A decoded frame's outermost pixels are not quite picture. H.264 (and JPEG)
 *  carry colour at half resolution — one chroma sample per 2×2 block — and what
 *  the encoder padded the last block with is not the colour of the picture next
 *  to it. Converted back to RGB those pixels come out off-hue, and because a
 *  zeroed chroma pair converts to green, what you get is a green hairline round
 *  the clip. It only shows where a clip's edge is actually on screen: Start is
 *  zoomed past its region and loses its edges to the clip path, but the bottom
 *  half is fitted exactly, so all four edges land against the backing.
 *
 *  So the edge is simply left out. Two pixels, because one bad chroma sample
 *  spans two of them. The destination is unchanged, so the picture still fills
 *  exactly the box the fit put it in — it is scaled up by about a fifth of a
 *  percent to do it, which is nothing anyone can see. */
const EDGE_CROP = 2;

/** How far into a source of `n` px the picture starts, on either axis: the
 *  crop, or nothing at all when the source is too small to give it up. Shared
 *  with sampledBacking, so what the strips are read off is always the very
 *  column the picture begins at rather than the bad pixels EDGE_CROP is here
 *  to leave out. */
const edgeInset = (n: number) => (n > EDGE_CROP * 2 ? EDGE_CROP : 0);

export function drawInRegion(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  region: Rect,
  fit: Fit,
  align: Align,
  transform: Transform = DEFAULT_TRANSFORM,
  /** Painted across the whole region before the clip goes on, so it shows
   *  wherever the clip doesn't reach — see itemBacking. Null leaves whatever
   *  the frame was cleared to. */
  backing: string | null = null,
  /** The box the clip is sized against, when that is not the box it is seen
   *  through — the top half, which is fitted tall and shown short (fitRect).
   *  Left out, the two are the same. */
  fitBox: Rect = region,
): void {
  if (!sw || !sh) return;
  const r = placedRect(sw, sh, fitBox, fit, align, transform);
  ctx.save();
  ctx.beginPath();
  ctx.rect(region.x, region.y, region.w, region.h);
  ctx.clip();
  if (backing) {
    ctx.fillStyle = backing;
    ctx.fillRect(region.x, region.y, region.w, region.h);
  }
  // The source less its edge — see EDGE_CROP. Naming the source rect also
  // pins what the scaler may sample: a clip drawn whole has its edge pixels
  // blended against whatever lies outside the frame, which is the other half
  // of the same hairline. A source too small to give the edge up is drawn
  // whole rather than not at all.
  const cx = edgeInset(sw);
  const cy = edgeInset(sh);
  ctx.drawImage(src, cx, cy, sw - cx * 2, sh - cy * 2, r.x, r.y, r.w, r.h);
  ctx.restore();
}

/** Pauv's own page colour, for the strips either side of a Bottom B. The
 *  recording is a phone-width capture of the site played in a region wider than
 *  it, so without this the clip sits between two black bars and reads as
 *  footage dropped onto a frame. Filled with the colour the page itself was,
 *  the strips read as more of the page.
 *
 *  What the page is when nothing has changed it — and the fallback for a frame
 *  whose own colour can't be read. See sampledBacking. */
export const BOTTOM_B_BACKING: Record<VidTheme, string> = { dark: '#0B0B0B', light: '#FFFFFF' };

/** The themes whose strips are read off the clip instead of taken from
 *  BOTTOM_B_BACKING. Light only: the light page turns grey partway through a
 *  trade and comes back a few seconds later, and a fixed white leaves the
 *  strips behind for the whole of it. The dark page holds the one colour
 *  throughout, so there is nothing there for a read to find that #0B0B0B does
 *  not already say — adding 'dark' here is all it would take if that changes. */
const SAMPLED_THEMES: readonly VidTheme[] = ['light'];

/** How many rows of each edge one read looks at. The page colour is whatever
 *  most of them are, so this only has to be enough to outvote whatever else is
 *  against the edge. It is not a resolution: a bigger number would find the
 *  same colour and cost more to do it. */
const PROBE_ROWS = 256;

/** A 2×PROBE_ROWS scratch canvas the two edge columns are copied into to be
 *  read back — one for the page rather than one per frame. `willReadFrequently`
 *  because it is written and read on every frame, which is the one case where
 *  keeping the pixels on the GPU is the slow way round. */
let probe: CanvasRenderingContext2D | null = null;
/** Set once a read has thrown, which only a cross-origin source can do. That
 *  taints the canvas for good, so there is nothing to gain by finding it out
 *  again on each of the frames still to come. */
let probeDead = false;

function probeCtx(): CanvasRenderingContext2D | null {
  if (probe || probeDead) return probe;
  // Nothing to draw on when the plan is being built on the server.
  if (typeof document === 'undefined') { probeDead = true; return null; }
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = PROBE_ROWS;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) { probeDead = true; return null; }
  // Nearest neighbour, so every row read back is a pixel that was decoded and
  // not an average of several. A blend of the page and the thing sitting on it
  // is a colour that was never on screen, and filling the strips with one is
  // the exact near-miss this is here to avoid.
  ctx.imageSmoothingEnabled = false;
  probe = ctx;
  return ctx;
}

/** Each sample's luminance packed above the colour it came from, so one plain
 *  numeric sort orders them by brightness and still says what each one was.
 *  255×1000 × 2²⁴ is far short of 2⁵³, so none of the arithmetic is approximate.
 *  Reused rather than rebuilt, since this runs on every frame. */
const samples = new Float64Array(PROBE_ROWS * 2);

/** The page colour a Bottom B is showing on the frame about to be drawn, read
 *  off the two columns of the clip the strips actually touch — or null when
 *  there is nothing to read.
 *
 *  Pauv's light page does not stay white: partway through a trade it goes grey
 *  for a few seconds and then comes back, and nothing in the clip says
 *  beforehand when. So the strips are not told a colour, they are shown one,
 *  and it is the clip's own outermost pixels on that very frame. It cannot fall
 *  a frame behind the change, because it is reading the change.
 *
 *  The median and not the average: what lies against the edge is mostly page
 *  but not always only page, and the average of a white page and one dark thing
 *  resting on it is a grey — which is the one colour this has to be right
 *  about. The median ignores that thing for as long as it is the minority, and
 *  gives back a pixel that was really there instead of a mix of two that were. */
function sampledBacking(src: CanvasImageSource, sw: number, sh: number): string | null {
  const cx = edgeInset(sw);
  const cy = edgeInset(sh);
  const h = sh - cy * 2;
  if (sw - cx * 2 < 1 || h < 1) return null;
  const ctx = probeCtx();
  if (!ctx) return null;
  let n = 0;
  try {
    ctx.clearRect(0, 0, 2, PROBE_ROWS);
    ctx.drawImage(src, cx, cy, 1, h, 0, 0, 1, PROBE_ROWS);
    ctx.drawImage(src, sw - cx - 1, cy, 1, h, 1, 0, 1, PROBE_ROWS);
    const { data } = ctx.getImageData(0, 0, 2, PROBE_ROWS);
    for (let i = 0; i < data.length; i += 4) {
      // Still clear means the draw put nothing there. Counting those as the
      // black they read as would flash the strips on a frame that was simply
      // not ready to be measured.
      if (data[i + 3] !== 255) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      samples[n++] = (r * 299 + g * 587 + b * 114) * 0x1000000 + ((r << 16) | (g << 8) | b);
    }
  } catch {
    probe = null;
    probeDead = true;
    return null;
  }
  if (!n) return null;
  samples.subarray(0, n).sort();
  const rgb = samples[n >> 1] % 0x1000000;
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

/** What to fill an item's region with before drawing it: Pauv's page colour
 *  under a Bottom B whose theme was recorded, nothing anywhere else. A clip
 *  filed before the theme toggle existed has none, and is left on the frame's
 *  black rather than guessed at.
 *
 *  Handed the frame that is about to go on, a theme in SAMPLED_THEMES takes its
 *  colour from that frame, so the strips follow the page rather than a colour
 *  settled on once for the whole clip. Without a frame — or when the read comes
 *  back with nothing — the theme's own colour stands, which is what the strips
 *  have always been. */
export function itemBacking(item: PlanItem, src?: CanvasImageSource, sw = 0, sh = 0): string | null {
  const theme = item.slot === 'bottomB' ? item.video.theme : null;
  if (!theme) return null;
  const fixed = BOTTOM_B_BACKING[theme];
  if (!src || !SAMPLED_THEMES.includes(theme)) return fixed;
  return sampledBacking(src, sw, sh) ?? fixed;
}

/** How far left of centre Bottom B sits, as a share of the frame width. Dead
 *  centre is not where a FILMED Pauv recording wants to be, so the picture is
 *  nudged over and the strip of page colour beside it (BOTTOM_B_BACKING) comes
 *  up wider on the right than the left. A share rather than a pixel count, so
 *  it is the same nudge at every output size. A pick marked `centred` goes
 *  without it — see SlotPick.centred. */
export const BOTTOM_B_LEFT = 0.05;

/** A slot's transform with any nudge of the house's own folded in — what the
 *  renderers draw with, and what the builder measures its drag handles from, so
 *  what you can grab is where the picture actually is. The slot's own `dx` is
 *  left to sit on top, which is what keeps dragging and Centre working from
 *  here. `W` is the output width, since `Transform.dx` is in output px. */
export const itemTransform = (item: PlanItem, W: number): Transform =>
  (item.slot === 'bottomB' && !item.centred
    ? { ...item.transform, dx: item.transform.dx - W * BOTTOM_B_LEFT }
    : item.transform);

/** Paint one item of the plan onto the output frame: its region, the box it is
 *  sized against, where its slot puts it and whatever backs it. The stage and
 *  the exporter both go through here and hand it nothing but the picture, so
 *  there is no arrangement either of them can have that the other doesn't. */
export function drawPlanItem(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  item: PlanItem,
  W: number,
  H: number,
  bars: BarsLayout = DEFAULT_BARS,
): void {
  drawInRegion(
    ctx, src, sw, sh,
    regionRect(item.region, W, H, bars), item.fit, item.align,
    itemTransform(item, W), itemBacking(item, src, sw, sh), fitRect(item.region, W, H, bars),
  );
}
