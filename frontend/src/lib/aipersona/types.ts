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

/** A character's profile picture: the photo redrawn as a funny round-friendly
 *  headshot, by the same image model at `medium` — it is a small picture, and
 *  it only has to read at a glance. */
export const AVATAR_QUALITY = 'medium' as const;
export const AVATAR_PROMPT =
  "Make a funny profile picture of the character in #image1: a tight, centered head-and-shoulders shot, square, with a goofy exaggerated expression and a plain bold single-colour background. Keep the character's face, hair, clothes and look exactly as in #image1. The face fills the middle of the frame so it can be cropped to a circle.";

/** Moves the character first frame the way the scene's video moves. Kling's
 *  pro tier (standard until 2026-10-02, and briefly again that day): the same
 *  inputs and the same limits as standard, a better picture, and a higher
 *  price per second. */
export const MOTION_MODEL = 'fal-ai/kling-video/v2.6/pro/motion-control';

/** What the image model is told, unless it is edited before Go. */
export const DEFAULT_FRAME_PROMPT =
  "Replace the man in #image1 with the character from #image2. Keep the character's clothes and look from #image2. Match only the background, lighting, and body position, of the person in #image1.";

/** What Kling is told. The brackets are a blank to fill in: nothing is sent
 *  to Kling while a prompt still has one in it — see hasBlank. What follows
 *  the blank is said of every video: the camera holds still, the lens doesn't
 *  change, and the character keeps its look — only the movement is the video's. */
export const DEFAULT_MOTION_PROMPT =
  'A man [briefly what he is doing, just a few words]. Do not move the camera or zoom in, the video should be still and stable the whole time. Do not refocus or change the lens. Keep the person in #image1 looking EXACTLY the same, only change their hand and body movements to match #video1';

/** A prompt that still has a bracket in it has not been filled in. */
export const hasBlank = (prompt: string) => /[[\]]/.test(prompt);

export const MAX_PROMPT_CHARS = 2000;
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
  sceneName: string;
  url: string;
  /** The character first frame it was made from; the poster. */
  frameUrl: string | null;
  savedAt: string;
}

export interface Persona {
  id: string;
  name: string;
  photoUrl: string;
  /** Its round profile picture, once one has been made. */
  avatarUrl: string | null;
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
  videoPrompt: string;
  takes: SceneTake[];
  createdAt: string;
}

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
}

// ── Requests ─────────────────────────────────────────────────────────────────

/** POST /api/ai-persona/upload — where the browser should PUT a file. A photo
 *  is a character photo; a source is the video a scene is cut from. */
export interface UploadRequest {
  kind: 'photo' | 'source';
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
}

/** Every route answers a failure as { error } with a 4xx/5xx. */
export interface ErrorResponse {
  error: string;
}
