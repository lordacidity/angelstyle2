// What the finish pass does to a clip's picture, as numbers. Pure — it imports
// nothing and touches nothing, so the whole treatment can be read, printed and
// compared in one place. roughen.ts is what runs it.
//
// What gives an AI clip away is how clean it is. A real recording comes off a
// camera that is slightly soft in places and grainy in others, and a codec that
// was not being kind. So: a base softness, a little more of it for a second here
// and there, temporal grain with occasional grainier patches, a slow exposure
// and contrast wobble, and a CRF high enough to leave the compression faintly
// visible.
//
// The sound is not in here. It is audio muffler mode (lib/audioMuffler), which
// runs in the browser and arrives as its own track, so the picture and the
// sound are each switched and strengthened on their own.
//
// Everything scales off one 0..1 strength, and every "here and there" window is
// drawn from a seeded PRNG — so a seed is a take: the same one redraws exactly
// the same clip, a new one is a new take.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Seeded PRNG (mulberry32) — a seed always redraws the same take. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scattered [start, end] spans across the clip — the "here and there". */
function windows(duration: number, rnd: () => number, everyS: number, minLen: number, maxLen: number): [number, number][] {
  const out: [number, number][] = [];
  let t = rnd() * everyS * 0.8;
  while (t < duration - minLen) {
    const end = Math.min(duration, t + minLen + rnd() * (maxLen - minLen));
    if (end - t >= minLen * 0.6) out.push([t, end]);
    t = end + everyS * (0.6 + rnd() * 0.9);
  }
  return out;
}

/** An ffmpeg `enable` expression covering those spans, or '' for none. Quoted at
 *  the call site so its commas survive the filtergraph parser. */
const spansExpr = (w: [number, number][]) =>
  w.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+');

export interface RoughenPlan {
  /** -filter_complex graph, [0:v] in and [v] out. */
  filter: string;
  crf: number;
}

/** Work out the picture's treatment for one clip. */
export function planRoughen({ strength, duration, seed }: {
  /** 0..1. */
  strength: number;
  /** Seconds, for placing the windows. */
  duration: number;
  seed: number;
}): RoughenPlan {
  const s = clamp01(strength);
  const rnd = mulberry32(seed);

  // Two gaussians compose to sqrt(a²+b²), so the extra pass over a window is a
  // small lift on top of the base rather than a jump — no visible step at the
  // edges, just a moment that is a touch softer.
  const baseSigma = lerp(0.22, 0.80, s);
  const extraSigma = lerp(0.18, 0.45, s);
  const grain = Math.round(lerp(2, 13, s));
  const extraGrain = Math.round(lerp(1, 7, s));
  const crf = Math.round(lerp(21, 33, s));

  const softSpans = spansExpr(windows(duration, rnd, 5, 0.7, 1.8));
  const grainSpans = spansExpr(windows(duration, rnd, 3.5, 0.5, 1.4));

  // A cheap camera hunting its exposure. Tiny — single-digit thousandths.
  const brightAmp = lerp(0.003, 0.012, s);
  const contrastAmp = lerp(0.008, 0.030, s);
  const brightPeriod = lerp(6, 11, rnd());
  const contrastPeriod = lerp(5, 9, rnd());

  const vChain = [
    `gblur=sigma=${baseSigma.toFixed(3)}`,
    softSpans && `gblur=sigma=${extraSigma.toFixed(3)}:enable='${softSpans}'`,
    `noise=alls=${grain}:allf=t+u:all_seed=${seed % 2147483647}`,
    grainSpans && `noise=alls=${extraGrain}:allf=t+u:all_seed=${(seed * 7 + 13) % 2147483647}:enable='${grainSpans}'`,
    `eq=brightness='${brightAmp.toFixed(4)}*sin(2*PI*t/${brightPeriod.toFixed(2)})'` +
      `:contrast='1+${contrastAmp.toFixed(4)}*sin(2*PI*t/${contrastPeriod.toFixed(2)})':eval=frame`,
    'format=yuv420p',
  ].filter(Boolean).join(',');

  return { filter: `[0:v]${vChain}[v]`, crf };
}
