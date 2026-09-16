// Shapes and limits shared between the AI Persona section and its API routes.
// Nothing in here imports the fal client, so the browser can read it too — the
// cards show the voice, the models and the price, and they have to come from the
// same place the routes use.

/** ElevenLabs v3 on fal. Every input except `voice` is left at its default. */
export const TTS_MODEL = 'fal-ai/elevenlabs/tts/eleven-v3';

/** The one voice this section speaks in. */
export const VOICE = 'Liam';

/** Kling's talking-avatar model — animates a still portrait to an audio track. */
export const AVATAR_MODEL = 'fal-ai/kling-video/ai-avatar/v2/standard';

/** fal's price for Kling's standard tier, per second of finished video. Shown
 *  before the job is submitted so the cost of a long script is never a surprise.
 *  Kling matches the video length to the mp3, so the mp3's duration is the bill. */
export const AVATAR_USD_PER_SEC = 0.0562;

/** Portraits bigger than this are refused. Next's middleware tops out at a 10MB
 *  body, and a portrait needs nothing like that. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Long enough for a minute or so of speech — about $4 of Kling at the rate
 *  above. Past that the price climbs faster than the idea is worth. */
export const MAX_SCRIPT_CHARS = 1500;

/** Formats Kling accepts as the avatar. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** A recording can stand in for ElevenLabs: uploaded as it is, and handed to
 *  Kling in place of the mp3. These are the formats Kling reads; checked by
 *  extension, because browsers disagree on what to call an m4a. */
export const VOICE_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac'];
export const isVoiceFile = (f: { name: string }) =>
  VOICE_EXTENSIONS.includes(f.name.split('.').pop()?.toLowerCase() ?? '');

/** Under Next's 10MB request cap — ten minutes of mp3, about one of WAV. */
export const MAX_VOICE_BYTES = 9.5 * 1024 * 1024;

/** Rough reading pace, characters a second — only used to show how long a script
 *  will run before it has been read. The mp3 itself is measured once it lands. */
export const CHARS_PER_SEC = 15;

/** How hard the finish pass leans on the picture, 0–100. The ask was "not a
 *  ton", and this is the low end of noticeable: enough to read as a recording,
 *  not as a filter. It is a knob rather than a constant because re-running costs
 *  nothing — the pass is local ffmpeg, not fal. The sound has its own switch and
 *  strength: audio muffler mode, 100 being the saved mix (lib/audioMuffler). */
export const FINISH_DEFAULT = 45;

/** The muffled soundtrack goes up to the finish route as a mono 16-bit WAV at
 *  this rate. The muffler's phone mic keeps the sound well under 16 kHz, so
 *  nothing it makes is lost, and a script at the length limit (about 100s,
 *  ~6MB) stays under Next's 10MB request cap. */
export const MUFFLED_UPLOAD_RATE = 32000;
export const MAX_MUFFLED_BYTES = 9.5 * 1024 * 1024;

/** POST /api/ai-persona/photo — the uploaded portrait, now on fal storage. */
export interface PhotoResponse {
  /** Public fal URL. Kling reads the avatar from here. */
  imageUrl: string;
}

/** POST /api/ai-persona/voice — the script read aloud by ElevenLabs, or an
 *  uploaded recording put on fal storage as it is. */
export interface VoiceResponse {
  /** Public fal URL of the audio. Kling reads it from here. */
  audioUrl: string;
  /** Which voice said it — Liam, or "your recording" for an upload. */
  voice: string;
  /** How long the call took, for the log line. */
  ms: number;
}

/** POST /api/ai-persona/avatar — the Kling job, just submitted. */
export interface AvatarResponse {
  /** fal queue id. Poll GET /api/ai-persona/avatar?requestId=… with it. */
  requestId: string;
}

/** GET /api/ai-persona/avatar?requestId=… — where that job has got to. */
export interface AvatarStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
  /** Place in fal's queue, while it is still waiting for a machine. */
  queuePosition?: number;
  /** Anything Kling printed while running. */
  logs?: string[];
  /** Set once status is COMPLETED. */
  videoUrl?: string;
  /** Seconds of finished video — Kling matches it to the mp3. */
  duration?: number;
}

/** Every route answers a failure as { error } with a 4xx/5xx. */
export interface ErrorResponse {
  error: string;
}
