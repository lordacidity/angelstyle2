'use client';

// The veil: a faint tint and a faint grain laid over every frame of a build,
// rolled once per build, so no two videos made from the same clips share a
// pixel. It is meant to be all but invisible — a wash of colour a couple of
// percent strong and a speckle a couple of percent strong — and it is there
// because a platform that sees the same frames go up twice treats the second
// as a repost, and the persona clips go up in every video made here.
//
// Both the stage (Vids2Builder draw) and the exporter (vidsCompose) lay it on
// last, over the pictures, the words and the BOOMs alike, through the same
// call — so the stage shows what the file will carry, and a video brought
// back by its code (VidBuildSpec.veil) comes back under the veil it went out
// under. Everything about a veil is drawn from its seed, so the seed is all
// the record keeps.
//
// The other half of the same idea is the Start clip's nudge — see
// rollStartNudge in lib/vids2/vids2Build.

/** Everything the veil is, worked out from `seed`. */
export interface Veil {
  seed: number;
  /** The wash, as 0–255 channels, and how strong it is (an alpha). */
  tint: [number, number, number];
  tintAlpha: number;
  /** How strong the speckle is (an alpha). */
  grainAlpha: number;
}

/** How strong the wash may be — never more than a few percent. */
const TINT_ALPHA: [number, number] = [0.01, 0.025];
/** How strong the speckle may be. */
const GRAIN_ALPHA: [number, number] = [0.015, 0.03];
/** The grain tile's side, in output px. Repeated across the frame. */
const GRAIN_TILE = 192;
/** Seeds are 32-bit, so the record's number stays an integer. */
const SEED_MAX = 0xffffffff;

/** A small fast PRNG (mulberry32): the same seed always gives the same veil —
 *  the same wash, the same tile — which is what lets the record keep only the
 *  seed. (The pixels that come of it can still differ by one between a GPU
 *  and a CPU raster of the same blend; nothing here needs them not to.) */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);

/** The veil a seed stands for. */
export function veilFromSeed(seed: number): Veil {
  const s = Number.isFinite(seed) ? Math.max(0, Math.min(SEED_MAX, Math.floor(seed))) : 0;
  const r = prng(s);
  return {
    seed: s,
    tint: [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)],
    tintAlpha: between(r, TINT_ALPHA[0], TINT_ALPHA[1]),
    grainAlpha: between(r, GRAIN_ALPHA[0], GRAIN_ALPHA[1]),
  };
}

/** A fresh veil, for a new build. */
export const rollVeil = (): Veil => veilFromSeed(Math.floor(Math.random() * SEED_MAX));

/** A veil off a record, or null when the record has none — a build from
 *  before there was one goes back out as it was, with no veil. */
export const veilFromRecord = (seed: unknown): Veil | null =>
  (typeof seed === 'number' && Number.isFinite(seed) ? veilFromSeed(seed) : null);

// The grain tile per seed, and the pattern per context — a pattern belongs to
// the context that made it, and the stage and the exporter each have their own.
const tiles = new Map<number, HTMLCanvasElement>();
const patterns = new WeakMap<CanvasRenderingContext2D, { seed: number; pattern: CanvasPattern }>();

/** One tile of speckle: every pixel its own grey, off the seed. */
function grainTile(seed: number): HTMLCanvasElement | null {
  const cached = tiles.get(seed);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = GRAIN_TILE;
  c.height = GRAIN_TILE;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  // Its own stream, so the tile is the same whatever else the seed was asked
  // for first.
  const r = prng(seed ^ 0x9e3779b9);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.floor(r() * 256);
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Only a handful are ever wanted per page; keep it from growing unbounded
  // all the same.
  if (tiles.size > 16) tiles.clear();
  tiles.set(seed, c);
  return c;
}

/** Lay the veil over a finished frame. `W`×`H` is the output frame, in the
 *  units the context is drawing in — the stage draws in output px under a
 *  transform, the exporter at 1:1, and both hand the same numbers. Leaves
 *  the context's alpha and composite as it found them. */
export function drawVeil(ctx: CanvasRenderingContext2D, W: number, H: number, veil: Veil | null): void {
  if (!veil) return;
  const alpha = ctx.globalAlpha;
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'source-over';
  // The wash.
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(${veil.tint[0]},${veil.tint[1]},${veil.tint[2]},${veil.tintAlpha})`;
  ctx.fillRect(0, 0, W, H);
  // The speckle.
  const tile = grainTile(veil.seed);
  if (tile) {
    let entry = patterns.get(ctx);
    if (!entry || entry.seed !== veil.seed) {
      const pattern = ctx.createPattern(tile, 'repeat');
      if (pattern) {
        entry = { seed: veil.seed, pattern };
        patterns.set(ctx, entry);
      } else {
        entry = undefined;
      }
    }
    if (entry) {
      ctx.globalAlpha = veil.grainAlpha;
      ctx.fillStyle = entry.pattern;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
}
