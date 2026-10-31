// The Knockout bot. It plans by trying shots in a private copy of the board
// and keeping the ones that end best for it.
//
// It cannot see your aim. planShots takes positions only (no arrows), and the
// game calls it at the start of the round, before you have touched anything.
// Hard plays around you by imagining random shots you might take, never the
// real ones.

import { MAX_PULL, POWER, anyMoving, nextRadius, step, type Disc, type Team } from './physics';

export type Level = 'easy' | 'medium' | 'hard';
export interface Piece { x: number; y: number; team: Team; out: boolean }
export interface Shot { ax: number; ay: number }

const NO_SHOT: Shot = { ax: 0, ay: 0 };

function simulate(pieces: Piece[], shots: Shot[], r: number): Disc[] {
  const discs: Disc[] = pieces.map((p, i) => ({
    x: p.x, y: p.y, team: p.team, ax: 0, ay: 0, out: p.out ? 1 : 0,
    vx: (shots[i]?.ax ?? 0) * POWER, vy: (shots[i]?.ay ?? 0) * POWER,
  }));
  for (let t = 0; t < 600 && anyMoving(discs); t++) step(discs, r);
  return discs;
}

/** How good the board is for `team` after the round, once it shrinks. */
function score(discs: Disc[], team: Team, r: number): number {
  const rn = nextRadius(r);
  let s = 0;
  for (const d of discs) {
    const dist = Math.hypot(d.x, d.y);
    const lost = d.out > 0 || dist > rn;
    if (d.team === team) s += lost ? -12 : -3 * (dist / rn) ** 4;
    else s += lost ? 10 : 1.5 * (dist / rn) ** 2;
  }
  return s;
}

function aimAt(from: Piece, tx: number, ty: number, offset: number, pull: number): Shot {
  const a = Math.atan2(ty - from.y, tx - from.x) + offset;
  return { ax: Math.cos(a) * pull, ay: Math.sin(a) * pull };
}

/** Plausible shots for the other side, invented at random: never the real ones. */
function guessOpponent(pieces: Piece[], team: Team): Shot[] {
  const targets = pieces.filter((p) => !p.out && p.team === team);
  return pieces.map((p) => {
    if (p.out || p.team === team || !targets.length || Math.random() < 0.2) return NO_SHOT;
    const t = targets[(Math.random() * targets.length) | 0];
    return aimAt(p, t.x, t.y, (Math.random() - 0.5) * 0.4, MAX_PULL * (0.4 + Math.random() * 0.6));
  });
}

export function planShots(pieces: Piece[], team: Team, r: number, level: Level): Shot[] {
  const shots: Shot[] = pieces.map(() => NO_SHOT);
  const mine = pieces.map((p, i) => i).filter((i) => !pieces[i].out && pieces[i].team === team);
  const enemies = pieces.filter((p) => !p.out && p.team !== team);
  if (!enemies.length) return shots;

  if (level === 'easy') {
    for (const i of mine) {
      if (Math.random() < 0.2) continue;
      const e = enemies[(Math.random() * enemies.length) | 0];
      shots[i] = aimAt(pieces[i], e.x, e.y, (Math.random() - 0.5) * 0.6, MAX_PULL * (0.3 + Math.random() * 0.7));
    }
    return shots;
  }

  const hard = level === 'hard';
  const offsets = hard ? [-0.16, -0.08, 0, 0.08, 0.16] : [-0.1, 0, 0.1];
  const pulls = (hard ? [0.44, 0.68, 0.84, 1] : [0.6, 1]).map((f) => f * MAX_PULL);
  // Hard scores each plan against a few imagined opponent turns as well as a
  // still one, so it avoids shots that only work if you stand still.
  const worlds: Shot[][] = [pieces.map(() => NO_SHOT)];
  if (hard) for (let k = 0; k < 3; k++) worlds.push(guessOpponent(pieces, team));
  const deadline = performance.now() + (hard ? 1500 : 400);

  const evaluate = () => {
    let total = 0;
    for (const w of worlds) {
      const combined = shots.map((s, i) => (pieces[i].team === team ? s : w[i]));
      total += score(simulate(pieces, combined, r), team, r);
    }
    return total / worlds.length;
  };

  for (let pass = 0; pass < (hard ? 2 : 1); pass++) {
    for (const i of mine) {
      const me = pieces[i];
      const candidates: Shot[] = [NO_SHOT, aimAt(me, 0, 0, 0, 0.15)];
      for (const e of enemies) for (const o of offsets) for (const p of pulls) candidates.push(aimAt(me, e.x, e.y, o, p));
      let best = shots[i], bestScore = -Infinity;
      for (const c of candidates) {
        shots[i] = c;
        const s = evaluate();
        if (s > bestScore) { bestScore = s; best = c; }
        if (performance.now() > deadline) break;
      }
      shots[i] = best;
      if (performance.now() > deadline) return shots;
    }
  }
  return shots;
}

