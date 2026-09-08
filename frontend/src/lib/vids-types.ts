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

export interface VidsLibraryPayload {
  folders: VidFolder[];
  videos: VidRow[];
  personas: VidPersona[];
}

/** POST /api/vids/videos/sign → short-lived upload targets for one clip. */
export interface SignUploadResponse {
  id: string;
  video: { path: string; url: string };
  thumb: { path: string; url: string } | null;
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
}

export interface RecipeCaptionLine {
  text: string;
  oneLine: boolean;
  pos?: { x: number; y: number };
}

/** Everything the builder needs to put a build back exactly as it was exported.
 *  Field for field the builder's own state, written plainly so the record stays
 *  readable in the database on its own. */
export interface VidBuildSpec {
  /** The persona that filled Start / Top A / Top B, if the three still matched one. */
  persona: { id: string; name: string } | null;
  picks: Partial<Record<'start' | 'topA' | 'topB' | 'bottomA' | 'bottomB' | 'end', RecipePick>>;
  bars: { middle: boolean; middleSize: number; outer: boolean; outerSize: number };
  roomTone: { on: boolean; level: number };
  /** The song under it, and how loud it sat. Absent on builds written down
   *  before music was a layer — those come back with no music, which is what
   *  they were exported with. */
  music?: { url: string | null; label: string; level: number };
  clipLevel: number;
  /** Output preset id — '9:16', '1:1', '4:5', '16:9'. */
  preset: string;
  captions: {
    lines: { start: RecipeCaptionLine; bottomA: RecipeCaptionLine[]; bottomB: RecipeCaptionLine[]; end: RecipeCaptionLine };
    styleId: string;
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
