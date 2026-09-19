// Shapes shared by the Vids server module (lib/vids-db, route handlers) and the
// browser (lib/vids-client, hooks, components). Types plus the pure helpers that
// go with them — no Node, no browser, safe to import from either side.

// ── Context ───────────────────────────────────────────────────────────────────
// What a piece of footage is showing, said in your own words — "chatgpt looking
// up ronaldo", "pauv.com looking up and trading on ronaldo". Ordinary clips
// carry their own; the three clips of a persona share the persona's, since they
// are one performance.

export interface VidContext {
  /** Free text. Empty means nobody has said yet. */
  context: string;
}

/** A context change. Its own type because it is posted on its own, apart from
 *  the name and everything else a row carries. */
export type VidContextPatch = Partial<VidContext>;

// ── Theme ─────────────────────────────────────────────────────────────────────
// Which way Pauv was on the screen when a Bottom B was recorded — the site has
// a light mode and a dark one, and the same trade looks like two different
// clips depending on which was up. Said once, when the clip is filed, and kept
// beside it so you can see at a glance which you have.
//
// Nothing reads it yet: it is there to be looked at, and to be there when
// something does want it. Null means nobody has said — everything filed before
// the toggle existed, and every clip that isn't a Pauv recording.

export type VidTheme = 'light' | 'dark';
export const VID_THEMES: readonly VidTheme[] = ['light', 'dark'];

export interface VidThemed {
  theme: VidTheme | null;
}

/** A theme change, posted alongside the name and the context. */
export type VidThemePatch = Partial<VidThemed>;

/** A theme off the wire or up from a row. Anything that isn't one of the two
 *  reads as nobody having said — including a value left over from an older
 *  column. */
export const cleanTheme = (v: unknown): VidTheme | null =>
  (v === 'light' || v === 'dark' ? v : null);

/** Folds `theme` out of a request body into a patch, leaving it alone when the
 *  body didn't mention it. `null` is a real answer: it unsays it. */
export function readThemePatch(body: Record<string, unknown>, patch: VidThemePatch): void {
  if (body.theme !== undefined) patch.theme = cleanTheme(body.theme);
}

// ── Clipable ──────────────────────────────────────────────────────────────────
// Whether a thing is on offer to the clippers: the people who will make vids
// of their own, in an app of their own, out of what we approve here. Every
// persona, clip, song and caption look carries the flag, and it is off until
// someone here turns it on — so the clippers see only what has been signed
// off, and this app (the admin side) goes on using everything regardless.
//
// Personas and clips are rows, so the flag is a column on each. Songs and
// caption looks are defined in code rather than in the database (public/audio
// and lib/vidsCaptions), so theirs is a row in a table of its own, keyed by
// kind and by what names the thing: the song's url, the look's id. A row
// there means yes; no row means no.

export interface VidClipable {
  clipable: boolean;
}

export type VidClipablePatch = Partial<VidClipable>;

/** Folds `clipable` out of a request body into a patch, leaving it alone when
 *  the body didn't mention it. Anything but `true` reads as off. */
export function readClipablePatch(body: Record<string, unknown>, patch: VidClipablePatch): void {
  if (body.clipable !== undefined) patch.clipable = body.clipable === true;
}

/** The kinds of thing whose flag lives in the flags table rather than on a
 *  row of its own.
 *
 *  'suggested' is the odd one out and deliberately so: it is not about what a
 *  clipper may use — everybody may trade on anybody — but about which five
 *  names Vids 2 puts up before a search is typed. It sits here because the
 *  table is a plain (kind, key) store and this is one more key with no row of
 *  its own, and because the library payload that carries the rest carries it
 *  to both builds for free. */
export const CLIPABLE_KINDS = ['music', 'captionStyle', 'suggested'] as const;
export type ClipableKind = (typeof CLIPABLE_KINDS)[number];
export const isClipableKind = (v: unknown): v is ClipableKind =>
  typeof v === 'string' && (CLIPABLE_KINDS as readonly string[]).includes(v);

/** One approved song or caption look: its kind, and what names it (a song's
 *  url, a look's id). Only the approved ones are listed — absence means no. */
export interface VidClipableFlag {
  kind: ClipableKind;
  key: string;
}

export const MAX_CLIPABLE_KEY = 300;

/** How many people can be suggested at once. Five is the row Vids 2 draws:
 *  enough to be a steer, few enough that it is still a steer. */
export const MAX_SUGGESTED = 5;

/** The names put up as suggestions, in the order the flags came back. */
export const suggestedFrom = (flags: readonly VidClipableFlag[]): string[] =>
  flags.filter((f) => f.kind === 'suggested').map((f) => f.key);

export const isClipable = (flags: readonly VidClipableFlag[], kind: ClipableKind, key: string): boolean =>
  flags.some((f) => f.kind === kind && f.key === key);

// ── Marks ─────────────────────────────────────────────────────────────────────
// A clip's context said moment by moment: select a stretch in the editor, press
// G, type what is happening there. Times are in CLIP seconds, so a mark stays
// true wherever the clip is used — the build maps them onto its own timeline
// through that slot's trim and speed, and the caption for a mark lands over the
// exact stretch it describes.

export interface VidMark {
  /** Clip seconds. */
  start: number;
  end: number;
  text: string;
}

/** Marks are placed by hand and read back by the caption writer, so the row is
 *  kept small and sane: a handful of short notes, in order, no overlap-checking
 *  beyond dropping the degenerate ones. */
export const MAX_MARKS = 24;
export const MAX_MARK_TEXT = 200;

export function cleanMarks(v: unknown): VidMark[] {
  if (!Array.isArray(v)) return [];
  const out: VidMark[] = [];
  for (const raw of v) {
    const m = raw as Partial<VidMark> | null;
    const start = typeof m?.start === 'number' && Number.isFinite(m.start) ? Math.max(0, m.start) : null;
    const end = typeof m?.end === 'number' && Number.isFinite(m.end) ? Math.max(0, m.end) : null;
    const text = typeof m?.text === 'string' ? m.text.trim().slice(0, MAX_MARK_TEXT) : '';
    if (start === null || end === null || end <= start || !text) continue;
    out.push({ start, end, text });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, MAX_MARKS);
}

export const cleanContext = (v: unknown): string =>
  (typeof v === 'string' ? v : '').trim().slice(0, 600);

/** Folds `context` out of a request body into a patch, leaving it alone when the
 *  body didn't mention it. Shared by the video and persona PATCH routes. */
export function readContextPatch(body: Record<string, unknown>, patch: VidContextPatch): void {
  if (body.context !== undefined) patch.context = cleanContext(body.context);
}

// ── Edits ─────────────────────────────────────────────────────────────────────
// What Prep did to a clip, written down beside the footage rather than only
// baked into it. The recording that was uploaded is kept as the clip's SOURCE;
// the file everything else plays is rendered from that source with this edit
// applied. So opening the clip again shows the same trim handles, cuts, keys
// and speed it was saved with — loosen one, put a cut back, drop the speed —
// and the next save renders from the recording again, never from the last
// render. Nothing compounds and nothing is lost.
//
// Every number is in SOURCE seconds (the recording's own clock), which is what
// makes the record stable: the source never changes. Same shape as the
// editor's ClipEdit (lib/vidsEdit), kept here so the server can check it.

export interface VidEditRange { start: number; end: number }

export interface VidEdit {
  /** In / out points. `end` null means the end of the recording. */
  trim: { start: number; end: number | null };
  /** Ranges inside the trim that are removed. */
  cuts: VidEditRange[];
  /** Stretches the keyboard sound plays over. */
  sfx: VidEditRange[];
  sfxGain: number;
  /** Playback rate; 1.25 plays a quarter faster and lands shorter. */
  speed: number;
  /** The source's own sound dropped — true for every recording. False only
   *  when the source is an earlier render that already carries the keyboard,
   *  so that sound rides through. */
  muted: boolean;
}

/** Bounds a stored edit is held to. Wide on purpose: the editor decides what
 *  is sensible, this only stops a row holding garbage. */
const MAX_EDIT_RANGES = 200;
const MIN_EDIT_SPEED = 0.25;
const MAX_EDIT_SPEED = 4;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanRanges(v: unknown): VidEditRange[] {
  if (!Array.isArray(v)) return [];
  const out: VidEditRange[] = [];
  for (const raw of v) {
    const r = raw as Partial<VidEditRange> | null;
    if (!finite(r?.start) || !finite(r?.end)) continue;
    const start = Math.max(0, Math.min(r.start, r.end));
    const end = Math.max(0, Math.max(r.start, r.end));
    if (end > start) out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, MAX_EDIT_RANGES);
}

/** A stored edit out of whatever came over the wire or up from the row, or
 *  null when there is none (or it is not one). */
export function cleanEdit(v: unknown): VidEdit | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Partial<VidEdit>;
  const trim = (e.trim ?? {}) as Partial<VidEdit['trim']>;
  const start = finite(trim.start) ? Math.max(0, trim.start) : 0;
  const end = finite(trim.end) ? Math.max(start, trim.end) : null;
  const speed = finite(e.speed) ? Math.min(MAX_EDIT_SPEED, Math.max(MIN_EDIT_SPEED, e.speed)) : 1;
  const sfxGain = finite(e.sfxGain) ? Math.max(0, e.sfxGain) : 0.8;
  return {
    trim: { start, end },
    cuts: cleanRanges(e.cuts),
    sfx: cleanRanges(e.sfx),
    sfxGain,
    speed,
    muted: e.muted !== false,
  };
}

export interface VidFolder {
  id: string;
  parentId: string | null;   // null = top level
  name: string;
  createdAt: string;
}

export interface VidRow {
  id: string;
  folderId: string | null;   // null = library root
  name: string;
  storagePath: string;
  thumbPath: string | null;
  mimeType: string;
  sizeBytes: number;
  duration: number | null;   // seconds
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;               // public playback URL
  thumbUrl: string | null;
  /** What this clip is showing, in your words. A clip that is part of a persona
   *  leaves this alone — the persona holds the context for all three. */
  context: string;
  /** The same thing said stretch by stretch, for captions that land on the beat.
   *  Empty until someone marks the clip up in the editor. */
  marks: VidMark[];
  /** This clip was saved out of Prep with the keyboard sound on it, so its audio
   *  track holds typing and nothing else — Prep always drops the footage's own
   *  sound. It is the one reason the builder lets a slot be heard. */
  hasSfx: boolean;
  /** The recording as it was uploaded, kept once the clip has been edited so
   *  every later edit renders from it — see VidEdit. Null while the clip has
   *  never been through Prep: the file at `url` IS the recording then, and the
   *  first save keeps it as the source rather than throwing it away. */
  sourcePath: string | null;
  sourceUrl: string | null;
  /** The edit the file at `url` was rendered with, or null when it is the
   *  recording untouched. What Prep opens the clip with. */
  edit: VidEdit | null;
  /** On offer to the clippers — see VidClipable. Off until someone turns it
   *  on. Means nothing on a persona's three clips: the persona carries it. */
  clipable: boolean;
  /** Which way Pauv was when this was recorded — see VidTheme. Asked of a
   *  Bottom B as it is filed; null on everything else. */
  theme: VidTheme | null;
}

/** A still filed among the footage. End takes photos as well as clips — every
 *  build finishes on him showing what he made, and sometimes that is a
 *  screenshot rather than a recording — so the build holds it as a freeze frame
 *  for as long as its window runs. Anything that plays a clip has to ask this
 *  first: a photo has no duration, no sound and nothing to seek. */
export const isPhoto = (v: { mimeType: string }): boolean => v.mimeType.startsWith('image/');

/** A named bundle of the three clips that always travel together: the full-screen
 *  Start and the two top-half clips. Picking a persona fills all three slots at
 *  once, so a build only ever chooses one. Each id may be null while the bundle
 *  is being put together, or if that clip was later deleted from the cloud
 *  (the FK is ON DELETE SET NULL — losing a clip must not lose the persona). */
export interface VidPersona {
  id: string;
  name: string;
  startId: string | null;
  topAId: string | null;
  topBId: string | null;
  /** One context for the bundle — set by right-clicking the persona. */
  context: string;
  /** On offer to the clippers, all three clips with it — see VidClipable. */
  clipable: boolean;
  /** A degen persona. Said once when it is made (Degen or Not degen, no
   *  default), and switched after from the 💀 beside the trash on its row in
   *  Edit & file, where making one degen asks first. Every persona made before
   *  the flag existed is degen. */
  degen: boolean;
  createdAt: string;
}

/** The persona fields that hold a clip, in the order the UI shows them. */
export const PERSONA_PARTS = ['startId', 'topAId', 'topBId'] as const;
export type PersonaPart = (typeof PERSONA_PARTS)[number];
export const PERSONA_PART_LABEL: Record<PersonaPart, string> = {
  startId: 'Start',
  topAId: 'Top A',
  topBId: 'Top B',
};

// ── Links ─────────────────────────────────────────────────────────────────────
// Which Bottom B clips follow on from which Bottom A. A screen recording of a
// search only makes sense before the recording of the thing it found — so the
// pair is written down the moment the Build page's Bottom card makes one (it
// renders the ChatGPT search for the person whose Bottom B you picked, so it
// knows the two go together), and the builder offers (and Random picks) only
// those. A Bottom A with no pair yet is treated as unlinked rather than
// unusable: its picker shows everything.

/** One pair: this Bottom B may follow that Bottom A. Many-to-many. */
export interface VidLink {
  bottomAId: string;
  bottomBId: string;
}

export interface VidsLibraryPayload {
  folders: VidFolder[];
  videos: VidRow[];
  personas: VidPersona[];
  /** Absent from a server that predates links — read as none. */
  links?: VidLink[];
  /** The approved songs and caption looks — see VidClipableFlag. Absent from
   *  a server that predates the flag — read as none approved. */
  clipable?: VidClipableFlag[];
}

/** POST /api/vids/videos/sign → short-lived upload targets for one clip. */
export interface SignUploadResponse {
  id: string;
  video: { path: string; url: string };
  thumb: { path: string; url: string } | null;
  /** The recording's own home, when the upload is a render and brings the
   *  recording it was made from along — the intake run's save. */
  source: { path: string; url: string } | null;
}

/** POST /api/vids/videos — registers a clip once its bytes are in the bucket. */
export interface CreateVideoInput {
  id: string;
  folderId: string | null;
  name: string;
  storagePath: string;
  thumbPath: string | null;
  mimeType: string;
  sizeBytes: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  /** Known at filing time when the clip was named, given its context and
   *  edited before it was ever uploaded — the intake run saves a clip only
   *  once all of that is settled — so the row is whole from its first moment
   *  rather than patched together afterwards. All optional: a plain upload
   *  from the library pane sends none of them. */
  context?: string;
  marks?: VidMark[];
  hasSfx?: boolean;
  /** Which way Pauv was, for a Bottom B — see VidTheme. */
  theme?: VidTheme | null;
  /** The recording the uploaded render was made from, and the edit that made
   *  it — the intake run edits before it ever uploads, so both arrive together.
   *  Left off when the file going up is the recording itself. */
  sourcePath?: string | null;
  edit?: VidEdit | null;
}

/** Browser-side metadata read off a file before upload. */
export interface VideoProbe {
  duration: number | null;
  width: number | null;
  height: number | null;
  thumb: Blob | null;
}

// ── Recipes ───────────────────────────────────────────────────────────────────
// Every build that is downloaded or saved gets a short code, and the code is
// the key to a record of exactly what went into it: the persona, each slot's
// clip and how it was framed, trimmed and sped, the bars, the sound, the output
// size, and every caption with its style and placement. A video that does well
// is brought back by its code — type it into the build page and the stage fills
// with that build — so it can be re-exported as it was, or tweaked from there.
//
// The code sits after the title in the file name ("Velo Ronaldo Salary - K7Q4M2")
// so it can be read straight off the video wherever it ends up.

/** Six characters, no letters that look like digits (no I, L, O) and no digits
 *  that look like letters (no 0, 1), so a code copied off a phone screen is
 *  never one of two things. */
export const RECIPE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECIPE_CODE_LENGTH = 6;
const RECIPE_CODE_RE = new RegExp(`^[${RECIPE_CODE_ALPHABET}]{${RECIPE_CODE_LENGTH}}$`);

export const isRecipeCode = (v: unknown): v is string => typeof v === 'string' && RECIPE_CODE_RE.test(v);

/** The code out of whatever was typed or pasted: the bare code in any case, or a
 *  whole file name with the code on the end of it. Null if nothing there is one. */
export function parseRecipeCode(raw: string): string | null {
  const tokens = raw.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (RECIPE_CODE_RE.test(tokens[i])) return tokens[i];
  }
  return null;
}

/** What a finished build is called: the three-word title, then its code. */
export const recipeName = (title: string, code: string) => `${title} - ${code}`;

/** One slot as it was in the build. The clip is referenced by id, and enough of
 *  it is written down beside that to make sense of the record after the clip has
 *  been renamed, re-edited or deleted. */
export interface RecipePick {
  videoId: string;
  videoName: string;
  /** The footage it was made with. A clip edited since points at a new object,
   *  which is how a restore knows the trim may no longer line up. */
  storagePath: string;
  muted: boolean;
  fit: 'height' | 'width';
  align: 'start' | 'center' | 'end';
  transform: { zoom: number; dx: number; dy: number };
  trim: { start: number; end: number | null };
  speed: number;
  /** Bottom B sitting dead centre rather than nudged left — see SlotPick.centred
   *  in lib/simpler/vidsPlan. Only a Vids 2 build writes it, and only Simpler's
   *  side of the restore reads it; a record without it is nudged, which is what
   *  every build before it was. */
  centred?: boolean;
}

export interface RecipeCaptionLine {
  text: string;
  oneLine: boolean;
  pos?: { x: number; y: number };
  /** When the writer placed the line itself (Bottom A on Fast): the clip
   *  second it comes up at. */
  at?: number;
}

/** Everything the builder needs to put a build back exactly as it was exported.
 *  Field for field the builder's own state, written plainly so the record stays
 *  readable in the database on its own. */
export interface VidBuildSpec {
  /** The persona that filled Start / Top A / Top B, if the three still matched one. */
  persona: { id: string; name: string } | null;
  picks: Partial<Record<'start' | 'topA' | 'topB' | 'bottomA' | 'bottomB' | 'end', RecipePick>>;
  bars: { middle: boolean; middleSize: number; outer: boolean; outerSize: number };
  /** How Bottom A plays: at its own speed, or sped up to fit ten seconds (see
   *  BottomAPace in lib/vidsPlan). Absent on builds written down before there
   *  was a choice — those played it at its own speed, which is Normal. */
  bottomAPace?: 'normal' | 'fast';
  roomTone: { on: boolean; level: number };
  /** The song under it, and how loud it sat. Absent on builds written down
   *  before music was a layer — those come back with no music, which is what
   *  they were exported with. */
  music?: { url: string | null; label: string; level: number };
  clipLevel: number;
  /** How loud the BOOMs landed. Simpler lays them; Vids has none, so its
   *  records leave this out. */
  boomLevel?: number;
  /** Output preset id — '9:16', '1:1', '4:5', '16:9'. */
  preset: string;
  /** Every BOOM laid over the top of the whole frame, and the timeline second
   *  each landed on, in the order they were laid. Absent on a build that had
   *  none — and on everything written down before there was one to lay. */
  booms?: {
    videoId: string; videoName: string; at: number;
    /** The bang it was laid with, absent on a silent one. */
    sound?: { url: string; label: string };
    /** False when it was laid for its noise alone and nothing was drawn — see
     *  BoomInsert.picture in lib/simpler/vidsPlan. Absent is the ordinary kind. */
    picture?: boolean;
  }[];
  /** What a record written while only one BOOM was allowed called it. Still
   *  read, so those records still say what they said. */
  boom?: { videoId: string; videoName: string; at: number };
  captions: {
    lines: {
      start: RecipeCaptionLine;
      bottomA: RecipeCaptionLine[];
      bottomB: RecipeCaptionLine[];
      /** The comment line, the only one over the closing clip. */
      end: RecipeCaptionLine;
    };
    styleId: string;
    /** How big they were drawn, as a multiple of the look's own size (see
     *  scaleCaptionStyle in lib/simpler/vidsCaptions). Absent on records
     *  written before the size could be moved, and on every Vids record —
     *  those were all drawn at the look's own size, which is 1. */
    size?: number;
    notes: string;
    emojis: boolean;
  };
}

/** What the title is written from, over and above the build itself: the context
 *  on the persona and clips, which the record does not otherwise carry. */
export interface RecipeTitleBrief {
  personaContext: string;
  bottomAContext: string;
  bottomBContext: string;
  endContext: string;
}

export interface CreateRecipeInput {
  build: VidBuildSpec;
  brief: RecipeTitleBrief;
}

export interface VidRecipe {
  code: string;
  /** Three words, written by the model so the video is easy to pick out of a list. */
  title: string;
  /** `recipeName(title, code)` — what the file and the library row are called. */
  name: string;
  /** The library row it was saved as, when it was saved rather than downloaded
   *  (and while that row still exists). */
  videoId: string | null;
  build: VidBuildSpec;
  createdAt: string;
}
