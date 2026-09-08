'use client';

// The sound a Vid carries. Footage audio is never one of these: Prep drops it
// on every clip it saves and the builder mutes every slot that isn't carrying
// keys, so everything you can hear in an export was added here on purpose.
//
//   keyboard   typing, laid over the stretches a clip marks. Placed per clip in
//              Prep and baked into that clip's file (see lib/vidsEdit).
//   room tone  a room breathing under the whole thing, laid once across the
//              finished timeline at export (see lib/vidsCompose). One
//              continuous bed rather than a per-clip layer — that is the point
//              of room tone, and it means the joins between clips stop sounding
//              like joins.
//   music      a song, chosen per build from the tracks the app already holds,
//              laid across the finished timeline the same way the room is.
//
// The first two are files the app serves rather than anything in the clip
// bucket: they are the same bytes for every clip, so they belong with the code
// and load from our own origin — no CORS, and localhost behaves like
// production. Music is served from that same origin for the same reasons; it
// is only picked at build time rather than fixed here.

/** Typing. Placed per clip, in Prep. */
export const SFX_URL = '/audio/keyboard-typing.wav';
/** An empty room. Laid under the whole export. */
export const ROOM_TONE_URL = '/audio/room-tone.mp3';

/** The recording is a quiet one — peak -22 dBFS, RMS about -43 dBFS, measured
 *  off the file itself — so a gain of 1 would be nowhere near audible under a
 *  video. This is the multiplier that lands it around -34 dBFS RMS, which is
 *  where a room sits under speech: present when you listen for it, not a track
 *  in its own right. Replacing room-tone.mp3 means measuring again. */
const ROOM_TONE_UNITY = 2.8;

/** Room tone is on unless someone turns it off. `level` is relative to the
 *  bed level above: 1 sounds like the room, 0 is off, 2 is as far up as it
 *  goes before it stops being background. The default sits a little above the
 *  room's own level — the clips come down to meet it (see DEFAULT_CLIP_LEVEL),
 *  and the two together are what these videos sound like. */
export interface RoomTone {
  on: boolean;
  level: number;
}
export const MIN_ROOM_LEVEL = 0;
export const MAX_ROOM_LEVEL = 2;
export const DEFAULT_ROOM_TONE: RoomTone = { on: true, level: 1.2 };
export const clampRoomLevel = (v: number): number =>
  Number.isFinite(v) ? Math.min(MAX_ROOM_LEVEL, Math.max(MIN_ROOM_LEVEL, v)) : DEFAULT_ROOM_TONE.level;

/** The level as a gain the mixer can use. */
export const roomToneGain = (tone: RoomTone): number => clampRoomLevel(tone.level) * ROOM_TONE_UNITY;

/** How loud the clips themselves sit. The only thing they carry is a keyboard
 *  Prep baked in, so this is really "how far under the room the typing sits".
 *  Attenuation only: an <audio>/<video> element can't go above 1, and holding
 *  the ceiling here is what keeps the stage preview and the export identical.
 *  The default is under the ceiling rather than at it, so the typing sits in
 *  the room instead of on top of it. */
export const MIN_CLIP_LEVEL = 0;
export const MAX_CLIP_LEVEL = 1;
export const DEFAULT_CLIP_LEVEL = 0.6;
export const clampClipLevel = (v: number): number =>
  Number.isFinite(v) ? Math.min(MAX_CLIP_LEVEL, Math.max(MIN_CLIP_LEVEL, v)) : DEFAULT_CLIP_LEVEL;

// ── Music ─────────────────────────────────────────────────────────────────────
// A song under the whole video, picked per build from public/audio — the same
// library the charts and carousel pages draw on, so a track saved there is
// here without a deploy. Like room tone it is one continuous layer laid across
// the finished timeline rather than anything per-clip.
//
// Unlike room tone there is no unity multiplier hiding behind the level: these
// are mastered tracks, already at level, so `level` is the gain itself. 1 is
// the track as it was mastered — loud enough to be the video — and the default
// sits it under speech.

/** One track, as /api/charts/list-audio hands it over. */
export interface MusicTrack {
  url: string;
  label: string;
  durationMs: number;
}

export interface Music {
  /** The chosen track, or null for no music. */
  url: string | null;
  /** What it was called when it was chosen. Written down with a build so an
   *  old record can still name the song it used after the file has gone. */
  label: string;
  level: number;
}
export const MIN_MUSIC_LEVEL = 0;
export const MAX_MUSIC_LEVEL = 1;
/** A little under the track as it was mastered: the song is the sound of these
 *  videos, but leaving it short of the ceiling keeps room for what the clips
 *  carry and off the encoder's limit. Move it per build either way. */
export const DEFAULT_MUSIC_LEVEL = 0.7;
export const DEFAULT_MUSIC: Music = { url: null, label: '', level: DEFAULT_MUSIC_LEVEL };
export const clampMusicLevel = (v: number): number =>
  Number.isFinite(v) ? Math.min(MAX_MUSIC_LEVEL, Math.max(MIN_MUSIC_LEVEL, v)) : DEFAULT_MUSIC_LEVEL;

/** The level as a gain the mixer can use. Nothing chosen is nothing to hear. */
export const musicGain = (m: Music): number => (m.url ? clampMusicLevel(m.level) : 0);

/** Long enough that a song opens and closes rather than being switched on and
 *  cut off — and long enough to cover the seam where a short track comes round
 *  again under a longer build. */
export const MUSIC_FADE = 0.6;

/** The tracks there are to choose from. Listed by the server rather than named
 *  here, so whatever is in public/audio is what the picker offers. */
export async function listMusic(signal?: AbortSignal): Promise<MusicTrack[]> {
  const r = await fetch('/api/charts/list-audio', { signal });
  if (!r.ok) throw new Error(`Couldn't load the music library (${r.status}).`);
  const rows: unknown = await r.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((t): t is MusicTrack => !!t && typeof t.url === 'string' && typeof t.label === 'string')
    .map((t) => ({ url: t.url, label: t.label, durationMs: Number(t.durationMs) || 0 }));
}

// ── Loading ───────────────────────────────────────────────────────────────────
// Bytes are fetched once per url per page and kept; decoding happens per
// context, because an AudioBuffer belongs to the context that made it and the
// preview and the encoder each have their own. decodeAudioData detaches what it
// is handed, so every decode gets a copy and the cache stays reusable.

const bytes = new Map<string, Promise<ArrayBuffer>>();

export function loadAudioBytes(url: string): Promise<ArrayBuffer> {
  const cached = bytes.get(url);
  if (cached) return cached;
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load ${url} (${r.status}).`);
      return r.arrayBuffer();
    })
    .catch((e) => {
      bytes.delete(url);   // one failed fetch must not poison every later attempt
      throw e;
    });
  bytes.set(url, p);
  return p;
}

export async function decodeAudio(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  return ctx.decodeAudioData((await loadAudioBytes(url)).slice(0));
}

// ── Scheduling ────────────────────────────────────────────────────────────────

/** A stretch of the output to fill, in output seconds. */
export interface Span { start: number; end: number }

/** Long enough to hide a click at either end, short enough not to swallow the
 *  first keystroke. */
const FADE = 0.02;

export interface LoopOptions {
  /** Seconds into the sample every pass opens at. Left out, each run opens at a
   *  random point — which is what a bed wants and what a song does not: a song
   *  should start where it starts, so music passes 0. */
  from?: number;
  /** Fade at both ends, in seconds. Defaults to just enough to hide a click. */
  fade?: number;
}

/** Lay a sample across one span, looping to fill it and fading both ends. Each
 *  run starts at a random point in the sample unless `from` says otherwise, so
 *  two spans in one render don't come out as the same take twice — and a bed
 *  longer than the clip never opens on the same second every time. */
export function scheduleLoop(
  ctx: BaseAudioContext, sample: AudioBuffer, span: Span, gain: number, opts: LoopOptions = {},
): void {
  const len = span.end - span.start;
  if (len <= 0 || gain <= 0) return;
  const fade = Math.min(opts.fade ?? FADE, len / 2);
  const src = ctx.createBufferSource();
  src.buffer = sample;
  src.loop = true;
  const g = ctx.createGain();
  src.connect(g).connect(ctx.destination);
  g.gain.setValueAtTime(0, span.start);
  g.gain.linearRampToValueAtTime(gain, span.start + fade);
  g.gain.setValueAtTime(gain, Math.max(span.start + fade, span.end - fade));
  g.gain.linearRampToValueAtTime(0, span.end);
  src.start(span.start, opts.from ?? Math.random() * sample.duration);
  src.stop(span.end);
}
