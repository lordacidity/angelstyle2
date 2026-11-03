// PATH: the simulation. Balls roll down a road; towers beside it pop them.
// A ball has layers: pop a pink and a yellow rolls on in its place, and so on
// down to red. Bigger balls carry smaller ones inside. Nothing here touches
// the DOM; the page steps it and draws it.

export const W = 360;
export const H = 500;
export const ROAD = 26;
export const TOWER_R = 12;
export const LAST_WAVE = 40;

// ── Maps ───────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };
export interface MapDef { id: string; name: string; blurb: string; pts: Pt[] }

const serpent = (): Pt[] => {
  const pts: Pt[] = [];
  for (let y = -20; y <= 580; y += 10) pts.push({ x: 180 + 118 * Math.sin(((y + 20) / 600) * Math.PI * 3), y });
  return pts;
};
/** The roads are drawn on a 360 by 560 sheet; the board is a little shorter. */
const fit = (pts: Pt[]): Pt[] => pts.map((p) => ({ x: p.x, y: Math.round(p.y * (H / 560) * 10) / 10 }));

export const MAPS: MapDef[] = [
  { id: 'core', name: 'Core', blurb: 'Spirals in. The middle sees it all.', pts: fit([
    { x: 180, y: -20 }, { x: 180, y: 70 }, { x: 310, y: 70 }, { x: 310, y: 490 }, { x: 50, y: 490 },
    { x: 50, y: 150 }, { x: 230, y: 150 }, { x: 230, y: 410 }, { x: 130, y: 410 }, { x: 130, y: 240 },
  ]) },
  { id: 'switchback', name: 'Switchback', blurb: 'Long, with room on every bend.', pts: fit([
    { x: 60, y: -20 }, { x: 60, y: 110 }, { x: 300, y: 110 }, { x: 300, y: 225 }, { x: 60, y: 225 },
    { x: 60, y: 345 }, { x: 300, y: 345 }, { x: 300, y: 460 }, { x: 180, y: 460 }, { x: 180, y: 580 },
  ]) },
  { id: 'serpent', name: 'Serpent', blurb: 'One long curve. Fewer good spots.', pts: fit(serpent()) },
  { id: 'straight', name: 'Straight', blurb: 'Top to bottom, nowhere to hide. Brutal.', pts: fit([
    { x: 180, y: -20 }, { x: 180, y: 580 },
  ]) },
];

export interface Track { pts: Pt[]; cum: number[]; len: number }
export function track(m: MapDef): Track {
  const cum = [0];
  for (let i = 1; i < m.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(m.pts[i].x - m.pts[i - 1].x, m.pts[i].y - m.pts[i - 1].y));
  return { pts: m.pts, cum, len: cum[cum.length - 1] };
}
export function posAt(t: Track, d: number): Pt {
  if (d <= 0) return t.pts[0];
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i] < d) i++;
  const a = t.pts[i - 1], b = t.pts[i];
  const seg = t.cum[i] - t.cum[i - 1] || 1;
  const f = Math.min(1, (d - t.cum[i - 1]) / seg);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
function distToTrack(t: Track, p: Pt) {
  let best = Infinity;
  for (let i = 1; i < t.pts.length; i++) {
    const a = t.pts[i - 1], b = t.pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * f), p.y - (a.y + dy * f)));
  }
  return best;
}

// ── Balls ──────────────────────────────────────────────────────────────────

export type Kind = 'red' | 'blue' | 'green' | 'yellow' | 'pink' | 'black' | 'white' | 'iron' | 'shell' | 'giant' | 'titan';
interface KindDef {
  color: string; r: number; speed: number; hp: number; gold: number;
  kids: Kind[];
  /** black: cannons can't hurt it. white: frost can't. iron: only heavy hits. */
  immune?: 'blast' | 'cold'; armored?: boolean; boss?: boolean;
}
export const KINDS: Record<Kind, KindDef> = {
  red: { color: '#ef6461', r: 7, speed: 38, hp: 1, gold: 1, kids: [] },
  blue: { color: '#5b8def', r: 7.5, speed: 50, hp: 1, gold: 1, kids: ['red'] },
  green: { color: '#62bf8a', r: 8, speed: 62, hp: 1, gold: 1, kids: ['blue'] },
  yellow: { color: '#f0c45a', r: 8.5, speed: 82, hp: 1, gold: 1, kids: ['green'] },
  pink: { color: '#e27bc8', r: 8.5, speed: 96, hp: 1, gold: 1, kids: ['yellow'] },
  black: { color: '#2b2b30', r: 5.5, speed: 52, hp: 1, gold: 1, kids: ['pink', 'pink'], immune: 'blast' },
  white: { color: '#f1f1ee', r: 5.5, speed: 60, hp: 1, gold: 1, kids: ['pink', 'pink'], immune: 'cold' },
  iron: { color: '#8d9199', r: 8.5, speed: 30, hp: 1, gold: 2, kids: ['black'], armored: true },
  shell: { color: '#b8916a', r: 9.5, speed: 40, hp: 12, gold: 4, kids: ['black', 'white'] },
  giant: { color: '#a9c6e4', r: 18, speed: 18, hp: 300, gold: 40, kids: ['shell', 'shell', 'shell', 'shell'], boss: true },
  titan: { color: '#ef6461', r: 25, speed: 12, hp: 1500, gold: 120, kids: ['giant', 'giant'], boss: true },
};
const rbeCache: Partial<Record<Kind, number>> = {};
export function rbe(k: Kind): number {
  if (rbeCache[k] == null) rbeCache[k] = KINDS[k].hp + KINDS[k].kids.reduce((s, c) => s + rbe(c), 0);
  return rbeCache[k]!;
}

export interface Ball {
  id: number; kind: Kind; hp: number; d: number;
  x: number; y: number;
  slowT: number; slowF: number;
  dead: boolean;
}

// ── Towers ─────────────────────────────────────────────────────────────────

export type TowerKey = 'dart' | 'spray' | 'cannon' | 'frost' | 'sniper' | 'bank';
export type Target = 'first' | 'last' | 'strong' | 'close';
export const TARGETS: Target[] = ['first', 'last', 'strong', 'close'];

export interface Stats {
  range: number; rate: number; dmg: number; pierce: number;
  heavy: boolean; count: number; spread: number; speed: number;
  splash: number; maxHits: number; cluster: boolean;
  slow: number; slowT: number; bossSlow: boolean;
  income: number; interest: number; interestCap: number;
}
interface Upg { name: string; cost: number; desc: string; apply: (s: Stats) => void }
interface TowerDef { name: string; cost: number; color: string; desc: string; base: Partial<Stats>; paths: [Upg[], Upg[]] }

const BASE: Stats = {
  range: 90, rate: 1, dmg: 1, pierce: 1, heavy: false, count: 1, spread: 0, speed: 420,
  splash: 0, maxHits: 0, cluster: false, slow: 1, slowT: 0, bossSlow: false,
  income: 0, interest: 0, interestCap: 0,
};

export const TOWERS: Record<TowerKey, TowerDef> = {
  dart: { name: 'Dart', cost: 200, color: '#e9e9e6', desc: 'Cheap. Throws darts.', base: { range: 92, rate: 1.15, pierce: 2 },
    paths: [[
      { name: 'Sharp', cost: 140, desc: '+2 pierce', apply: (s) => { s.pierce += 2; } },
      { name: 'Razor', cost: 320, desc: '+1 damage, +2 pierce', apply: (s) => { s.dmg += 1; s.pierce += 2; } },
      { name: 'Ripper', cost: 950, desc: '+2 damage, pops iron', apply: (s) => { s.dmg += 2; s.pierce += 4; s.heavy = true; } },
    ], [
      { name: 'Quick', cost: 120, desc: 'throws 40% faster', apply: (s) => { s.rate *= 1.4; } },
      { name: 'Far eyes', cost: 170, desc: '+28 range', apply: (s) => { s.range += 28; } },
      { name: 'Triple', cost: 650, desc: 'three darts a throw', apply: (s) => { s.count = 3; s.spread = 0.22; } },
    ]] },
  spray: { name: 'Spray', cost: 280, color: '#e9e9e6', desc: 'Darts in every direction.', base: { range: 62, rate: 0.8, count: 8, speed: 360 },
    paths: [[
      { name: 'Faster', cost: 160, desc: 'sprays 40% faster', apply: (s) => { s.rate *= 1.4; } },
      { name: 'Rapid', cost: 380, desc: 'sprays 50% faster', apply: (s) => { s.rate *= 1.5; } },
      { name: 'Ring of fire', cost: 1300, desc: '16 burning darts, pops iron', apply: (s) => { s.count = 16; s.dmg += 1; s.heavy = true; s.rate *= 1.2; } },
    ], [
      { name: 'Longer', cost: 120, desc: '+16 range', apply: (s) => { s.range += 16; } },
      { name: 'Dense', cost: 260, desc: '12 darts', apply: (s) => { s.count = Math.max(s.count, 12); } },
      { name: 'Hot tips', cost: 720, desc: '+1 damage, +2 pierce', apply: (s) => { s.dmg += 1; s.pierce += 2; } },
    ]] },
  cannon: { name: 'Cannon', cost: 450, color: '#e9e9e6', desc: 'Splash. Pops iron. Not black.', base: { range: 86, rate: 0.62, heavy: true, splash: 26, maxHits: 14, speed: 300 },
    paths: [[
      { name: 'Big shells', cost: 300, desc: '+12 blast, more hits', apply: (s) => { s.splash += 12; s.maxHits += 10; } },
      { name: 'Heavy shells', cost: 650, desc: '+2 damage', apply: (s) => { s.dmg += 2; } },
      { name: 'Mortar', cost: 1900, desc: '+4 damage, huge blast', apply: (s) => { s.dmg += 4; s.splash += 12; s.maxHits += 20; } },
    ], [
      { name: 'Reload', cost: 260, desc: 'fires 40% faster', apply: (s) => { s.rate *= 1.4; } },
      { name: 'Reach', cost: 220, desc: '+28 range', apply: (s) => { s.range += 28; } },
      { name: 'Cluster', cost: 900, desc: 'four more blasts a shot', apply: (s) => { s.cluster = true; } },
    ]] },
  frost: { name: 'Frost', cost: 320, color: '#e9e9e6', desc: 'Slows everything near it.', base: { range: 58, rate: 0.6, dmg: 0, slow: 0.55, slowT: 1.4 },
    paths: [[
      { name: 'Biting', cost: 260, desc: 'each pulse pops a layer', apply: (s) => { s.dmg = Math.max(s.dmg, 1); } },
      { name: 'Deep freeze', cost: 420, desc: 'slower, for longer', apply: (s) => { s.slow = 0.35; s.slowT = 2.2; } },
      { name: 'Shatter', cost: 1200, desc: '3 damage a pulse, pops iron', apply: (s) => { s.dmg = 3; s.heavy = true; } },
    ], [
      { name: 'Wide', cost: 200, desc: '+20 range', apply: (s) => { s.range += 20; } },
      { name: 'Pulse', cost: 320, desc: 'pulses 50% faster', apply: (s) => { s.rate *= 1.5; } },
      { name: 'Permafrost', cost: 850, desc: 'slows giants too', apply: (s) => { s.bossSlow = true; s.range += 10; } },
    ]] },
  sniper: { name: 'Sniper', cost: 380, color: '#e9e9e6', desc: 'Sees the whole map. Pops iron.', base: { range: 9999, rate: 0.45, dmg: 2, heavy: true },
    paths: [[
      { name: 'Full metal', cost: 350, desc: '4 damage', apply: (s) => { s.dmg = 4; } },
      { name: 'Rifle', cost: 950, desc: '8 damage', apply: (s) => { s.dmg = 8; } },
      { name: 'Deadeye', cost: 3200, desc: '20 damage', apply: (s) => { s.dmg = 20; } },
    ], [
      { name: 'Bolt action', cost: 300, desc: 'fires 50% faster', apply: (s) => { s.rate *= 1.5; } },
      { name: 'Semi-auto', cost: 1200, desc: 'fires twice as fast', apply: (s) => { s.rate *= 2; } },
      { name: 'Marksman', cost: 2800, desc: 'twice as fast again', apply: (s) => { s.rate *= 2; } },
    ]] },
  bank: { name: 'Bank', cost: 650, color: '#e9e9e6', desc: 'Pays gold every wave.', base: { range: 0, rate: 0, dmg: 0, income: 80 },
    paths: [[
      { name: 'Branch', cost: 500, desc: '+60 gold a wave', apply: (s) => { s.income += 60; } },
      { name: 'Vault', cost: 950, desc: '+100 gold a wave', apply: (s) => { s.income += 100; } },
      { name: 'Mint', cost: 2600, desc: '+220 gold a wave', apply: (s) => { s.income += 220; } },
    ], [
      { name: 'Interest', cost: 400, desc: '2% of your gold a wave', apply: (s) => { s.interest = 0.02; s.interestCap = 200; } },
      { name: 'Compound', cost: 850, desc: '4%, up to 400', apply: (s) => { s.interest = 0.04; s.interestCap = 400; } },
      { name: 'Hedge', cost: 2200, desc: '6%, up to 900', apply: (s) => { s.interest = 0.06; s.interestCap = 900; } },
    ]] },
};
export const TOWER_KEYS = Object.keys(TOWERS) as TowerKey[];

export interface Tower {
  id: number; key: TowerKey; x: number; y: number;
  lv: [number, number]; spent: number; target: Target;
  cd: number; aim: number; stats: Stats; pops: number;
}

export function statsOf(key: TowerKey, lv: [number, number]): Stats {
  const s: Stats = { ...BASE, ...TOWERS[key].base };
  for (const p of [0, 1] as const) for (let i = 0; i < lv[p]; i++) TOWERS[key].paths[p][i].apply(s);
  return s;
}
/** One path can go to the top; the other then stops at 1. */
export function canUpgrade(t: Tower, p: 0 | 1): boolean {
  const next = t.lv[p] + 1;
  if (next > 3) return false;
  return !(next >= 2 && t.lv[1 - p] >= 2);
}
export const sellValue = (t: Tower) => Math.floor(t.spent * 0.7);

// ── Waves ──────────────────────────────────────────────────────────────────

const UNLOCK: [Kind, number][] = [
  ['red', 1], ['blue', 3], ['green', 6], ['yellow', 10], ['pink', 14],
  ['black', 17], ['white', 20], ['iron', 23], ['shell', 26],
];
interface Group { kind: Kind; count: number; gap: number; delay: number }

export function waveGroups(n: number): Group[] {
  const open = UNLOCK.filter(([, w]) => w <= n).map(([k]) => k);
  const budget = Math.round(20 + 12 * n + 0.9 * n * n + (n > 25 ? 4 * (n - 25) * (n - 25) : 0) + (n > 40 ? 12 * (n - 40) * (n - 40) : 0));
  // The newest kinds lead, except in their first two waves: then they come in small.
  const fresh = (k: Kind) => n - UNLOCK.find(([u]) => u === k)![1] < 2;
  const top = open.slice(-3).reverse();
  const picks = [...top.filter((k) => !fresh(k)), ...top.filter(fresh)];
  const shares = picks.length === 1 ? [1] : picks.length === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
  const groups: Group[] = picks.map((kind, i) => {
    const count = Math.max(1, Math.round((budget * shares[i]) / rbe(kind)));
    const len = Math.min(22, 7 + count * 0.25);
    return { kind, count, gap: Math.max(0.08, len / count), delay: i * 2.5 };
  });
  // Giants: one on 28, then more every few waves. The titan closes wave 40.
  const giants = n === 28 || n === 33 ? 1 : n === 36 || n === 38 ? 2 : n === 39 ? 3 : 0;
  if (giants) groups.push({ kind: 'giant', count: giants, gap: 3, delay: 6 });
  if (n === LAST_WAVE) groups.push({ kind: 'titan', count: 1, gap: 1, delay: 8 });
  if (n > LAST_WAVE) groups.push({ kind: n % 2 ? 'giant' : 'titan', count: Math.ceil((n - LAST_WAVE) / 3), gap: 4, delay: 5 });
  return groups;
}

// ── World ──────────────────────────────────────────────────────────────────

interface Spawner { wave: number; kind: Kind; left: number; gap: number; t: number }
interface Shot {
  kind: 'dart' | 'shell';
  x: number; y: number; vx: number; vy: number; life: number;
  dmg: number; pierce: number; heavy: boolean; hit: Set<number>;
  splash: number; maxHits: number; cluster: boolean; tx: number; ty: number;
  from: number;
}
export interface Fx { kind: 'pop' | 'blast' | 'pulse' | 'tracer' | 'coin'; x: number; y: number; x2?: number; y2?: number; r: number; t: number; life: number; color: string; text?: string }

export interface World {
  map: MapDef; tr: Track;
  balls: Ball[]; towers: Tower[]; shots: Shot[]; fx: Fx[];
  spawners: Spawner[];
  gold: number; lives: number;
  wave: number; /** the highest wave sent */
  paidWave: number;
  time: number; nextId: number;
  over: null | 'win' | 'lose'; freeplay: boolean;
  bestCleared: number;
}

export const START_GOLD = 650;
export const START_LIVES = 100;

export function newWorld(map: MapDef): World {
  return {
    map, tr: track(map), balls: [], towers: [], shots: [], fx: [], spawners: [],
    gold: START_GOLD, lives: START_LIVES, wave: 0, paidWave: 0, time: 0, nextId: 1,
    over: null, freeplay: false, bestCleared: 0,
  };
}

export function canPlace(w: World, x: number, y: number): boolean {
  if (x < TOWER_R || x > W - TOWER_R || y < TOWER_R || y > H - TOWER_R) return false;
  if (distToTrack(w.tr, { x, y }) < ROAD / 2 + TOWER_R - 1) return false;
  return !w.towers.some((t) => Math.hypot(t.x - x, t.y - y) < TOWER_R * 2);
}
export function place(w: World, key: TowerKey, x: number, y: number): Tower | null {
  const cost = TOWERS[key].cost;
  if (w.gold < cost || !canPlace(w, x, y)) return null;
  w.gold -= cost;
  const t: Tower = { id: w.nextId++, key, x, y, lv: [0, 0], spent: cost, target: 'first', cd: 0, aim: -Math.PI / 2, stats: statsOf(key, [0, 0]), pops: 0 };
  w.towers.push(t);
  return t;
}
export function upgrade(w: World, t: Tower, p: 0 | 1): boolean {
  if (!canUpgrade(t, p)) return false;
  const u = TOWERS[t.key].paths[p][t.lv[p]];
  if (w.gold < u.cost) return false;
  w.gold -= u.cost; t.spent += u.cost;
  t.lv = p === 0 ? [t.lv[0] + 1, t.lv[1]] : [t.lv[0], t.lv[1] + 1];
  t.stats = statsOf(t.key, t.lv);
  return true;
}
export function sell(w: World, t: Tower) {
  w.gold += sellValue(t);
  w.towers = w.towers.filter((o) => o !== t);
}
export function sendWave(w: World) {
  if (w.over) return;
  w.wave++;
  for (const g of waveGroups(w.wave)) w.spawners.push({ wave: w.wave, kind: g.kind, left: g.count, gap: g.gap, t: -g.delay });
}
export const waveRunning = (w: World) => w.spawners.length > 0 || w.balls.length > 0;

function spawn(w: World, kind: Kind, d: number) {
  const p = posAt(w.tr, d);
  const b: Ball = { id: w.nextId++, kind, hp: KINDS[kind].hp, d, x: p.x, y: p.y, slowT: 0, slowF: 1, dead: false };
  w.balls.push(b);
  return b;
}

function canHurt(b: Ball, heavy: boolean, src: 'dart' | 'blast' | 'cold' | 'shot') {
  const k = KINDS[b.kind];
  if (k.armored && !heavy) return false;
  if (k.immune === 'blast' && src === 'blast') return false;
  if (k.immune === 'cold' && src === 'cold') return false;
  return true;
}

/** Damage a ball; whatever is left over carries into what was inside it. */
function hurt(w: World, b: Ball, dmg: number, tower: Tower | undefined): Ball[] {
  if (b.dead || dmg <= 0) return [];
  b.hp -= dmg;
  if (b.hp > 0) return [];
  const over = -b.hp;
  b.dead = true;
  const k = KINDS[b.kind];
  // Pops pay less as the waves get bigger, or gold would run away.
  w.gold += k.gold * (w.wave <= 20 ? 1 : w.wave <= 30 ? 0.6 : w.wave <= 36 ? 0.4 : 0.3);
  if (tower) tower.pops += 1;
  w.fx.push({ kind: 'pop', x: b.x, y: b.y, r: k.r, t: 0, life: k.boss ? 0.6 : 0.25, color: k.color });
  const born: Ball[] = [];
  k.kids.forEach((c, i) => {
    const kid = spawn(w, c, Math.max(0, b.d - i * 6));
    kid.slowT = b.slowT; kid.slowF = b.slowF;
    born.push(kid);
  });
  if (over > 0 && born.length) {
    const first = born[0];
    born.push(...hurt(w, first, over, tower));
  }
  return born;
}

function pickTarget(t: Tower, list: Ball[]): Ball | null {
  let best: Ball | null = null; let score = -Infinity;
  for (const b of list) {
    const s = t.target === 'first' ? b.d : t.target === 'last' ? -b.d : t.target === 'strong' ? rbe(b.kind) * 1000 + b.d : -Math.hypot(b.x - t.x, b.y - t.y);
    if (s > score) { score = s; best = b; }
  }
  return best;
}

export function step(w: World, dt: number) {
  if (w.over) return;
  w.time += dt;

  // Spawning.
  for (const s of w.spawners) {
    s.t += dt;
    while (s.left > 0 && s.t >= 0) { spawn(w, s.kind, 0); s.left--; s.t -= s.gap; }
  }
  const before = w.spawners.length;
  w.spawners = w.spawners.filter((s) => s.left > 0);
  if (w.spawners.length < before) {
    // A wave finishes sending: its pay, and every bank's.
    for (let n = w.paidWave + 1; n <= w.wave; n++) {
      if (w.spawners.some((s) => s.wave === n)) break;
      w.paidWave = n;
      let pay = 80 + n;
      for (const t of w.towers) {
        if (t.key !== 'bank') continue;
        const inc = t.stats.income + Math.min(t.stats.interestCap, Math.floor(w.gold * t.stats.interest));
        pay += inc;
        w.fx.push({ kind: 'coin', x: t.x, y: t.y - 14, r: 0, t: 0, life: 1.2, color: '#e9e9e6', text: `+${inc}` });
      }
      w.gold += pay;
    }
  }

  // Rolling.
  for (const b of w.balls) {
    if (b.dead) continue;
    if (b.slowT > 0) { b.slowT -= dt; if (b.slowT <= 0) b.slowF = 1; }
    b.d += KINDS[b.kind].speed * b.slowF * dt;
    if (b.d >= w.tr.len) {
      b.dead = true;
      w.lives -= rbe(b.kind) - (KINDS[b.kind].hp - b.hp);
      continue;
    }
    const p = posAt(w.tr, b.d); b.x = p.x; b.y = p.y;
  }

  // Towers.
  for (const t of w.towers) {
    const s = t.stats;
    if (!s.rate) continue;
    t.cd -= dt;
    if (t.cd > 0) continue;
    const inRange = (b: Ball) => !b.dead && Math.hypot(b.x - t.x, b.y - t.y) <= s.range + KINDS[b.kind].r;
    if (t.key === 'frost') {
      const near = w.balls.filter((b) => inRange(b) && canHurt(b, s.heavy, 'cold'));
      if (!near.length) continue;
      t.cd = 1 / s.rate;
      w.fx.push({ kind: 'pulse', x: t.x, y: t.y, r: s.range, t: 0, life: 0.35, color: '#a9d8e4' });
      for (const b of near) {
        const boss = KINDS[b.kind].boss;
        if (!boss || s.bossSlow) { b.slowF = Math.min(b.slowF, boss ? (1 + s.slow) / 2 : s.slow); b.slowT = Math.max(b.slowT, s.slowT); }
        if (s.dmg) hurt(w, b, s.dmg, t);
      }
      continue;
    }
    const src = t.key === 'cannon' ? 'blast' : 'dart';
    const cands = w.balls.filter((b) => inRange(b) && canHurt(b, s.heavy, src));
    if (t.key === 'spray') {
      if (!cands.length) continue;
      t.cd = 1 / s.rate;
      for (let i = 0; i < s.count; i++) {
        const a = (i / s.count) * Math.PI * 2 + t.aim;
        w.shots.push(dart(t, a, s.range / s.speed));
      }
      continue;
    }
    const tgt = pickTarget(t, cands);
    if (!tgt) continue;
    t.cd = 1 / s.rate;
    t.aim = Math.atan2(tgt.y - t.y, tgt.x - t.x);
    if (t.key === 'sniper') {
      w.fx.push({ kind: 'tracer', x: t.x, y: t.y, x2: tgt.x, y2: tgt.y, r: 0, t: 0, life: 0.12, color: '#e9e9e6' });
      if (canHurt(tgt, s.heavy, 'shot')) hurt(w, tgt, s.dmg, t);
      else w.fx.push({ kind: 'pop', x: tgt.x, y: tgt.y, r: 3, t: 0, life: 0.15, color: '#ffffff' });
    } else if (t.key === 'cannon') {
      const dist = Math.hypot(tgt.x - t.x, tgt.y - t.y) || 1;
      w.shots.push({ kind: 'shell', x: t.x, y: t.y, vx: ((tgt.x - t.x) / dist) * s.speed, vy: ((tgt.y - t.y) / dist) * s.speed, life: dist / s.speed,
        dmg: s.dmg, pierce: 1, heavy: true, hit: new Set(), splash: s.splash, maxHits: s.maxHits, cluster: s.cluster, tx: tgt.x, ty: tgt.y, from: t.id });
    } else {
      for (let i = 0; i < s.count; i++) {
        const off = s.count === 1 ? 0 : (i - (s.count - 1) / 2) * s.spread;
        w.shots.push(dart(t, t.aim + off, (s.range * 1.35) / s.speed));
      }
    }
  }

  // Shots.
  const byId = new Map(w.towers.map((t) => [t.id, t]));
  for (const sh of w.shots) {
    if (sh.life <= 0) continue;
    const tower = byId.get(sh.from);
    const stepT = Math.min(dt, sh.life);
    sh.x += sh.vx * stepT; sh.y += sh.vy * stepT; sh.life -= dt;
    if (sh.kind === 'shell') {
      const touch = w.balls.find((b) => !b.dead && Math.hypot(b.x - sh.x, b.y - sh.y) < KINDS[b.kind].r + 3);
      if (touch || sh.life <= 0) {
        sh.life = 0;
        blast(w, sh.x, sh.y, sh.splash, sh.maxHits, sh.dmg, tower);
        if (sh.cluster) for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + w.time;
          blast(w, sh.x + Math.cos(a) * 22, sh.y + Math.sin(a) * 22, 16, 6, 1, tower);
        }
      }
      continue;
    }
    for (const b of w.balls) {
      if (b.dead || sh.hit.has(b.id)) continue;
      if (Math.hypot(b.x - sh.x, b.y - sh.y) > KINDS[b.kind].r + 3) continue;
      sh.hit.add(b.id);
      if (canHurt(b, sh.heavy, 'dart')) {
        for (const kid of hurt(w, b, sh.dmg, tower)) sh.hit.add(kid.id);
        sh.pierce--;
      } else {
        sh.pierce = 0;
        w.fx.push({ kind: 'pop', x: sh.x, y: sh.y, r: 3, t: 0, life: 0.15, color: '#ffffff' });
      }
      if (sh.pierce <= 0) { sh.life = 0; break; }
    }
  }
  w.shots = w.shots.filter((s) => s.life > 0);
  w.balls = w.balls.filter((b) => !b.dead);

  // Effects.
  for (const f of w.fx) f.t += dt;
  w.fx = w.fx.filter((f) => f.t < f.life);

  if (w.lives <= 0) { w.lives = 0; w.over = 'lose'; return; }
  if (!waveRunning(w)) {
    w.bestCleared = Math.max(w.bestCleared, w.wave);
    if (w.wave >= LAST_WAVE && !w.freeplay) w.over = 'win';
  }
}

function dart(t: Tower, a: number, life: number): Shot {
  const s = t.stats;
  return { kind: 'dart', x: t.x, y: t.y, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed, life,
    dmg: s.dmg, pierce: s.pierce, heavy: s.heavy, hit: new Set(), splash: 0, maxHits: 0, cluster: false, tx: 0, ty: 0, from: t.id };
}

function blast(w: World, x: number, y: number, r: number, maxHits: number, dmg: number, tower: Tower | undefined) {
  w.fx.push({ kind: 'blast', x, y, r, t: 0, life: 0.25, color: '#e9e9e6' });
  const hits = w.balls
    .filter((b) => !b.dead && Math.hypot(b.x - x, b.y - y) <= r + KINDS[b.kind].r && canHurt(b, true, 'blast'))
    .sort((a, b) => b.d - a.d)
    .slice(0, maxHits);
  for (const b of hits) hurt(w, b, dmg, tower);
}
