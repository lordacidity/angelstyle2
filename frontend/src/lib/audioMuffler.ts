'use client';

// Audio muffler — a clean recording roughed up until it stops sounding like a
// studio. The Audio Editor (Studio > Audio Editor) is where the ten effects get
// tuned by ear; AUDIO_MUFFLER below is the mix that was settled on there, and
// "audio muffler mode" anywhere on the site means running a recording through
// muffle() — or renderMix() with AUDIO_MUFFLER, if the room tone is already
// loaded. Browser only: it needs Web Audio.
//
// One OfflineAudioContext pass does everything Web Audio has a node for; the
// low-bitrate crunch, which it doesn't, is plain JS on the result. The editor's
// preview plays the rendered buffer itself, so what you hear is the file.
//
// The chain runs in the order a bad recording happens: the voice bounces off
// the room, the room's own noise joins it, a cheap mic hears both, the phone
// levels and clips what the mic hands it, the speaker wanders, the electronics
// add hiss and hum, and the file is saved small last.

import { ROOM_TONE_URL, decodeAudio, roomToneGain } from '@/lib/vidsAudio';

export type EffectId =
  | 'room' | 'phone' | 'echo' | 'autogain' | 'hiss' | 'hum' | 'clip' | 'bitrate' | 'wobble' | 'drift';

/** `amount` is 0–100, as the slider shows it. */
export interface Effect { on: boolean; amount: number }
export type Settings = Record<EffectId, Effect>;

export const EFFECTS: { id: EffectId; label: string; hint: string }[] = [
  { id: 'room', label: 'Room tone', hint: 'Our room recording looped underneath. 30 is where Vids sits it.' },
  { id: 'phone', label: 'Phone mic', hint: 'Mono, with the lows and highs rolled off. Higher is tinnier.' },
  { id: 'echo', label: 'Room echo', hint: 'The voice bouncing off the walls of a small room.' },
  { id: 'autogain', label: 'Auto gain', hint: "A phone's leveler: squashes loud words, lifts the room between them." },
  { id: 'hiss', label: 'Hiss', hint: "A cheap mic's noise floor." },
  { id: 'hum', label: 'Hum', hint: '60 Hz electrical buzz, like a charger plugged in nearby.' },
  { id: 'clip', label: 'Clipping', hint: 'Too close to the mic: loud bits crunch and flatten.' },
  { id: 'bitrate', label: 'Low bitrate', hint: 'Saved small: dull and crunchy, like a voice memo sent twice.' },
  { id: 'wobble', label: 'Wobble', hint: 'A slight pitch waver, like a Bluetooth mic or old tape.' },
  { id: 'drift', label: 'Drift', hint: 'Volume wanders, as if they keep turning their head.' },
];

export const DEFAULT_SETTINGS: Settings = {
  room: { on: true, amount: 30 },
  phone: { on: false, amount: 50 },
  echo: { on: false, amount: 50 },
  autogain: { on: false, amount: 50 },
  hiss: { on: false, amount: 50 },
  hum: { on: false, amount: 50 },
  clip: { on: false, amount: 50 },
  bitrate: { on: false, amount: 50 },
  wobble: { on: false, amount: 50 },
  drift: { on: false, amount: 50 },
};

/** Audio muffler mode — every effect on, at the levels picked by ear in the
 *  Audio Editor on 2026-09-16. Change these only on purpose: this is what
 *  "audio muffler mode" refers to. */
export const AUDIO_MUFFLER: Settings = {
  room: { on: true, amount: 2 },
  phone: { on: true, amount: 61 },
  echo: { on: true, amount: 16 },
  autogain: { on: true, amount: 49 },
  hiss: { on: true, amount: 30 },
  hum: { on: true, amount: 15 },
  clip: { on: true, amount: 39 },
  bitrate: { on: true, amount: 28 },
  wobble: { on: true, amount: 24 },
  drift: { on: true, amount: 56 },
};

/** Audio muffler mode at `strength` percent of itself. 100 is AUDIO_MUFFLER
 *  exactly; anything else moves every amount by the same factor, so the ten
 *  effects keep their balance. The top of the range stops where the strongest
 *  of them (phone, 61) is still under 100, so nothing is clipped out of step. */
export const MUFFLER_MAX_STRENGTH = 150;
export function scaleMuffler(strength: number): Settings {
  const k = Math.min(MUFFLER_MAX_STRENGTH, Math.max(0, strength)) / 100;
  const out = {} as Settings;
  for (const id of Object.keys(AUDIO_MUFFLER) as EffectId[]) {
    out[id] = { on: AUDIO_MUFFLER[id].on, amount: AUDIO_MUFFLER[id].amount * k };
  }
  return out;
}

/** A recording in audio muffler mode, room tone and all. */
export async function muffle(voice: AudioBuffer, strength = 100): Promise<AudioBuffer> {
  const room = await decodeAudio(new OfflineAudioContext(1, 1, voice.sampleRate), ROOM_TONE_URL);
  return renderMix(voice, room, scaleMuffler(strength));
}

/** Room tone's 0–100 covers four times the Vids room level, so the Vids
 *  default (1.2) lands on 30 and there is headroom above it. */
const ROOM_SPAN = 4;
const ROOM_UNIT = roomToneGain({ on: true, level: 1 });

const db = (d: number) => Math.pow(10, d / 20);

export async function renderMix(voice: AudioBuffer, room: AudioBuffer | null, s: Settings): Promise<AudioBuffer> {
  const rate = voice.sampleRate;
  const ctx = new OfflineAudioContext(2, voice.length, rate);
  const amt = (id: EffectId) => (s[id].on ? Math.min(100, Math.max(0, s[id].amount)) / 100 : 0);

  const src = ctx.createBufferSource();
  src.buffer = voice;
  src.start(0);

  let node: AudioNode = src;
  const pipe = (next: AudioNode) => { node.connect(next); node = next; };

  // Room echo — dry voice plus a short, dark reverb.
  const echo = amt('echo');
  if (echo > 0) {
    const mix = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1 - echo * 0.35;
    const conv = ctx.createConvolver();
    conv.buffer = roomImpulse(ctx, 0.3 + echo * 0.5);
    const wet = ctx.createGain();
    wet.gain.value = echo * 0.9;
    node.connect(dry).connect(mix);
    node.connect(conv).connect(wet).connect(mix);
    node = mix;
  }

  // Room tone — joins before the mic, so everything after colours it too.
  const sum = ctx.createGain();
  pipe(sum);
  const roomAmt = amt('room');
  if (room && roomAmt > 0) {
    const bed = ctx.createBufferSource();
    bed.buffer = room;
    bed.loop = true;
    const g = ctx.createGain();
    g.gain.value = ROOM_UNIT * roomAmt * ROOM_SPAN;
    bed.connect(g).connect(sum);
    bed.start(0, Math.random() * room.duration);
  }

  // Phone mic — mono whenever it's on; the band narrows as it goes up.
  if (s.phone.on) {
    const phone = amt('phone');
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    mono.channelInterpretation = 'speakers';
    pipe(mono);
    if (phone > 0) {
      pipe(biquad(ctx, 'highpass', 80 + phone * 370, 0.9));
      pipe(biquad(ctx, 'lowpass', 16000 * Math.pow(3200 / 16000, phone), 0.9));
      pipe(biquad(ctx, 'peaking', 1700, 0.8, phone * 6));
    }
  }

  // Auto gain — the compressor's own makeup gain does the lifting.
  const squash = amt('autogain');
  if (squash > 0) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12 - squash * 33;
    comp.knee.value = 4;
    comp.ratio.value = 3 + squash * 17;
    comp.attack.value = 0.002;
    comp.release.value = 0.25;
    pipe(comp);
  }

  // Clipping — drive into a curve that runs out at ±0.9, then trim most of the drive back off.
  const clip = amt('clip');
  if (clip > 0) {
    const drive = ctx.createGain();
    drive.gain.value = db(clip * 20);
    const shaper = ctx.createWaveShaper();
    shaper.curve = clipCurve();
    shaper.oversample = 'none';
    const trim = ctx.createGain();
    trim.gain.value = db(-clip * 14);
    pipe(drive); pipe(shaper); pipe(trim);
  }

  // Drift — a slow, smooth level wander of up to -8 dB.
  const drift = amt('drift');
  if (drift > 0 && voice.duration > 0.1) {
    const g = ctx.createGain();
    g.gain.setValueCurveAtTime(driftCurve(voice.duration, drift), 0, voice.duration);
    pipe(g);
  }

  // Hiss and hum — the electronics, added under whatever the mic made.
  const out = ctx.createGain();
  pipe(out);
  const hiss = amt('hiss');
  if (hiss > 0) {
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx, 4);
    n.loop = true;
    const g = ctx.createGain();
    g.gain.value = db(-62 + hiss * 34);
    n.connect(biquad(ctx, 'highpass', 400, 0.7)).connect(biquad(ctx, 'lowpass', 9000, 0.7)).connect(g).connect(out);
    n.start(0);
  }
  const hum = amt('hum');
  if (hum > 0) {
    const g = ctx.createGain();
    g.gain.value = db(-58 + hum * 30);
    g.connect(out);
    [1, 0.5, 0.25, 0.12].forEach((level, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = 60 * (i + 1);
      const h = ctx.createGain();
      h.gain.value = level;
      osc.connect(h).connect(g);
      osc.start(0);
    });
  }

  // Wobble — a delay line whose length is swung by a slow wow and a quick flutter.
  const wobble = amt('wobble');
  if (wobble > 0) {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = 0.02;
    for (const [freq, depth] of [[0.6, 0.0035], [5.5, 0.00012]] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const d = ctx.createGain();
      d.gain.value = wobble * depth;
      osc.connect(d).connect(delay.delayTime);
      osc.start(0);
    }
    pipe(delay);
  }

  // Low bitrate — band-limit here, then hold and quantize the samples once rendered.
  // Every part of it starts from the file as it is and slides from there, so a
  // little is a little: the rate falls from the file's own to 5 kHz, the bit
  // depth from 16 to 7, and the crunch is faded in over the top of the dulling.
  const crush = amt('bitrate');
  const crushRate = rate * Math.pow(5000 / rate, crush);
  if (crush > 0) pipe(biquad(ctx, 'lowpass', crushRate * 0.45, 0.7));

  node.connect(ctx.destination);
  const rendered = await ctx.startRendering();
  if (crush > 0) crushInPlace(rendered, crushRate, 16 - crush * 9, crush);
  return rendered;
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number, gain = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.gain.value = gain;
  return f;
}

/** Decaying stereo noise, darkened as it goes — a small, hard-walled room. */
function roomImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.round(seconds * ctx.sampleRate));
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (0.55 - 0.4 * t) * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-6.9 * t);
    }
  }
  return ir;
}

function noise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

let clipCurveCache: Float32Array<ArrayBuffer> | null = null;
/** Straight up to ±0.6, then a soft knee into ±0.9. Anything past ±1 in holds the end value. */
function clipCurve(): Float32Array<ArrayBuffer> {
  if (clipCurveCache) return clipCurveCache;
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4));
  }
  return (clipCurveCache = curve);
}

/** Gain over the whole clip, a point every 50 ms: three slow sines at random phases, 0 to -8 dB. */
function driftCurve(duration: number, amount: number): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.ceil(duration * 20) + 1);
  const waves = [[0.09, 1], [0.17, 0.6], [0.31, 0.35]].map(([f, a]) => ({ f, a, p: Math.random() * Math.PI * 2 }));
  const total = waves.reduce((t, w) => t + w.a, 0);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * duration;
    const w = waves.reduce((v, { f, a, p }) => v + a * Math.sin(2 * Math.PI * f * t + p), 0) / total;
    curve[i] = db(-amount * 8 * (0.5 + 0.5 * w));
  }
  return curve;
}

/** Sample-and-hold down to `rate`, rounded to `bits` (fractional is fine), mixed in at `mix` over the input. */
function crushInPlace(buf: AudioBuffer, rate: number, bits: number, mix: number): void {
  const step = buf.sampleRate / rate;
  const levels = Math.pow(2, bits - 1);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let held = 0;
    let next = 0;
    for (let i = 0; i < d.length; i++) {
      if (i >= next) { held = Math.round(d[i] * levels) / levels; next += step; }
      d[i] += mix * (held - d[i]);
    }
  }
}

/** 16-bit PCM WAV. */
export function toWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const bytes = buf.length * ch * 2;
  const v = new DataView(new ArrayBuffer(44 + bytes));
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([v], { type: 'audio/wav' });
}
