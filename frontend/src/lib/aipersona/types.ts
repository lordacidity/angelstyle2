// Shapes and limits shared between the AI Persona section and its API routes.
// Nothing in here imports the fal client or the database, so the browser can
// read it too — the prompts, the models and the limits have to come from the
// same place the routes use.
//
// The section in one breath: a persona is a name and a character photo. A scene
// is a video of someone doing something. For every persona in the scene, the
// video's first frame is redrawn with that persona in it (the "character first
// frame"), and once those are approved, Kling moves each one the way the video
// moves. Approved videos are saved to the personas.

/** Redraws the first frame with the persona in it. #image1 is the frame,
 *  #image2 the character photo — the order they are sent in. */
export const FRAME_MODEL = 'openai/gpt-image-2.5/sunburst/edit';

/** How hard the image model works on a character first frame: low, medium,
 *  high, xhigh or max. `high` is the model's own default; this asks for one
 *  above it. The levels above `high` draw more detail and are billed for it —
 *  the model is charged by the token, and fal publishes no price per level. */
export const FRAME_QUALITY: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'xhigh';

/** A character's profile picture: the photo redrawn as a plain, straight
 *  headshot on white, by the same image model at `medium` — it is a small picture, and
 *  it only has to read at a glance. */
export const AVATAR_QUALITY = 'medium' as const;
export const AVATAR_PROMPT =
  "Make a profile picture of the character in #image1: a tight, centered head-and-shoulders shot, square, facing the camera with a neutral expression, not smiling, on a plain pure white background. Keep the character's face, hair, clothes and look exactly as in #image1. The face fills the middle of the frame so it can be cropped to a circle.";

/** Moves the character first frame the way the scene's video moves. Kling's
 *  pro tier (standard until 2026-10-02, and briefly again that day): the same
 *  inputs and the same limits as standard, a better picture, and a higher
 *  price per second. */
export const MOTION_MODEL = 'fal-ai/kling-video/v2.6/pro/motion-control';

/** What the image model is told, unless it is edited before Go. */
export const DEFAULT_FRAME_PROMPT =
  "Replace the man in #image1 with the character from #image2. Keep the character's clothes and look from #image2. Match only the background, lighting, and body position, of the person in #image1.";

/** What Kling is told. It opens with one sentence saying what is happening,
 *  and that whole sentence is the blank: the brackets stand where it goes, and
 *  nothing is sent to Kling while a prompt still has one in it — see hasBlank.
 *  What follows is said of every video: the camera holds still, the lens
 *  doesn't change, and the character keeps its look — only the movement is the
 *  video's. */
export const MOTION_BLANK = '[One sentence saying what is happening, e.g. A man walks into the gym]';
const MOTION_RULES =
  'Do not move the camera or zoom in, the video should be still and stable the whole time. Do not refocus or change the lens. Keep the person in #image1 looking EXACTLY the same, only change their hand and body movements to match #video1';

/** The sentence can be written ahead of time — on a saved scene, or beside a
 *  new one — so the Kling prompt arrives already filled in. No brackets in it:
 *  they are what marks a prompt as not filled in. */
export const MAX_ACTION_CHARS = 200;
export const cleanAction = (v: unknown) =>
  (typeof v === 'string' ? v : '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_ACTION_CHARS);

/** The Kling prompt for that sentence — or, with none, the one with the blank. */
export const motionPrompt = (action = '') => `${cleanAction(action).replace(/[.!?\s]+$/, '') || MOTION_BLANK}. ${MOTION_RULES}`;
export const DEFAULT_MOTION_PROMPT = motionPrompt();

/** A prompt that still has a bracket in it has not been filled in. */
export const hasBlank = (prompt: string) => /[[\]]/.test(prompt);

export const MAX_PROMPT_CHARS = 2000;
/** A first-frame prompt may run much longer — the one with a location is some
 *  eight thousand characters. This is the image model's own limit. */
export const MAX_FRAME_PROMPT_CHARS = 32_000;
export const MAX_NAME_CHARS = 80;

/** Kling follows the video's orientation, and in that mode it takes a video of
 *  up to this long. Measured after the trim and the speed-up. */
export const MAX_CLIP_SECONDS = 30;
/** And of at least this long — Kling's own floor. Checked before Go, so first
 *  frames are never paid for on a clip Kling would then turn away. */
export const MIN_CLIP_SECONDS = 3;

export const MIN_SPEED = 1;
export const MAX_SPEED = 3;
export const clampSpeed = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, n)) : 1;
};

/** How long the clip runs once it is cut and sped up. */
export const clipSeconds = (start: number, end: number, speed: number) => Math.max(0, end - start) / speed;

/** What the image model reads as a character photo. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;

// ── Rows ─────────────────────────────────────────────────────────────────────

/** A finished video, saved to a persona when its scene was approved. */
export interface PersonaVideo {
  /** The take it came from — see SceneTake. Deleting the video deletes this. */
  id: string;
  sceneId: string;
  /** What it is called: its scene's name, until it is given one of its own on
   *  the character's page (PATCH /api/ai-persona/takes/:id). */
  sceneName: string;
  url: string;
  /** The character first frame it was made from; the poster. */
  frameUrl: string | null;
  /** That frame small, for lists: GET /api/ai-persona/thumb, which makes it once. */
  thumbUrl: string | null;
  savedAt: string;
  /** The persona videos in Vids (their ids there) this was the start of, as
   *  "Make persona video" noted them. One since deleted in Vids is still
   *  listed, so it is read against what Vids has now. */
  usedIn: string[];
  /** Its scene's size in px (0 when unknown) — the shape a list holds open
   *  for its still while that loads. */
  width: number;
  height: number;
}

export interface Persona {
  id: string;
  name: string;
  photoUrl: string;
  /** The photo small, for lists: GET /api/ai-persona/thumb, which makes it once. */
  thumbUrl: string;
  /** Its round profile picture, once one has been made. */
  avatarUrl: string | null;
  /** Its room: a photo of the place this character is in, if one has been
   *  dropped in. Kept exactly as uploaded. Not used by scenes yet. */
  roomUrl: string | null;
  /** The room small, for the page. */
  roomThumbUrl: string | null;
  createdAt: string;
  /** Newest first. */
  videos: PersonaVideo[];
}

/** Where a scene has got to.
 *    frames  character first frames are being made and looked over
 *    prompt  they were approved; the Kling prompt is being written
 *    videos  Kling is running, or its videos are being looked over
 *    done    approved, and saved to the personas */
export type SceneStage = 'frames' | 'prompt' | 'videos' | 'done';
export const SCENE_STAGES: SceneStage[] = ['frames', 'prompt', 'videos', 'done'];

export type JobStatus = 'idle' | 'running' | 'done' | 'error';

/** One generation for one persona: its character first frame, or its video. */
export interface SceneJob {
  status: JobStatus;
  /** The result, once done. */
  url: string | null;
  /** What was asked for the last time it ran — the scene's prompt, or the one
   *  written for a redo. */
  prompt: string;
  error: string;
  /** While running: its place in fal's queue, when fal is still holding it
   *  there. Only on a poll; never stored. */
  queue?: number | null;
  /** While running: true once a machine has picked it up. Only on a poll. */
  working?: boolean;
  /** While running: why the last poll couldn't check on it, if it couldn't.
   *  The job itself may be fine. */
  note?: string;
}

/** One persona's run through a scene. */
export interface SceneTake {
  id: string;
  personaId: string;
  personaName: string;
  photoUrl: string;
  /** The photo small. */
  thumbUrl: string;
  /** The persona's profile picture, once one has been made: who the card is,
   *  at a glance — the badge by its name, and what stands in for a frame that
   *  is still being drawn. */
  avatarUrl: string | null;
  /** "Use location" was on for this persona when the scene was made: its
   *  first frame is drawn in its room (#image3), from the scene's prompt with
   *  location. */
  usesLocation: boolean;
  frame: SceneJob;
  video: SceneJob;
}

export interface Scene {
  id: string;
  name: string;
  stage: SceneStage;
  /** The video, trimmed and sped up — what Kling follows. */
  clipUrl: string;
  /** The very first frame of that clip — #image1. */
  frameUrl: string;
  width: number;
  height: number;
  duration: number;
  framePrompt: string;
  /** The first-frame prompt with location — what the takes with "Use
   *  location" on were asked with. Empty when none had it on. */
  locationPrompt: string;
  videoPrompt: string;
  takes: SceneTake[];
  createdAt: string;
}

/** A saved scene: a video cut and named once, on the Scenes page, and kept so
 *  any character can be put into it later ("Make scenes" on a character's
 *  page). Making one copies its clip and first frame into a scene of its own,
 *  so a saved scene is never used up or changed by being used. */
export interface SavedScene {
  id: string;
  name: string;
  /** The sentence saying what is happening in it — what the Kling prompt of
   *  a scene made from it opens with. Empty until one is written. */
  action: string;
  /** The video, trimmed and sped up — what Kling will follow. */
  clipUrl: string;
  /** Its very first frame — #image1. */
  frameUrl: string;
  /** That frame small, for lists. */
  thumbUrl: string;
  width: number;
  height: number;
  duration: number;
  createdAt: string;
}

/** The three kinds of video a character has, by what they are called: one
 *  with "trading" in its name is the trade, one with "end" as a word of its
 *  own (or "ending") is an ending, and everything else is a hook. A saved
 *  scene is sorted the same way, by its name, and a video made from it takes
 *  that name — so a scene called "Trading at desk" makes a Trading video. */
export const SCENE_KINDS = [
  { key: 'hook', label: 'Hook' },
  { key: 'trading', label: 'Trading' },
  { key: 'end', label: 'End' },
] as const;
export type SceneKind = (typeof SCENE_KINDS)[number]['key'];
export const sceneKind = (name: string): SceneKind =>
  (/trading/i.test(name) ? 'trading' : /\bend(ing)?\b/i.test(name) ? 'end' : 'hook');

/** A scene that has not been approved yet, as the front screen lists it. */
export interface SceneSummary {
  id: string;
  name: string;
  stage: SceneStage;
  frameUrl: string;
  personas: number;
  createdAt: string;
}

/** GET /api/ai-persona/personas — everything the front screen shows. */
export interface LibraryPayload {
  personas: Persona[];
  /** Scenes still in progress, newest first. */
  scenes: SceneSummary[];
  /** The saved scenes, oldest first. */
  saved: SavedScene[];
}

// ── Requests ─────────────────────────────────────────────────────────────────

/** POST /api/ai-persona/upload — where the browser should PUT a file. A photo
 *  is a character photo; a room is a photo of the place a character is in; a
 *  source is the video a scene is cut from. */
export interface UploadRequest {
  kind: 'photo' | 'room' | 'source';
  name: string;
  mime: string;
}
export interface UploadResponse {
  path: string;
  url: string;
}

/** POST /api/ai-persona/scenes — cut the clip, pull its first frame, and start
 *  a character first frame for every persona named. */
export interface CreateSceneRequest {
  name: string;
  /** From POST /api/ai-persona/upload, kind `source`. */
  sourcePath: string;
  /** Seconds into the upload where the scene starts and ends. */
  start: number;
  end: number;
  speed: number;
  prompt: string;
  personaIds: string[];
  /** The personas (of personaIds) with "Use location" on: drawn in their room,
   *  from locationPrompt instead of prompt. One with no room is passed over. */
  locationIds?: string[];
  /** The first-frame prompt with location. Needed when locationIds has any. */
  locationPrompt?: string;
  /** The sentence saying what is happening, for the Kling prompt later. */
  action?: string;
}

/** POST /api/ai-persona/saved — cut a video and keep it as a saved scene.
 *  Nothing goes to fal. */
export interface CreateSavedSceneRequest {
  name: string;
  /** The sentence saying what is happening, for the Kling prompt. */
  action?: string;
  /** From POST /api/ai-persona/upload, kind `source`. */
  sourcePath: string;
  start: number;
  end: number;
  speed: number;
}

/** POST /api/ai-persona/personas/:id/scenes — one character into each of the
 *  saved scenes named: a scene of its own for every one, its character first
 *  frame started. */
export interface MakeScenesRequest {
  savedIds: string[];
  prompt: string;
  /** Draw the first frames in the character's room, from locationPrompt. */
  useLocation?: boolean;
  locationPrompt?: string;
}

/** Every route answers a failure as { error } with a 4xx/5xx. */
export interface ErrorResponse {
  error: string;
}
