// Knockout physics, shared by the live game and the bot's planning.

export type Team = 0 | 1;
export interface Disc { x: number; y: number; vx: number; vy: number; team: Team; ax: number; ay: number; out: number }

export const DISC = 0.075;     // piece radius, board starts at radius 1
export const MAX_PULL = 0.5;   // longest drag that counts
export const POWER = 10;       // launch speed per unit of pull
export const DRAG = 1.3;       // exponential slow-down per second
export const STEP = 1 / 120;
export const MIN_R = 0.5;
export const SHRINK = 0.92;

export const nextRadius = (r: number) => Math.max(MIN_R, r * SHRINK);

/** One physics tick: move, slow down, collide, and start falls off the edge. */
export function step(discs: Disc[], r: number) {
  const f = Math.exp(-DRAG * STEP);
  for (const d of discs) {
    d.x += d.vx * STEP;
    d.y += d.vy * STEP;
    d.vx *= f;
    d.vy *= f;
    if (Math.hypot(d.vx, d.vy) < 0.03) d.vx = d.vy = 0;
    if (d.out) d.out = Math.min(1, d.out + STEP * 2.5);
    else if (Math.hypot(d.x, d.y) > r) d.out = 0.001;
  }
  const live = discs.filter((d) => !d.out);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0 || dist >= DISC * 2) continue;
      const nx = dx / dist, ny = dy / dist;
      const push = (DISC * 2 - dist) / 2;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      const p = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (p > 0) {
        const k = p * 0.96;
        a.vx -= k * nx; a.vy -= k * ny;
        b.vx += k * nx; b.vy += k * ny;
      }
    }
  }
}

export const anyMoving = (discs: Disc[]) => discs.some((d) => !d.out && (d.vx || d.vy));
