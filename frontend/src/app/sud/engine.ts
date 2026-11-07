// Sudoku engine: makes a full grid, digs it down to a puzzle with exactly one
// solution, and grades that puzzle by the techniques a person would need.
//
// Grids are 81 numbers, row-major, 0 for an empty cell. Candidates are 9-bit
// masks (bit d-1 set means digit d is still possible).

export type Grid = number[];
export type Difficulty = 'hard' | 'expert';

export interface Puzzle {
  givens: Grid;
  solution: Grid;
  difficulty: Difficulty;
}

const ALL = 0x1ff;
const ROW = new Array<number>(81);
const COL = new Array<number>(81);
const BOX = new Array<number>(81);
for (let i = 0; i < 81; i++) {
  ROW[i] = Math.floor(i / 9);
  COL[i] = i % 9;
  BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
}

/** The 27 units (9 rows, 9 columns, 9 boxes), each a list of 9 cell indices. */
export const UNITS: number[][] = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = Math.floor(b / 3) * 3, c0 = (b % 3) * 3;
  UNITS.push(Array.from({ length: 9 }, (_, k) => (r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3)));
}

/** Every cell that shares a row, column or box with cell i (20 of them). */
export const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const s = new Set<number>();
  for (let j = 0; j < 81; j++) if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) s.add(j);
  return [...s];
});

const bit = (d: number) => 1 << (d - 1);
const popcount = (m: number) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const lowestDigit = (m: number) => 31 - Math.clz32(m & -m) + 1;

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Backtracking solver ──────────────────────────────────────────────────────

/** Counts solutions of a grid, stopping once `limit` have been found. */
export function countSolutions(grid: Grid, limit = 2): number {
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const d = grid[i];
    if (!d) continue;
    const b = bit(d);
    if (rows[ROW[i]] & b || cols[COL[i]] & b || boxes[BOX[i]] & b) return 0;
    rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
  }
  const g = grid.slice();
  let count = 0;
  const step = (): void => {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
      const n = popcount(m);
      if (n < bestN) { bestN = n; best = i; bestMask = m; if (n <= 1) break; }
    }
    if (best === -1) { count++; return; }
    if (bestN === 0) return;
    let m = bestMask;
    while (m && count < limit) {
      const b = m & -m; m ^= b;
      g[best] = lowestDigit(b);
      rows[ROW[best]] |= b; cols[COL[best]] |= b; boxes[BOX[best]] |= b;
      step();
      rows[ROW[best]] ^= b; cols[COL[best]] ^= b; boxes[BOX[best]] ^= b;
      g[best] = 0;
    }
  };
  step();
  return count;
}

/** Solves a grid that is known to have a solution. */
export function solve(grid: Grid): Grid | null {
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  const g = grid.slice();
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const b = bit(g[i]);
    rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
  }
  const step = (): boolean => {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
      const n = popcount(m);
      if (n < bestN) { bestN = n; best = i; bestMask = m; if (n <= 1) break; }
    }
    if (best === -1) return true;
    let m = bestMask;
    while (m) {
      const b = m & -m; m ^= b;
      g[best] = lowestDigit(b);
      rows[ROW[best]] |= b; cols[COL[best]] |= b; boxes[BOX[best]] |= b;
      if (step()) return true;
      rows[ROW[best]] ^= b; cols[COL[best]] ^= b; boxes[BOX[best]] ^= b;
      g[best] = 0;
    }
    return false;
  };
  return step() ? g : null;
}

// ── Full grid ────────────────────────────────────────────────────────────────

function fullGrid(rnd: () => number): Grid {
  const g: Grid = new Array(81).fill(0);
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rnd);
    for (const d of digits) {
      const b = bit(d);
      if (rows[ROW[i]] & b || cols[COL[i]] & b || boxes[BOX[i]] & b) continue;
      g[i] = d; rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
      if (fill(i + 1)) return true;
      rows[ROW[i]] ^= b; cols[COL[i]] ^= b; boxes[BOX[i]] ^= b; g[i] = 0;
    }
    return false;
  };
  fill(0);
  return g;
}

// ── Human-technique grader ───────────────────────────────────────────────────
//
// Level 0: naked and hidden singles are enough.
// Level 1: also needs locked candidates or naked/hidden pairs and triples.
// Level 2: also needs X-wings.
// Level 3: all of that runs out before the grid is done. Needs chains or trial.

export type Level = 0 | 1 | 2 | 3;

function candidatesOf(grid: Grid): number[] | null {
  const c = new Array<number>(81);
  for (let i = 0; i < 81; i++) {
    if (grid[i]) { c[i] = 0; continue; }
    let m = ALL;
    for (const p of PEERS[i]) if (grid[p]) m &= ~bit(grid[p]);
    if (!m) return null;
    c[i] = m;
  }
  return c;
}

export function grade(givens: Grid): Level {
  const g = givens.slice();
  const cand = candidatesOf(g);
  if (!cand) return 3;
  let level: Level = 0;

  const place = (i: number, d: number) => {
    g[i] = d; cand[i] = 0;
    for (const p of PEERS[i]) cand[p] &= ~bit(d);
  };

  const singles = (): boolean => {
    let did = false;
    for (let i = 0; i < 81; i++) {
      if (!g[i] && popcount(cand[i]) === 1) { place(i, lowestDigit(cand[i])); did = true; }
    }
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        let where = -1, n = 0;
        for (const i of u) if (!g[i] && cand[i] & b) { n++; where = i; }
        if (n === 1) { place(where, d); did = true; }
      }
    }
    return did;
  };

  const locked = (): boolean => {
    let did = false;
    // Pointing: a digit confined to one row/column inside a box leaves that line elsewhere.
    for (let b = 0; b < 9; b++) {
      const box = UNITS[18 + b];
      for (let d = 1; d <= 9; d++) {
        const m = bit(d);
        const cells = box.filter((i) => !g[i] && cand[i] & m);
        if (cells.length < 2) continue;
        const rows = new Set(cells.map((i) => ROW[i])), cols = new Set(cells.map((i) => COL[i]));
        if (rows.size === 1) {
          const r = [...rows][0];
          for (const i of UNITS[r]) if (BOX[i] !== b && !g[i] && cand[i] & m) { cand[i] &= ~m; did = true; }
        }
        if (cols.size === 1) {
          const c = [...cols][0];
          for (const i of UNITS[9 + c]) if (BOX[i] !== b && !g[i] && cand[i] & m) { cand[i] &= ~m; did = true; }
        }
      }
    }
    // Claiming: a digit confined to one box inside a line leaves the rest of that box.
    for (let u = 0; u < 18; u++) {
      const line = UNITS[u];
      for (let d = 1; d <= 9; d++) {
        const m = bit(d);
        const cells = line.filter((i) => !g[i] && cand[i] & m);
        if (cells.length < 2) continue;
        const boxes = new Set(cells.map((i) => BOX[i]));
        if (boxes.size !== 1) continue;
        const b = [...boxes][0];
        for (const i of UNITS[18 + b]) {
          if (!g[i] && cand[i] & m && (u < 9 ? ROW[i] !== u : COL[i] !== u - 9)) { cand[i] &= ~m; did = true; }
        }
      }
    }
    return did;
  };

  const subsets = (): boolean => {
    let did = false;
    for (const u of UNITS) {
      const empties = u.filter((i) => !g[i]);
      const n = empties.length;
      // Naked pairs and triples.
      for (let size = 2; size <= 3; size++) {
        if (n <= size) continue;
        const combos = (start: number, picked: number[]) => {
          if (picked.length === size) {
            const union = picked.reduce((m, i) => m | cand[i], 0);
            if (popcount(union) !== size) return;
            for (const i of empties) if (!picked.includes(i) && cand[i] & union) { cand[i] &= ~union; did = true; }
            return;
          }
          for (let k = start; k < n; k++) if (popcount(cand[empties[k]]) <= size) combos(k + 1, [...picked, empties[k]]);
        };
        combos(0, []);
      }
      // Hidden pairs and triples.
      const digits: number[] = [];
      for (let d = 1; d <= 9; d++) if (empties.some((i) => cand[i] & bit(d))) digits.push(d);
      for (let size = 2; size <= 3; size++) {
        if (digits.length <= size) continue;
        const combos = (start: number, picked: number[]) => {
          if (picked.length === size) {
            const mask = picked.reduce((m, d) => m | bit(d), 0);
            const cells = empties.filter((i) => cand[i] & mask);
            if (cells.length !== size) return;
            for (const i of cells) if (cand[i] & ~mask) { cand[i] &= mask; did = true; }
            return;
          }
          for (let k = start; k < digits.length; k++) combos(k + 1, [...picked, digits[k]]);
        };
        combos(0, []);
      }
    }
    return did;
  };

  const xwing = (): boolean => {
    let did = false;
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      for (const byRow of [true, false]) {
        // For each line, the two cross-lines the digit is still possible in.
        const pairs: { line: number; a: number; b: number }[] = [];
        for (let l = 0; l < 9; l++) {
          const cells = UNITS[byRow ? l : 9 + l].filter((i) => !g[i] && cand[i] & m);
          if (cells.length === 2) pairs.push({ line: l, a: byRow ? COL[cells[0]] : ROW[cells[0]], b: byRow ? COL[cells[1]] : ROW[cells[1]] });
        }
        for (let x = 0; x < pairs.length; x++) for (let y = x + 1; y < pairs.length; y++) {
          const p = pairs[x], q = pairs[y];
          if (p.a !== q.a || p.b !== q.b) continue;
          for (const cross of [p.a, p.b]) {
            for (const i of UNITS[byRow ? 9 + cross : cross]) {
              const line = byRow ? ROW[i] : COL[i];
              if (line !== p.line && line !== q.line && !g[i] && cand[i] & m) { cand[i] &= ~m; did = true; }
            }
          }
        }
      }
    }
    return did;
  };

  for (;;) {
    if (g.every((v) => v)) return level;
    if (singles()) continue;
    if (locked() || subsets()) { level = Math.max(level, 1) as Level; continue; }
    if (xwing()) { level = 2; continue; }
    return 3;
  }
}

// ── Puzzle generation ────────────────────────────────────────────────────────

/** Removes clues while the puzzle keeps a single solution. Leaves it minimal
 *  unless `stopAt` clues is reached first. */
function dig(solution: Grid, rnd: () => number, stopAt: number): Grid {
  const g = solution.slice();
  const order = shuffle(Array.from({ length: 81 }, (_, i) => i), rnd);
  let clues = 81;
  for (const i of order) {
    if (clues <= stopAt) break;
    const keep = g[i];
    g[i] = 0;
    if (countSolutions(g, 2) === 1) clues--;
    else g[i] = keep;
  }
  return g;
}

/**
 * Makes a puzzle of the asked difficulty. Hard needs locked candidates or
 * pairs/triples but nothing past them; Expert runs those and X-wings dry, and
 * still has one and only one solution, so it is very hard and always possible.
 */
export function generate(difficulty: Difficulty, rnd: () => number = Math.random): Puzzle {
  for (;;) {
    const solution = fullGrid(rnd);
    // Expert digs all the way down; Hard leaves a few more clues so it does not
    // usually tip over into expert territory.
    const givens = dig(solution, rnd, difficulty === 'expert' ? 17 : 28 + Math.floor(rnd() * 3));
    const level = grade(givens);
    if (difficulty === 'expert' ? level === 3 : level === 1) return { givens, solution, difficulty };
  }
}

export const toString = (g: Grid) => g.map((d) => d || '.').join('');
export const fromString = (s: string): Grid => [...s].map((ch) => (ch === '.' ? 0 : Number(ch)));
