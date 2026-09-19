'use client';

// The sound a Vid carries. Footage audio is never one of these: Prep drops it
// on every clip it saves and the builder mutes every slot that isn't carrying
// keys, so everything you can hear in an export was added here on purpose.
//
//   keyboard   typing, laid over the stretches a clip marks. Placed per clip in
//              Prep and baked into that clip's file (see lib/vidsEdit).
//   room tone  a room breathing under the whole thing, laid once across the
//              finished timeline at export (see lib/simpler/vidsCompose). One
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
import { withBase } from '@/lib/clipping';

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
  const r = await fetch(withBase('/api/charts/list-audio'), { signal });
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
  const p = fetch(withBase(url))
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

// ── Speed ─────────────────────────────────────────────────────────────────────
// Playing a buffer faster moves its pitch: the samples come out sooner and every
// frequency in them rises by the same factor, which is what makes a sped-up clip
// sound like a cartoon. Vids changes speed in several places — the builder's
// per-slot rate, Prep's per-clip one — and none of it is meant to change how
// anything sounds, so speed is applied here instead of as a playback rate.
//
// The sound is cut into short pieces and those pieces are laid down closer
// together (faster) or further apart (slower) than they were taken, each joined
// to the last at the offset where the two waveforms line up. Every piece plays
// at its own rate, so pitch never moves; only how often a piece is repeated or
// skipped does. That is WSOLA, and it is the same thing an <audio> element does
// for you under preservesPitch — which is what the previews use. Doing it by
// hand is what lets the export agree with them: an OfflineAudioContext has no
// pitch-preserving rate of its own.

/** How long one piece is. Long enough to carry the pitch of a voice, short
 *  enough that a join lands inside a syllable rather than across two. */
const STRETCH_SEQ = 0.082;
/** The crossfade at each join. */
const STRETCH_OVERLAP = 0.012;
/** How far past the nominal read point the next piece may be taken from, hunting
 *  for the offset whose waveform matches the tail already written. This search is
 *  the whole difference between WSOLA and plain overlap-add, and it is what keeps
 *  the joins from ringing. */
const STRETCH_SEEK = 0.028;
/** A crossfade shorter than this can't hide its own join, so a clip too short to
 *  afford one is handed back cut instead of stretched. At any real sample rate
 *  this is well under a millisecond of audio. */
const MIN_OVERLAP = 32;

/** Time-scale `buffer` by `rate` without moving its pitch: the result is
 *  `buffer.duration / rate` long and sounds the same note. Scheduled at the
 *  default playback rate of 1, it is the export's answer to preservesPitch —
 *  so 2× plays twice as fast and still sounds like the person who said it.
 *
 *  Returns the buffer itself at 1×, and always keeps the source's own sample
 *  rate, so the graph resamples on playback exactly as it did before. */
export function stretchToRate(ctx: BaseAudioContext, buffer: AudioBuffer, rate: number): AudioBuffer {
  if (!(rate > 0) || Math.abs(rate - 1) < 1e-6) return buffer;

  const sr = buffer.sampleRate;
  const chans = Math.max(1, buffer.numberOfChannels);
  const inLen = buffer.length;
  const outLen = Math.max(1, Math.round(inLen / rate));
  const src: Float32Array[] = [];
  const dst: Float32Array[] = [];
  const out = ctx.createBuffer(chans, outLen, sr);
  for (let c = 0; c < chans; c++) {
    src.push(buffer.getChannelData(c));
    dst.push(out.getChannelData(c));
  }

  let overlap = Math.round(STRETCH_OVERLAP * sr);
  let seq = Math.round(STRETCH_SEQ * sr);
  let seek = Math.round(STRETCH_SEEK * sr);
  // A clip too short to hold one piece and its search gets smaller pieces rather
  // than none — after this, seq + seek is inside the source by construction and
  // every read below is in range.
  if (seq + seek >= inLen) {
    const f = (inLen - 1) / (seq + seek);
    overlap = Math.floor(overlap * f);
    seq = Math.floor(seq * f);
    seek = Math.floor(seek * f);
  }
  if (overlap < MIN_OVERLAP || seq < 2 * overlap + 1) {
    // A fragment, not a sound: there is nothing here to join cleanly, so hand
    // back whatever fits at the length asked for.
    const n = Math.min(inLen, outLen);
    for (let c = 0; c < chans; c++) dst[c].set(src[c].subarray(0, n), 0);
    return out;
  }

  // One channel to line the joins up on: a stereo pair has to be cut at the same
  // instant in both, or the image between them moves at every join. Unnormalised
  // — the correlation below divides the level back out.
  let mono = src[0];
  if (chans > 1) {
    mono = new Float32Array(inLen);
    for (let c = 0; c < chans; c++) {
      const s = src[c];
      for (let i = 0; i < inLen; i++) mono[i] += s[i];
    }
  }

  const flat = seq - overlap;   // output samples one piece contributes
  const step = flat * rate;     // input samples the read point advances per piece
  const lastBase = Math.max(0, inLen - seq);
  // The overlap already written, which the next piece is lined up against and
  // then faded into.
  const tail: Float32Array[] = [];
  for (let c = 0; c < chans; c++) tail.push(new Float32Array(overlap));
  const tailMono = new Float32Array(overlap);

  // The first piece has nothing to join to, so it is taken as it stands.
  let written = Math.min(flat, outLen);
  for (let c = 0; c < chans; c++) {
    dst[c].set(src[c].subarray(0, written), 0);
    tail[c].set(src[c].subarray(flat, seq));
  }
  tailMono.set(mono.subarray(flat, seq));

  // Every offset at sample resolution would cost more than the rest of the
  // render put together, so: a coarse sweep, then a fine pass around the winner.
  const coarse = Math.max(1, seek >> 6);

  for (let i = 1; written < outLen; i++) {
    // Clamped to the last full piece, so a slowed-down clip goes on repeating its
    // ending rather than running off the end into silence.
    const base = Math.min(Math.round(i * step), lastBase);
    const span = Math.min(seek, inLen - seq - base);
    let best = 0;
    let bestScore = -Infinity;
    const score = (d: number) => {
      let corr = 0;
      let energy = 1e-9;
      for (let j = 0; j < overlap; j++) {
        const s = mono[base + d + j];
        corr += s * tailMono[j];
        energy += s * s;
      }
      // Divided by the piece's own level, so the join is chosen on the shape of
      // the waveform rather than on whichever offset happens to be loudest.
      return corr / Math.sqrt(energy);
    };
    for (let d = 0; d <= span; d += coarse) {
      const v = score(d);
      if (v > bestScore) { bestScore = v; best = d; }
    }
    for (let d = Math.max(0, best - coarse + 1), hi = Math.min(span, best + coarse - 1); d <= hi; d++) {
      const v = score(d);
      if (v > bestScore) { bestScore = v; best = d; }
    }

    const p = base + best;
    const n = Math.min(flat, outLen - written);
    const ov = Math.min(overlap, n);
    for (let c = 0; c < chans; c++) {
      const s = src[c];
      const d0 = dst[c];
      const t = tail[c];
      // Linear, not equal-power: the search above has already lined the two up,
      // so they add rather than fight, and a linear ramp holds the level.
      for (let j = 0; j < ov; j++) {
        const w = j / overlap;
        d0[written + j] = t[j] * (1 - w) + s[p + j] * w;
      }
      if (n > ov) d0.set(s.subarray(p + ov, p + n), written + ov);
      t.set(s.subarray(p + flat, p + seq));
    }
    tailMono.set(mono.subarray(p + flat, p + seq));
    written += n;
  }

  return out;
}
