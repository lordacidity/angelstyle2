'use client';

// The mouse, for the generated "screen recordings" — the ChatGPT clip and the
// Pauv trade one. Both use the same sounds, so a Bottom A and a Bottom B cut
// together sound like one recording:
//
//   the keyboard  public/audio/keyboard-typing.wav, the recording the rest of
//                 the app already types with (lib/vidsAudio SFX_URL). The
//                 ChatGPT clip loops it over its typing; the trade clip lays
//                 one keystroke out of it on every character (mixKeys).
//   the mouse     synthesised here. There is no click in the library, and a
//                 click has to land on the exact frame the picture acts on,
//                 which a loop cannot do.
//
// The clicks are mixed into the rendered keyboard bed rather than scheduled
// beside it, so a clip's sound is one buffer: the file gets it, and the
// preview plays that same buffer.

/** Deterministic noise for the small variations between clicks. */
export function sfxRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A press on its own (a drag begins this way), a release on its own (it ends
 *  that way), or the pair — which is what a click is. */
export type ClickKind = 'press' | 'release' | 'full';
/** One click, in clip seconds. */
export interface ClickEvent { t: number; kind: ClickKind }

/** Where a click sits against the keyboard. The recording peaks at 0.81 and
 *  its loudest keystroke holds about 0.15 RMS over 30ms; laid at the app's
 *  usual typing gain that is a peak near 0.65, and this puts a click's peak
 *  beside it — a shade brighter, the way a switch is against a keycap, not a
 *  louder event. Re-measure the wav (scratchpad measure-sfx.mjs) if it is
 *  ever replaced. */
export const CLICK_GAIN = 0.7;

/**
 * A mouse click: a hard broadband snap, the shell ringing briefly over it, and
 * a little body underneath. Dry and short — a switch, not a knock. The release
 * is quieter and duller than the press, and `full` writes both about 90ms
 * apart, the way a finger actually comes off a button.
 *
 * Mixed into `out` (one channel of audio you already have) at `at` seconds.
 */
export function writeClick(out: Float32Array, sampleRate: number, at: number, gain: number, kind: ClickKind, rnd: () => number): void {
  const press = kind !== 'release';
  const start = Math.round(at * sampleRate);
  const ring = (press ? 3200 : 2350) + rnd() * 900;
  const decay = press ? 520 : 760;
  const g = gain * (press ? 1 : 0.5) * (0.85 + rnd() * 0.3);
  const n = Math.round(0.035 * sampleRate);
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= out.length) continue;
    const u = i / sampleRate;
    out[idx] += g * (
      0.7 * Math.exp(-u * 900) * (rnd() * 2 - 1)
      + 0.35 * Math.exp(-u * decay) * Math.sin(2 * Math.PI * ring * u)
      + 0.12 * Math.exp(-u * 260) * Math.sin(2 * Math.PI * 520 * u)
    );
  }
  if (kind === 'full') writeClick(out, sampleRate, at + 0.085 + rnd() * 0.02, gain, 'release', rnd);
}

// ── The keyboard, a key at a time ───────────────────────────────────────────
/** Clean single keystrokes in keyboard-typing.wav: where each one's transient
 *  starts, in seconds. Each is strong (peak 0.6 or more) with at least 95ms
 *  to itself either side, so a KEY_LEN slice holds that key and nothing of the
 *  next. Re-measure (scratchpad keys.mjs) if the wav is ever replaced. */
const KEYSTROKES = [
  0.1179, 1.1773, 2.0944, 2.8323, 3.552, 4.0558, 5.8902, 7.8904, 8.4615, 9.4834, 10.3512, 11.0164,
  11.3517, 11.8149, 12.856, 13.5055, 14.4607, 15.0194, 15.7305, 16.5669, 17.1644, 17.7054, 18.4248, 19.1599,
];
const KEY_LEN = 0.09;
/** Taken from just before the transient, so its very start isn't cut. */
const KEY_PREROLL = 0.003;
const KEY_FADE = 0.015;
/** Two keys closer than this blur into one sound; the later one waits. */
const KEY_MIN_GAP = 0.03;

/**
 * One keystroke out of the recording for every time in `times`, its transient
 * on that time: a character that appears on a frame is heard on that frame,
 * which a loop of the recording can't do. Mixed into `bed` in place; run
 * mixClicks after it, which holds the result in range.
 */
export function mixKeys(bed: AudioBuffer, sample: AudioBuffer, times: readonly number[], seed: number, gain: number): void {
  const rnd = sfxRandom(seed ^ 0x51ed27);
  const rate = bed.sampleRate;
  const step = sample.sampleRate / rate;
  const n = Math.round((KEY_PREROLL + KEY_LEN) * rate);
  const fadeN = KEY_FADE * rate;
  let last = -Infinity;
  let prev = -1;
  for (const at of [...times].sort((a, b) => a - b)) {
    const t = Math.max(at, last + KEY_MIN_GAP);
    last = t;
    let k = Math.floor(rnd() * KEYSTROKES.length);
    if (k === prev) k = (k + 1) % KEYSTROKES.length;
    prev = k;
    const g = gain * (0.8 + rnd() * 0.3);
    const from = (KEYSTROKES[k] - KEY_PREROLL) * sample.sampleRate;
    const start = Math.round((t - KEY_PREROLL) * rate);
    for (let ch = 0; ch < bed.numberOfChannels; ch++) {
      const out = bed.getChannelData(ch);
      const src = sample.getChannelData(Math.min(ch, sample.numberOfChannels - 1));
      for (let i = 0; i < n; i++) {
        const o = start + i;
        const s = Math.round(from + i * step);
        if (o < 0 || o >= out.length || s >= src.length) continue;
        out[o] += g * Math.min(1, (n - i) / fadeN) * src[s];
      }
    }
  }
}

/**
 * Lays the clicks over a rendered bed, in place, and holds the result in
 * range. Every channel gets the same seed, so a click sits in the middle of
 * the picture rather than wandering across it.
 */
export function mixClicks(bed: AudioBuffer, clicks: readonly ClickEvent[], seed: number, gain = CLICK_GAIN): void {
  for (let ch = 0; ch < bed.numberOfChannels; ch++) {
    const data = bed.getChannelData(ch);
    const rnd = sfxRandom(seed);
    for (const c of clicks) writeClick(data, bed.sampleRate, c.t, gain, c.kind, rnd);
    for (let i = 0; i < data.length; i++) data[i] = data[i] < -1 ? -1 : data[i] > 1 ? 1 : data[i];
  }
}
