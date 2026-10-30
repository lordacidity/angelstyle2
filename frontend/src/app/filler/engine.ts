// Filler: two players flood a grid of colored tiles from opposite corners.
// Each turn you pick a color (never your own, never the opponent's), your
// whole territory turns that color, and every touching tile of that color
// joins it. More than half the board wins.
//
// Pure logic, no React: the page and the bot both run on this.

export const W = 8;
export const H = 7;
export const N = W * H;
export const COLOR_COUNT = 6;

/** Player 1 (you) starts bottom-left, player 2 (the bot) top-right. */
export const START: [number, number] = [(H - 1) * W, W - 1];

export const NEIGHBORS: number[][] = Array.from({ length: N }, (_, i) => {
  const x = i % W;
  const y = (i / W) | 0;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (y > 0) out.push(i - W);
  if (y < H - 1) out.push(i + W);
  return out;
});

export type Player = 1 | 2;

export interface State {
  /** Color of each tile. Owned tiles carry their owner's current color. */
  color: Uint8Array;
  /** 0 = unclaimed, 1 or 2 = owner. */
  owner: Uint8Array;
  /** Tiles owned by each player: [unused, p1, p2]. */
  score: [number, number, number];
}

export const other = (p: Player): Player => (p === 1 ? 2 : 1);
export const colorOf = (s: State, p: Player) => s.color[START[p - 1]];

export function newGame(rand: () => number = Math.random): State {
  const color = new Uint8Array(N);
  for (;;) {
    for (let i = 0; i < N; i++) {
      const banned = new Set<number>();
      if (i % W > 0) banned.add(color[i - 1]);
      if (i >= W) banned.add(color[i - W]);
      let c: number;
      do c = (rand() * COLOR_COUNT) | 0;
      while (banned.has(c));
      color[i] = c;
    }
    if (color[START[0]] !== color[START[1]]) break;
  }
  const owner = new Uint8Array(N);
  owner[START[0]] = 1;
  owner[START[1]] = 2;
  return { color, owner, score: [0, 1, 1] };
}

export function legalColors(s: State): number[] {
  const a = colorOf(s, 1);
  const b = colorOf(s, 2);
  const out: number[] = [];
  for (let c = 0; c < COLOR_COUNT; c++) if (c !== a && c !== b) out.push(c);
  return out;
}

/**
 * Plays `c` for `p` into a new state. Also returns the tiles gained, in flood
 * order, so the page can ripple them in.
 */
export function play(s: State, p: Player, c: number): { state: State; gained: number[] } {
  const color = s.color.slice();
  const owner = s.owner.slice();
  const gained: number[] = [];
  for (let i = 0; i < N; i++) {
    if (owner[i] === p) color[i] = c;
  }
  // Seed with unclaimed tiles of color c touching the territory, then spread.
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (owner[i] !== p) continue;
    for (const j of NEIGHBORS[i]) {
      if (!seen[j] && owner[j] === 0 && color[j] === c) {
        seen[j] = 1;
        gained.push(j);
      }
    }
  }
  for (let k = 0; k < gained.length; k++) {
    const i = gained[k];
    owner[i] = p;
    for (const j of NEIGHBORS[i]) {
      if (!seen[j] && owner[j] === 0 && color[j] === c) {
        seen[j] = 1;
        gained.push(j);
      }
    }
  }
  const score: [number, number, number] = [0, s.score[1], s.score[2]];
  score[p] += gained.length;
  return { state: { color, owner, score }, gained };
}

export function isOver(s: State): boolean {
  return s.score[1] * 2 > N || s.score[2] * 2 > N || s.score[1] + s.score[2] === N;
}

// ── The bot ──────────────────────────────────────────────────────────────────

export type Difficulty = 'easy' | 'medium' | 'hard';

class Timeout extends Error {}

/** Unclaimed tiles each player could reach before the other, by BFS race. */
function territoryEstimate(s: State): number {
  const dist1 = bfs(s, 1);
  const dist2 = bfs(s, 2);
  let v = 0;
  for (let i = 0; i < N; i++) {
    if (s.owner[i] !== 0) continue;
    if (dist1[i] < dist2[i]) v++;
    else if (dist2[i] < dist1[i]) v--;
  }
  return v;
}

/** Distance in color-changes from p's territory to each unclaimed tile. */
function bfs(s: State, p: Player): Uint8Array {
  const d = new Uint8Array(N).fill(255);
  const q: number[] = [];
  for (let i = 0; i < N; i++) if (s.owner[i] === p) { d[i] = 0; q.push(i); }
  // 0-1 BFS: stepping onto a same-colored unclaimed tile is free.
  const dq = new Int16Array(N * 16);
  let head = N * 8, tail = N * 8;
  for (const i of q) dq[tail++] = i;
  while (head < tail) {
    const i = dq[head++];
    for (const j of NEIGHBORS[i]) {
      if (s.owner[j] !== 0) continue;
      const free = s.owner[i] === 0 && s.color[i] === s.color[j];
      const nd = d[i] + (free ? 0 : 1);
      if (nd < d[j]) {
        d[j] = nd;
        if (free) dq[--head] = j;
        else dq[tail++] = j;
      }
    }
  }
  return d;
}

function evaluate(s: State, p: Player): number {
  const o = other(p);
  if (s.score[p] * 2 > N) return 10000 + s.score[p] - s.score[o];
  if (s.score[o] * 2 > N) return -10000 + s.score[p] - s.score[o];
  if (isOver(s)) return 0;
  const est = territoryEstimate(s);
  return (s.score[p] - s.score[o]) + 0.5 * (p === 1 ? est : -est);
}

function negamax(s: State, p: Player, depth: number, alpha: number, beta: number, deadline: number): number {
  if (depth === 0 || isOver(s)) return evaluate(s, p);
  if (performance.now() > deadline) throw new Timeout();
  const kids = legalColors(s).map((c) => play(s, p, c));
  kids.sort((a, b) => b.gained.length - a.gained.length);
  let best = -Infinity;
  for (const k of kids) {
    const v = -negamax(k.state, other(p), depth - 1, -beta, -alpha, deadline);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function searchRoot(s: State, p: Player, depth: number, deadline: number, first: number | null) {
  const moves = legalColors(s)
    .map((c) => ({ c, ...play(s, p, c) }))
    .sort((a, b) => (a.c === first ? -1 : b.c === first ? 1 : b.gained.length - a.gained.length));
  let bestC = moves[0].c;
  let alpha = -Infinity;
  for (const m of moves) {
    const v = -negamax(m.state, other(p), depth - 1, -Infinity, -alpha, deadline);
    if (v > alpha) { alpha = v; bestC = m.c; }
  }
  return bestC;
}

export function botMove(s: State, p: Player, level: Difficulty): number {
  const moves = legalColors(s);
  if (level === 'easy') {
    if (Math.random() < 0.35) return moves[(Math.random() * moves.length) | 0];
    let best = moves[0], gain = -1;
    for (const c of moves) {
      const g = play(s, p, c).gained.length;
      if (g > gain) { gain = g; best = c; }
    }
    return best;
  }
  if (level === 'medium') {
    return searchRoot(s, p, 3, Infinity, null);
  }
  // Hard: iterative deepening for as long as the budget allows.
  const deadline = performance.now() + 900;
  let best = searchRoot(s, p, 2, Infinity, null);
  for (let depth = 3; depth <= 24; depth++) {
    try {
      best = searchRoot(s, p, depth, deadline, best);
    } catch (e) {
      if (e instanceof Timeout) break;
      throw e;
    }
    if (N - s.score[1] - s.score[2] < depth / 2) break; // searched to the end
  }
  return best;
}
