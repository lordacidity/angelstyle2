'use client';

// REDLINE
//
// A territory war for one thumb. The map is a web of outposts; you hold one,
// the red holds one or more, the rest are neutral. Every outpost you hold
// breeds troops. Tap one of yours, tap a neighbour, and a column marches: if
// it outnumbers what is waiting it takes the ground, otherwise it dies on the
// walls. Gold trickles in from everything you hold and buys walls, barracks,
// cannons and bigger outposts. Every thirty seconds or so a WAVE lands on
// the red: its outposts fill up, its generals get bolder, and the longer the
// level runs the worse it gets. Clear every red outpost to win. Lose your
// last one and it's over.
//
// Campaign: twelve levels, each meaner than the last. Endless: two red
// factions that never stay dead, counted in waves survived. Scrap earned
// either way buys permanent upgrades in the Armoury. The numbers below are
// tuned so the early levels teach and the later ones take a few deaths.
//
// Everything is one canvas and a few buttons; it is meant for an iPhone held
// upright in Safari.

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Tuning ─────────────────────────────────────────────────────────────────

const MAP_W = 360;
const MAP_H = 600;
const CAMPAIGN_LEVELS = 12;
const ENDLESS_UNLOCK = 3;

const PLAYER = 1;
const COLORS: Record<number, string> = { 0: '#4a4a4a', 1: '#ffffff', 2: '#ff3b3b', 3: '#ff8a3b', 4: '#c04bff' };
const NAMES: Record<number, string> = { 2: 'RED', 3: 'AMBER', 4: 'VIOLET' };

const TIER_CAP = [40, 70, 120];
const TIER_PROD = [1, 1.5, 2.2];
const BASE_PROD_PER_S = 0.9;

const UPG = {
  prod: { name: 'Barracks', cost: [30, 55, 95], desc: '+35% troops/s' },
  wall: { name: 'Walls', cost: [25, 50, 90], desc: '+30% defence' },
  cannon: { name: 'Cannon', cost: [45, 80, 130], desc: 'shoots passing enemies' },
  tier: { name: 'Expand', cost: [60, 130], desc: 'bigger, faster' },
} as const;
type UpgKey = keyof typeof UPG;
const CANNON_DMG = [0, 3, 5, 8];
const CANNON_RANGE = 110;
const CANNON_CD = 0.5;

const TECH = {
  logistics: { name: 'Logistics', cost: [80], desc: 'columns march 25% faster' },
  conscription: { name: 'Conscription', cost: [100, 160, 240], desc: '+15% troops/s everywhere' },
} as const;
type TechKey = keyof typeof TECH;

const META = {
  prod: { name: 'Drill', cost: [30, 55, 90, 140, 200], desc: '+4% troops/s', unit: '%', per: 4 },
  speed: { name: 'Boots', cost: [35, 65, 110, 170], desc: '+6% march speed', unit: '%', per: 6 },
  gold: { name: 'War chest', cost: [25, 50, 85, 130], desc: '+12 starting gold', unit: 'g', per: 12 },
  cannon: { name: 'Powder', cost: [30, 60, 100, 150], desc: '+12% cannon damage', unit: '%', per: 12 },
} as const;
type MetaKey = keyof typeof META;

// ── Save ───────────────────────────────────────────────────────────────────

interface Save { scrap: number; cleared: number; bestWave: number; meta: Record<MetaKey, number> }
const SAVE_KEY = 'redline.v1';
const freshSave = (): Save => ({ scrap: 0, cleared: 0, bestWave: 0, meta: { prod: 0, speed: 0, gold: 0, cannon: 0 } });
function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return freshSave();
    const s = JSON.parse(raw) as Partial<Save>;
    return { ...freshSave(), ...s, meta: { ...freshSave().meta, ...(s.meta ?? {}) } };
  } catch { return freshSave(); }
}
function storeSave(s: Save) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* private mode */ } }

// ── World ──────────────────────────────────────────────────────────────────

interface Node {
  id: number; x: number; y: number;
  owner: number; troops: number; tier: number; base: boolean;
  prod: number; wall: number; cannon: number; cd: number;
  /** A standing order: ship this share of the garrison to that outpost,
   *  every few seconds, for as long as it stands. Yours only. */
  route: { to: number; pct: number } | null; routeT: number;
}
interface Edge { a: number; b: number; len: number }
/** A column on the road. `from`/`to` are the leg it is on; `path` is the
 *  whole route, and `leg` which step of it. */
interface Convoy { id: number; owner: number; n: number; from: number; to: number; t: number; dur: number; path: number[]; leg: number }
interface Shot { x1: number; y1: number; x2: number; y2: number; age: number }
interface Faction { id: number; tick: number; dead: number }

interface Rules {
  level: number; endless: boolean; nodeCount: number; enemies: number;
  enemyProd: number; aiInterval: number; sendFrac: number; waveLen: number;
  enemyStart: number; enemyExtra: number; neutralBase: number; enemyWall: number; enemyCannon: number;
}

interface World {
  rules: Rules;
  nodes: Node[]; edges: Edge[]; adj: number[][];
  convoys: Convoy[]; shots: Shot[]; factions: Faction[];
  gold: number; wave: number; waveT: number; time: number;
  surge: number; nextId: number;
  tech: Record<TechKey, number>;
  meta: Record<MetaKey, number>;
  over: 'win' | 'lose' | null;
  flash: { text: string; age: number } | null;
  selected: number | null;
  /** The outpost whose standing order is being pointed at, while it is. */
  picking: number | null;
}

function rulesFor(level: number, endless: boolean): Rules {
  if (endless) {
    return {
      level, endless, nodeCount: 18, enemies: 2,
      enemyProd: 1.0, aiInterval: 1.6, sendFrac: 0.6, waveLen: 28,
      enemyStart: 25, enemyExtra: 1, neutralBase: 14, enemyWall: 1, enemyCannon: 1,
    };
  }
  const L = level;
  return {
    level, endless,
    nodeCount: Math.min(18, 9 + L),
    enemies: L >= 10 ? 3 : L >= 5 ? 2 : 1,
    enemyProd: 0.65 + L * 0.03,
    aiInterval: Math.max(1.1, 2.6 - L * 0.11),
    sendFrac: Math.min(0.8, 0.5 + L * 0.025),
    waveLen: Math.max(18, 32 - L * 1.2),
    enemyStart: 10 + L * 2,
    enemyExtra: Math.floor(L / 4),
    neutralBase: 6 + L * 2,
    enemyWall: Math.min(3, Math.floor(L / 3)),
    enemyCannon: L >= 7 ? 1 : 0,
  };
}

// Seeded so a level is the same map every attempt: dying to it teaches it.
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segmentsCross(p1: Node, p2: Node, p3: Node, p4: Node) {
  const d = (a: Node, b: Node, c: Node) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function buildWorld(rules: Rules, meta: Record<MetaKey, number>, seedExtra = 0): World {
  const rnd = mulberry32(rules.level * 7919 + (rules.endless ? 104729 : 0) + seedExtra);
  const nodes: Node[] = [];
  const PAD = 34;
  const MIN_D = 74;
  let tries = 0;
  while (nodes.length < rules.nodeCount && tries++ < 4000) {
    const x = PAD + rnd() * (MAP_W - PAD * 2);
    const y = PAD + rnd() * (MAP_H - PAD * 2);
    if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) >= MIN_D)) {
      nodes.push({ id: nodes.length, x, y, owner: 0, troops: 0, tier: 1, base: false, prod: 0, wall: 0, cannon: 0, cd: 0, route: null, routeT: 0 });
    }
  }
  // Edges: nearest pairs first, no crossings, no more than four per outpost,
  // then whatever a spanning tree still needs so nothing is cut off.
  const pairs: Edge[] = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    pairs.push({ a: i, b: j, len: Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) });
  }
  pairs.sort((p, q) => p.len - q.len);
  const edges: Edge[] = [];
  const deg = new Array(nodes.length).fill(0) as number[];
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const crosses = (e: Edge) => edges.some((f) => f.a !== e.a && f.a !== e.b && f.b !== e.a && f.b !== e.b && segmentsCross(nodes[e.a], nodes[e.b], nodes[f.a], nodes[f.b]));
  for (const e of pairs) {
    if (e.len > 150 || deg[e.a] >= 4 || deg[e.b] >= 4 || crosses(e)) continue;
    edges.push(e); deg[e.a]++; deg[e.b]++; union(e.a, e.b);
  }
  for (const e of pairs) {
    if (find(e.a) === find(e.b)) continue;
    if (crosses(e)) continue;
    edges.push(e); deg[e.a]++; deg[e.b]++; union(e.a, e.b);
  }
  for (const e of pairs) {
    if (find(e.a) === find(e.b)) continue;
    edges.push(e); union(e.a, e.b);
  }
  const adj: number[][] = nodes.map(() => []);
  for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }

  // Bases: yours at the bottom, theirs as far from you as the map allows.
  const byY = [...nodes].sort((p, q) => q.y - p.y);
  const home = byY[Math.floor(rnd() * Math.min(3, byY.length))];
  home.owner = PLAYER; home.base = true; home.tier = 2; home.troops = 40; home.wall = 1;
  // Hops from home, so no enemy HQ ever sits a march away.
  const hops = new Array(nodes.length).fill(Infinity) as number[];
  hops[home.id] = 0;
  for (const q = [home.id]; q.length;) { const i = q.shift()!; for (const j of adj[i]) if (hops[j] === Infinity) { hops[j] = hops[i] + 1; q.push(j); } }
  const maxHops = Math.max(...hops.filter((h) => h !== Infinity));
  const taken = new Set<number>([home.id]);
  const factions: Faction[] = [];
  for (let f = 0; f < rules.enemies; f++) {
    const fid = 2 + f;
    let best: Node | null = null; let bestD = -1;
    for (const n of nodes) {
      if (taken.has(n.id) || hops[n.id] < Math.min(rules.level >= 6 || rules.endless ? 4 : 3, maxHops)) continue;
      let d = Math.hypot(n.x - home.x, n.y - home.y) + hops[n.id] * 40;
      for (const t of taken) if (t !== home.id) d = Math.min(d, Math.hypot(n.x - nodes[t].x, n.y - nodes[t].y) * 1.4);
      if (d > bestD) { bestD = d; best = n; }
    }
    if (!best) break;
    best.owner = fid; best.base = true; best.tier = 2; best.troops = rules.enemyStart;
    best.wall = rules.enemyWall; best.cannon = rules.enemyCannon;
    taken.add(best.id);
    // A few outposts already theirs, beside the base.
    let extra = rules.enemyExtra;
    for (const nb of adj[best.id]) {
      if (extra <= 0) break;
      const n = nodes[nb];
      if (taken.has(n.id) || n.owner !== 0) continue;
      n.owner = fid; n.troops = Math.round(rules.enemyStart * 0.4); n.wall = Math.max(0, rules.enemyWall - 1);
      taken.add(n.id); extra--;
    }
    factions.push({ id: fid, tick: rnd() * rules.aiInterval, dead: 0 });
  }
  for (const n of nodes) {
    if (n.owner !== 0) continue;
    const far = Math.hypot(n.x - home.x, n.y - home.y) / Math.hypot(MAP_W, MAP_H);
    n.troops = Math.round(rules.neutralBase * (0.4 + 1.6 * far) + rnd() * 10);
    if (rnd() < 0.18) n.tier = 2;
  }

  return {
    rules, nodes, edges, adj, convoys: [], shots: [], factions,
    gold: 40 + META.gold.per * meta.gold, wave: 0, waveT: rules.waveLen, time: 0,
    surge: 0, nextId: 1,
    tech: { logistics: 0, conscription: 0 }, meta,
    over: null, flash: { text: rules.endless ? 'ENDLESS' : `LEVEL ${rules.level}`, age: 0 }, selected: null, picking: null,
  };
}

// ── Simulation ─────────────────────────────────────────────────────────────

const capOf = (n: Node) => TIER_CAP[n.tier - 1] * (n.base ? 1.5 : 1);
const wallMult = (n: Node) => 1 + 0.3 * n.wall;
const prodOf = (w: World, n: Node) => {
  let m = n.owner === PLAYER
    ? (1 + META.prod.per * w.meta.prod / 100) * (1 + 0.15 * w.tech.conscription)
    : w.rules.enemyProd * (w.rules.endless ? 1 + w.wave * 0.12 : 1 + w.wave * (0.05 + w.rules.level * 0.015));
  m *= (n.base ? 1.5 : 1) * TIER_PROD[n.tier - 1] * (1 + 0.35 * n.prod);
  return BASE_PROD_PER_S * m;
};
const convoySpeed = (w: World, owner: number) =>
  60 * (owner === PLAYER ? (1 + META.speed.per * w.meta.speed / 100) * (1 + 0.25 * w.tech.logistics) : 1 + w.rules.level * 0.02 + (w.rules.endless ? w.wave * 0.01 : 0));
const convoyPos = (w: World, c: Convoy) => {
  const a = w.nodes[c.from], b = w.nodes[c.to];
  return { x: a.x + (b.x - a.x) * c.t, y: a.y + (b.y - a.y) * c.t };
};
const edgeLen = (w: World, a: number, b: number) => Math.hypot(w.nodes[a].x - w.nodes[b].x, w.nodes[a].y - w.nodes[b].y);

// The road from one outpost to another: the cheapest way through, with
// the sender's own ground costing a step and anyone else's costing five, so a
// column goes round the enemy where it can and through them where it must.
function route(w: World, from: number, to: number, owner: number): number[] | null {
  if (from === to) return null;
  const dist = new Array(w.nodes.length).fill(Infinity) as number[];
  const prev = new Array(w.nodes.length).fill(-1) as number[];
  const done = new Array(w.nodes.length).fill(false) as boolean[];
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === to) break;
    done[u] = true;
    for (const v of w.adj[u]) {
      const c = dist[u] + (w.nodes[v].owner === owner || v === to ? 1 : 5) + edgeLen(w, u, v) / 1000;
      if (c < dist[v]) { dist[v] = c; prev[v] = u; }
    }
  }
  if (dist[to] === Infinity) return null;
  const path: number[] = [];
  for (let v = to; v !== -1; v = prev[v]) path.unshift(v);
  return path;
}

function send(w: World, from: number, to: number, frac: number) {
  const n = w.nodes[from];
  const path = w.adj[from].includes(to) ? [from, to] : route(w, from, to, n.owner);
  if (!path) return;
  const amount = Math.floor(n.troops * frac);
  if (amount < 1) return;
  n.troops -= amount;
  w.convoys.push({ id: w.nextId++, owner: n.owner, n: amount, from, to: path[1], t: 0, dur: edgeLen(w, from, path[1]) / convoySpeed(w, n.owner), path, leg: 0 });
}

/** A column at the end of a leg: on through its own ground if the road
 *  goes on, otherwise it has arrived, and fights if it has to. */
function reachNode(w: World, c: Convoy) {
  const here = w.nodes[c.to];
  const last = c.leg >= c.path.length - 2;
  if (!last && here.owner === c.owner) {
    c.leg++;
    c.from = c.to; c.to = c.path[c.leg + 1]; c.t = 0;
    c.dur = edgeLen(w, c.from, c.to) / convoySpeed(w, c.owner);
    w.convoys.push(c);
    return;
  }
  arrive(w, c);
}

function arrive(w: World, c: Convoy) {
  const n = w.nodes[c.to];
  if (n.owner === c.owner) { n.troops += c.n; return; }
  const def = n.troops * wallMult(n);
  if (c.n > def) {
    const was = n.owner;
    n.owner = c.owner;
    n.troops = c.n - def;
    n.cannon = 0; // the guns are spiked as the walls fall
    n.route = null;
    n.cd = 0;
    if (c.owner === PLAYER) { w.gold += 12; }
    if (was !== 0 && was !== PLAYER && !w.nodes.some((m) => m.owner === was)) {
      const f = w.factions.find((x) => x.id === was);
      if (f) f.dead = w.time;
      if (c.owner === PLAYER) w.flash = { text: `${NAMES[was]} BROKEN`, age: 0 };
    }
  } else {
    n.troops = (def - c.n) / wallMult(n);
  }
}

// What a faction's general does with every outpost it holds, once a tick:
// takes what it can beat, keeps pressure on what it almost can, and feeds
// the front from the rear. Bolder on a surge.
function aiTick(w: World, f: Faction) {
  const r = w.rules;
  const boost = w.surge > 0 ? 1.3 : 1;
  const frac = Math.min(0.9, r.sendFrac * boost);
  for (const n of w.nodes) {
    if (n.owner !== f.id || n.troops < 8) continue;
    // Only the HQ acts every tick: an outpost's garrison sits out half of them.
    if (!n.base && ((n.id * 7 + Math.floor(w.time / w.rules.aiInterval)) & 1)) continue;
    const nbs = w.adj[n.id].map((i) => w.nodes[i]);
    const hostile = nbs.filter((m) => m.owner !== f.id);
    const avail = n.troops * frac;
    let best: Node | null = null; let bestScore = -Infinity;
    for (const m of hostile) {
      const incoming = w.convoys.filter((c) => c.to === m.id && c.owner === m.owner).reduce((s, c) => s + c.n, 0);
      const need = (m.troops + incoming) * wallMult(m) + 1;
      if (avail < need * 1.25) continue;
      let score = (m.owner === PLAYER ? 3 : m.owner === 0 ? 1 : 2) + (m.base ? 2.5 : 0) + m.prod * 0.4 - need / avail;
      if (m.owner === PLAYER && m.cannon) score += 1;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (best) { send(w, n.id, best.id, frac); continue; }
    // Full and nothing it can take: bleed the weakest of yours anyway.
    if (n.troops >= capOf(n) * 0.95) {
      const yours = hostile.filter((m) => m.owner === PLAYER).sort((a, b) => a.troops * wallMult(a) - b.troops * wallMult(b));
      if (yours.length && avail > yours[0].troops * wallMult(yours[0]) * 0.6) { send(w, n.id, yours[0].id, 0.8); continue; }
    }
    // Rear outpost: feed the front.
    if (hostile.length === 0 && n.troops > 15) {
      const front = nbs.filter((m) => m.owner === f.id && w.adj[m.id].some((i) => w.nodes[i].owner !== f.id))
        .sort((a, b) => a.troops - b.troops);
      if (front.length) send(w, n.id, front[0].id, 0.6);
    }
  }
}

function surge(w: World) {
  const r = w.rules;
  const L = r.endless ? 6 + w.wave * 0.5 : r.level;
  for (const n of w.nodes) {
    if (n.owner < 2) continue;
    n.troops += n.base ? (3 + L) * w.wave : (1 + L * 0.35) * w.wave;
    if (r.endless && w.wave % 4 === 0) n.wall = Math.min(3, n.wall + 1);
  }
  w.surge = 6;
  w.flash = { text: `WAVE ${w.wave}`, age: 0 };
}

// Endless: a broken faction comes back, somewhere, and it may well be
// behind your lines. The longer the run, the heavier the landing.
function respawn(w: World, f: Faction) {
  const pool = w.nodes.filter((n) => !(n.base && n.owner === PLAYER));
  if (!pool.length) return;
  const pick = mulberry32(w.wave * 31 + f.id * 97);
  const best = pool[Math.floor(pick() * pool.length)];
  best.owner = f.id; best.base = true; best.tier = 2; best.troops = 40 + w.wave * 15;
  best.cannon = Math.min(3, 1 + Math.floor(w.wave / 6)); best.wall = Math.min(3, 1 + Math.floor(w.wave / 4));
  f.dead = 0;
  w.flash = { text: `${NAMES[f.id]} LANDS`, age: 0 };
}

function step(w: World, dt: number) {
  if (w.over) return;
  w.time += dt;
  if (w.flash) { w.flash.age += dt; if (w.flash.age > 1.6) w.flash = null; }
  if (w.surge > 0) w.surge -= dt;

  // Breeding and gold.
  for (const n of w.nodes) {
    if (n.owner === 0) continue;
    const cap = capOf(n);
    if (n.troops < cap) n.troops = Math.min(cap, n.troops + prodOf(w, n) * dt);
    if (n.owner === PLAYER) w.gold += (n.base ? 1.0 : 0.35 + 0.15 * (n.tier - 1)) * dt;
  }

  // Standing orders.
  const ROUTE_EVERY = 2;
  for (const n of w.nodes) {
    if (!n.route || n.owner !== PLAYER) continue;
    n.routeT -= dt;
    if (n.routeT > 0) continue;
    n.routeT = ROUTE_EVERY;
    if (n.troops * n.route.pct >= 3) send(w, n.id, n.route.to, n.route.pct);
  }

  // Columns on the march.
  for (const c of w.convoys) c.t += dt / c.dur;
  const arrived = w.convoys.filter((c) => c.t >= 1);
  w.convoys = w.convoys.filter((c) => c.t < 1);
  for (const c of arrived) reachNode(w, c);

  // Columns that meet on the road fight there: head on, or one catching the
  // other up. The bigger marches on, short the smaller; equals die together.
  for (let i = 0; i < w.convoys.length; i++) {
    const a = w.convoys[i];
    if (a.n <= 0) continue;
    for (let j = i + 1; j < w.convoys.length; j++) {
      const b = w.convoys[j];
      if (b.n <= 0 || a.owner === b.owner) continue;
      const sameRoad = (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
      if (!sameRoad) continue;
      const pa = convoyPos(w, a), pb = convoyPos(w, b);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 9) continue;
      w.shots.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, age: 0 });
      const an = a.n, bn = b.n;
      a.n = an - bn; b.n = bn - an;
      if (a.n <= 0) break;
    }
  }
  w.convoys = w.convoys.filter((c) => c.n > 0.5);

  // Cannons.
  for (const n of w.nodes) {
    if (!n.cannon || n.owner === 0) continue;
    n.cd -= dt;
    if (n.cd > 0) continue;
    let target: Convoy | null = null; let td = CANNON_RANGE;
    for (const c of w.convoys) {
      if (c.owner === n.owner) continue;
      if (n.owner !== PLAYER && c.owner !== PLAYER) continue; // red guns only mind you
      const p = convoyPos(w, c);
      const d = Math.hypot(p.x - n.x, p.y - n.y);
      if (d < td) { td = d; target = c; }
    }
    if (!target) continue;
    const dmg = CANNON_DMG[n.cannon] * (n.owner === PLAYER ? 1 + META.cannon.per * w.meta.cannon / 100 : 0.8);
    target.n -= dmg;
    const p = convoyPos(w, target);
    w.shots.push({ x1: n.x, y1: n.y, x2: p.x, y2: p.y, age: 0 });
    n.cd = CANNON_CD;
  }
  w.convoys = w.convoys.filter((c) => c.n > 0.5);
  for (const s of w.shots) s.age += dt;
  w.shots = w.shots.filter((s) => s.age < 0.14);

  // Generals.
  for (const f of w.factions) {
    if (f.dead) {
      if (w.rules.endless && w.time - f.dead > 8) respawn(w, f);
      continue;
    }
    f.tick -= dt;
    if (f.tick <= 0) { aiTick(w, f); f.tick = w.rules.aiInterval * (w.surge > 0 ? 0.55 : 1); }
  }

  // Waves.
  w.waveT -= dt;
  if (w.waveT <= 0) { w.wave++; w.waveT = w.rules.waveLen; surge(w); }

  // The end.
  const mine = w.nodes.some((n) => n.owner === PLAYER) || w.convoys.some((c) => c.owner === PLAYER);
  if (!mine) { w.over = 'lose'; return; }
  if (!w.rules.endless) {
    const theirs = w.nodes.some((n) => n.owner >= 2) || w.convoys.some((c) => c.owner >= 2);
    if (!theirs) w.over = 'win';
  }
}

function buyUpgrade(w: World, id: number, key: UpgKey) {
  const n = w.nodes[id];
  if (n.owner !== PLAYER) return;
  const lvl = key === 'tier' ? n.tier - 1 : n[key];
  const costs = UPG[key].cost as readonly number[];
  if (lvl >= costs.length) return;
  const cost = costs[lvl];
  if (w.gold < cost) return;
  w.gold -= cost;
  if (key === 'tier') n.tier++; else n[key]++;
}
function buyTech(w: World, key: TechKey) {
  const lvl = w.tech[key];
  const costs = TECH[key].cost as readonly number[];
  if (lvl >= costs.length || w.gold < costs[lvl]) return;
  w.gold -= costs[lvl];
  w.tech[key]++;
}

// ── Drawing ────────────────────────────────────────────────────────────────

const nodeR = (n: Node) => (n.base ? 20 : 13 + n.tier * 2);

function draw(ctx: CanvasRenderingContext2D, w: World, view: { s: number; ox: number; oy: number }, drag: { from: number; x: number; y: number; over: number | null } | null) {
  const { s, ox, oy } = view;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  // Edges.
  ctx.lineCap = 'round';
  for (const e of w.edges) {
    const a = w.nodes[e.a], b = w.nodes[e.b];
    const sel = w.selected !== null && (e.a === w.selected || e.b === w.selected) && w.nodes[w.selected].owner === PLAYER;
    ctx.strokeStyle = sel ? 'rgba(255,255,255,0.6)' : '#1c1c1c';
    ctx.lineWidth = sel ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  // Drag line.
  if (drag) {
    const a = w.nodes[drag.from];
    const path = drag.over !== null ? route(w, drag.from, drag.over, PLAYER) : null;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    if (path) for (const i of path.slice(1)) ctx.lineTo(w.nodes[i].x, w.nodes[i].y);
    else ctx.lineTo(drag.x, drag.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Cannon shots.
  for (const sh of w.shots) {
    ctx.strokeStyle = `rgba(255,255,255,${1 - sh.age / 0.14})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sh.x1, sh.y1); ctx.lineTo(sh.x2, sh.y2); ctx.stroke();
  }
  // Outposts.
  for (const n of w.nodes) {
    const r = nodeR(n);
    const col = COLORS[n.owner];
    const isSel = w.selected === n.id;
    const canTarget = w.picking !== null && w.picking !== n.id;
    if (n.cannon && n.owner !== 0) {
      ctx.strokeStyle = n.owner === PLAYER ? 'rgba(255,255,255,0.12)' : 'rgba(255,59,59,0.14)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, CANNON_RANGE, 0, Math.PI * 2); ctx.stroke();
    }
    if (canTarget) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 7 + Math.sin(w.time * 6) * 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#000000';
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = n.owner === 0 ? '#111111' : n.owner === PLAYER ? '#ffffff' : col + '33';
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = n.base ? 4 : 2.5;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.stroke();
    if (n.wall) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 4 + n.wall, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (isSel) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = n.owner === PLAYER ? '#000' : '#fff';
    ctx.font = `700 ${n.base ? 15 : 13}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.floor(n.troops)), n.x, n.y + 0.5);
    // Small marks for what is built.
    if (n.owner !== 0 && (n.prod || n.cannon || n.base)) {
      ctx.font = '600 8px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      const bits = [n.base ? 'HQ' : '', n.prod ? `B${n.prod}` : '', n.cannon ? `C${n.cannon}` : ''].filter(Boolean).join(' ');
      ctx.fillText(bits, n.x, n.y + r + 11);
    }
  }
  // Standing orders: a faint road from the outpost to where it ships.
  for (const n of w.nodes) {
    if (!n.route || n.owner !== PLAYER) continue;
    const path = route(w, n.id, n.route.to, PLAYER);
    if (!path) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 5]);
    ctx.lineDashOffset = -w.time * 20;
    ctx.beginPath(); ctx.moveTo(n.x, n.y);
    for (const i of path.slice(1)) ctx.lineTo(w.nodes[i].x, w.nodes[i].y);
    ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
  // Columns.
  for (const c of w.convoys) {
    const p = convoyPos(w, c);
    const col = COLORS[c.owner];
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = '700 9px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(c.n)), p.x, p.y + 0.5);
  }
  // Flash.
  if (w.flash) {
    const a = w.flash.age < 0.2 ? w.flash.age / 0.2 : w.flash.age > 1.2 ? Math.max(0, (1.6 - w.flash.age) / 0.4) : 1;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.font = '800 30px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(w.flash.text, MAP_W / 2, MAP_H * 0.42);
  }
  ctx.restore();
}

// ── UI ─────────────────────────────────────────────────────────────────────

interface Ui {
  gold: number; wave: number; waveT: number; over: 'win' | 'lose' | null; paused: boolean; speed: number;
  sendPct: number; selected: Node | null; tech: Record<TechKey, number>;
  mine: number; theirs: number; picking: boolean;
}

const fmt = (n: number) => String(Math.floor(n));

export default function Game() {
  const [save, setSave] = useState<Save>(freshSave);
  const [screen, setScreen] = useState<'menu' | 'armoury' | 'play'>('menu');
  const [ui, setUi] = useState<Ui | null>(null);
  const [tab, setTab] = useState<'post' | 'tech'>('post');
  const [run, setRun] = useState<{ level: number; endless: boolean }>({ level: 1, endless: false });

  const worldRef = useRef<World | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ s: 1, ox: 0, oy: 0 });
  const dragRef = useRef<{ from: number; x: number; y: number; moved: boolean; over: number | null } | null>(null);
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const sendPctRef = useRef(0.5);
  const settledRef = useRef(false);

  // localStorage is the browser's: read it once mounted, never on the server.
  useEffect(() => { const t = setTimeout(() => setSave(loadSave()), 0); return () => clearTimeout(t); }, []);

  const start = useCallback((level: number, endless: boolean) => {
    const s = loadSave();
    worldRef.current = buildWorld(rulesFor(level, endless), s.meta);
    pausedRef.current = false; speedRef.current = 1; sendPctRef.current = 0.5; settledRef.current = false;
    dragRef.current = null;
    setRun({ level, endless });
    setTab('post');
    setScreen('play');
  }, []);

  // When a run ends, bank the scrap once.
  const settle = useCallback((w: World) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const s = loadSave();
    if (w.rules.endless) {
      s.scrap += w.wave * 2;
      s.bestWave = Math.max(s.bestWave, w.wave);
    } else if (w.over === 'win') {
      const first = s.cleared < w.rules.level;
      s.scrap += (15 + w.rules.level * 6) * (first ? 2 : 1);
      s.cleared = Math.max(s.cleared, w.rules.level);
    } else {
      s.scrap += Math.min(10, w.wave * 2);
    }
    storeSave(s); setSave(s);
  }, []);

  // The loop: sized to the screen, ticked by the clock, drawn every frame.
  useEffect(() => {
    if (screen !== 'play') return;
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`;
      const s = Math.min(r.width / MAP_W, r.height / MAP_H);
      viewRef.current = { s: s * dpr, ox: (r.width - MAP_W * s) / 2 * dpr, oy: (r.height - MAP_H * s) / 2 * dpr };
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    let last = performance.now();
    let uiAcc = 0;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const w = worldRef.current;
      if (!w) return;
      const elapsed = now - last;
      let dt = Math.min(0.05, elapsed / 1000);
      last = now;
      if (pausedRef.current || document.hidden) dt = 0;
      const steps = speedRef.current;
      for (let i = 0; i < steps; i++) step(w, dt);
      if (w.over) settle(w);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const d = dragRef.current;
      draw(ctx, w, viewRef.current, d && d.moved ? { from: d.from, x: d.x, y: d.y, over: d.over } : null);
      uiAcc += elapsed;
      if (uiAcc > 120) {
        uiAcc = 0;
        const sel = w.selected !== null ? { ...w.nodes[w.selected] } : null;
        setUi({
          gold: w.gold, wave: w.wave, waveT: w.waveT, over: w.over, paused: pausedRef.current, speed: speedRef.current,
          sendPct: sendPctRef.current, selected: sel, tech: { ...w.tech },
          mine: w.nodes.filter((n) => n.owner === PLAYER).length, theirs: w.nodes.filter((n) => n.owner >= 2).length, picking: w.picking !== null,
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [screen, settle]);

  // Touch: tap yours to pick it up, tap or drag onto a neighbour to march.
  const toMap = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width;
    const v = viewRef.current;
    return { x: ((e.clientX - r.left) * dpr - v.ox) / v.s, y: ((e.clientY - r.top) * dpr - v.oy) / v.s };
  };
  const hit = (w: World, p: { x: number; y: number }) => {
    let best: Node | null = null; let bd = 30;
    for (const n of w.nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  const onDown = (e: React.PointerEvent) => {
    const w = worldRef.current; if (!w || w.over) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toMap(e);
    const n = hit(w, p);
    if (!n) { w.selected = null; w.picking = null; dragRef.current = null; return; }
    if (w.picking !== null) {
      const from = w.nodes[w.picking];
      if (n.id !== from.id && from.owner === PLAYER) { from.route = { to: n.id, pct: sendPctRef.current }; from.routeT = 0; }
      w.picking = null; dragRef.current = null;
      return;
    }
    w.selected = n.id;
    dragRef.current = n.owner === PLAYER ? { from: n.id, x: p.x, y: p.y, moved: false, over: null } : null;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const p = toMap(e);
    d.x = p.x; d.y = p.y;
    const w = worldRef.current!;
    const from = w.nodes[d.from];
    if (Math.hypot(p.x - from.x, p.y - from.y) > 18) d.moved = true;
    const over = hit(w, p);
    d.over = over && over.id !== d.from ? over.id : null;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = dragRef.current; dragRef.current = null;
    const w = worldRef.current; if (!w || !d || !d.moved) return;
    const n = hit(w, toMap(e));
    if (n && n.id !== d.from) {
      send(w, d.from, n.id, sendPctRef.current);
      // A drag is one gesture: the next one starts clean.
      w.selected = null;
    }
  };

  const act = (f: (w: World) => void) => { const w = worldRef.current; if (w && !w.over) f(w); };

  const buyMeta = (key: MetaKey) => {
    const s = loadSave();
    const lvl = s.meta[key];
    const costs = META[key].cost as readonly number[];
    if (lvl >= costs.length || s.scrap < costs[lvl]) return;
    s.scrap -= costs[lvl]; s.meta[key]++;
    storeSave(s); setSave(s);
  };

  // ── Screens ──────────────────────────────────────────────────────────────

  const shell = 'fixed inset-0 bg-[#000000] text-white select-none overflow-hidden flex flex-col';
  const shellStyle: React.CSSProperties = {
    paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
    WebkitTouchCallout: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation', overscrollBehavior: 'none',
    fontFamily: '-apple-system, system-ui, sans-serif',
  };
  const btn = 'rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-30';

  if (screen === 'menu') {
    const endlessOpen = save.cleared >= ENDLESS_UNLOCK;
    return (
      <div className={shell} style={shellStyle}>
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="text-4xl font-black tracking-tight text-[#ff3b3b]">REDLINE</div>
          <div className="text-sm text-white/50 mt-1">Hold the line. Then take theirs.</div>
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
            <div><div className="text-[11px] uppercase tracking-wider text-white/40">Scrap</div><div className="text-xl font-bold">{save.scrap}</div></div>
            <div className="text-right"><div className="text-[11px] uppercase tracking-wider text-white/40">Best endless</div><div className="text-xl font-bold">{save.bestWave ? `wave ${save.bestWave}` : '—'}</div></div>
            <button className={`${btn} bg-white/10 px-4 py-2 text-sm`} onClick={() => setScreen('armoury')}>Armoury</button>
          </div>
          <div className="mt-6 text-[11px] uppercase tracking-wider text-white/40">Campaign</div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {Array.from({ length: CAMPAIGN_LEVELS }, (_, i) => i + 1).map((L) => {
              const locked = L > save.cleared + 1;
              const done = L <= save.cleared;
              return (
                <button key={L} disabled={locked} onClick={() => start(L, false)}
                  className={`${btn} aspect-square text-lg ${done ? 'bg-white text-black' : 'bg-white/10'}`}>
                  {locked ? '·' : L}
                </button>
              );
            })}
          </div>
          <button disabled={!endlessOpen} onClick={() => start(1, true)}
            className={`${btn} mt-6 w-full bg-white py-4 text-lg text-black`}>
            {endlessOpen ? 'ENDLESS' : `Endless unlocks after level ${ENDLESS_UNLOCK}`}
          </button>
          <div className="mt-8 space-y-2 text-[13px] leading-snug text-white/50">
            <p><b className="text-white/80">Drag</b> from one of your outposts to any other to march. Columns take the shortest road through your ground and fight at the first outpost on it that is not yours, and columns that outnumber the defenders take the ground. <b className="text-white/80">Tap</b> an outpost to build on it, or give it a standing order to keep shipping troops somewhere.</p>
            <p>Outposts breed troops up to their cap. Gold trickles from everything you hold. Spend it on the picked outpost, or on tech for all of them.</p>
            <p>Every <b className="text-white/80">wave</b> the red fills up and gets bolder. Stalling is losing. Clear every red outpost to win.</p>
            <p className="text-white/30">Walls are inherited by whoever takes the outpost. Cannons are not.</p>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'armoury') {
    return (
      <div className={shell} style={shellStyle}>
        <div className="flex items-center justify-between px-5 py-4">
          <button className={`${btn} bg-white/10 px-4 py-2 text-sm`} onClick={() => setScreen('menu')}>Back</button>
          <div className="text-sm"><span className="text-white/40">Scrap </span><b>{save.scrap}</b></div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-6">
          <div className="text-2xl font-black">Armoury</div>
          <div className="text-sm text-white/50 mt-1">Permanent. Paid in scrap from every run, won or lost.</div>
          <div className="mt-4 space-y-2">
            {(Object.keys(META) as MetaKey[]).map((k) => {
              const m = META[k]; const lvl = save.meta[k]; const max = lvl >= m.cost.length;
              const cost = max ? 0 : m.cost[lvl];
              return (
                <div key={k} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <div>
                    <div className="font-bold">{m.name} <span className="text-white/40 font-normal">{lvl}/{m.cost.length}</span></div>
                    <div className="text-xs text-white/50">{m.desc} · now +{m.per * lvl}{m.unit}</div>
                  </div>
                  <button disabled={max || save.scrap < cost} onClick={() => buyMeta(k)} className={`${btn} bg-white px-4 py-2 text-sm text-black`}>
                    {max ? 'MAX' : `${cost}`}
                  </button>
                </div>
              );
            })}
          </div>
          <button className="mt-10 text-xs text-white/30 underline" onClick={() => { if (confirm('Wipe all progress?')) { storeSave(freshSave()); setSave(freshSave()); } }}>Reset everything</button>
        </div>
      </div>
    );
  }

  // Play.
  const sel = ui?.selected ?? null;
  const mineSel = sel?.owner === PLAYER;
  const upgRows = (n: Node) => (Object.keys(UPG) as UpgKey[]).map((k) => {
    const u = UPG[k]; const lvl = k === 'tier' ? n.tier - 1 : n[k];
    const costs = u.cost as readonly number[]; const max = lvl >= costs.length;
    const cost = max ? 0 : costs[lvl];
    return (
      <button key={k} disabled={max || (ui?.gold ?? 0) < cost} onClick={() => act((w) => buyUpgrade(w, n.id, k))}
        className={`${btn} flex flex-col items-start rounded-xl bg-white/5 px-3 py-2 text-left`}>
        <div className="flex w-full items-center justify-between text-[13px]"><b>{u.name}</b><span className="text-white">{max ? 'MAX' : `${cost}g`}</span></div>
        <div className="text-[11px] text-white/45">{u.desc} · {k === 'tier' ? `size ${n.tier}` : `lv ${lvl}`}</div>
      </button>
    );
  });

  return (
    <div className={shell} style={shellStyle}>
      <div className="flex items-center justify-between px-3 pt-2 pb-1 text-[13px]">
        <button className={`${btn} bg-white/10 px-3 py-1.5`} onClick={() => { setScreen('menu'); worldRef.current = null; }}>✕</button>
        <div className="text-center">
          <div className="font-black">{run.endless ? 'ENDLESS' : `LEVEL ${run.level}`} <span className="text-white/40">· wave {ui?.wave ?? 0}</span></div>
          <div className="text-[11px] text-white/45">next wave in {fmt(ui?.waveT ?? 0)}s · {ui?.mine ?? 0} vs {ui?.theirs ?? 0}</div>
        </div>
        <div className="flex gap-1.5">
          <button className={`${btn} bg-white/10 px-2.5 py-1.5`} onClick={() => { speedRef.current = speedRef.current === 1 ? 2 : 1; }}>{ui?.speed ?? 1}×</button>
          <button className={`${btn} bg-white/10 px-2.5 py-1.5`} onClick={() => { pausedRef.current = !pausedRef.current; }}>{ui?.paused ? '▶' : '❚❚'}</button>
        </div>
      </div>
      <div ref={wrapRef} className="relative flex-1 min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 block" style={{ touchAction: 'none' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        {ui?.over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 px-8 text-center">
            <div className={`text-5xl font-black ${ui.over === 'win' ? 'text-white' : 'text-[#ff3b3b]'}`}>{ui.over === 'win' ? 'HELD' : 'OVERRUN'}</div>
            <div className="mt-2 text-white/60">{run.endless ? `Survived ${ui.wave} waves.` : ui.over === 'win' ? `Level ${run.level} cleared on wave ${ui.wave}.` : `Fell on wave ${ui.wave}.`}</div>
            <div className="mt-6 flex gap-3">
              <button className={`${btn} bg-white/10 px-5 py-3`} onClick={() => { setScreen('menu'); worldRef.current = null; }}>Menu</button>
              <button className={`${btn} bg-white px-5 py-3 text-black`} onClick={() => start(run.level, run.endless)}>{ui.over === 'win' ? 'Again' : 'Retry'}</button>
              {ui.over === 'win' && !run.endless && run.level < CAMPAIGN_LEVELS && (
                <button className={`${btn} bg-white px-5 py-3 text-black`} onClick={() => start(run.level + 1, false)}>Next</button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="px-3 pb-2 pt-1">
        <div className="flex items-center justify-between text-[13px]">
          <div><span className="text-white/40">Gold </span><b className="text-white">{fmt(ui?.gold ?? 0)}</b></div>
          <div className="flex gap-1.5">
            <button className={`${btn} px-3 py-1.5 ${tab === 'post' ? 'bg-white/20' : 'bg-white/5'}`} onClick={() => setTab('post')}>Outpost</button>
            <button className={`${btn} px-3 py-1.5 ${tab === 'tech' ? 'bg-white/20' : 'bg-white/5'}`} onClick={() => setTab('tech')}>Tech</button>
            <button className={`${btn} bg-white/10 px-3 py-1.5`} onClick={() => { sendPctRef.current = sendPctRef.current === 0.5 ? 1 : sendPctRef.current === 1 ? 0.25 : 0.5; }}>
              send {Math.round((ui?.sendPct ?? 0.5) * 100)}%
            </button>
          </div>
        </div>
        <div className="mt-2 h-[168px]">
          {tab === 'tech' ? (
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(TECH) as TechKey[]).map((k) => {
                const t = TECH[k]; const lvl = ui?.tech[k] ?? 0; const costs = t.cost as readonly number[]; const max = lvl >= costs.length; const cost = max ? 0 : costs[lvl];
                return (
                  <button key={k} disabled={max || (ui?.gold ?? 0) < cost} onClick={() => act((w) => buyTech(w, k))}
                    className={`${btn} flex flex-col items-start rounded-xl bg-white/5 px-3 py-2 text-left`}>
                    <div className="flex w-full items-center justify-between text-[13px]"><b>{t.name}</b><span className="text-white">{max ? 'MAX' : `${cost}g`}</span></div>
                    <div className="text-[11px] text-white/45">{t.desc} · {lvl}/{costs.length}</div>
                  </button>
                );
              })}
            </div>
          ) : !sel ? (
            <div className="flex h-full items-center justify-center text-center text-[13px] text-white/35">Drag from one of yours to march. Tap one to build.</div>
          ) : !mineSel ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-[13px] text-white/50">
              <div className="font-bold" style={{ color: COLORS[sel.owner] }}>{sel.owner === 0 ? 'NEUTRAL' : NAMES[sel.owner]} {sel.base ? 'HQ' : 'outpost'}</div>
              <div>{Math.floor(sel.troops)} troops{sel.wall ? ` · walls ${sel.wall} (×${wallMult(sel).toFixed(1)})` : ''}{sel.cannon ? ` · cannon ${sel.cannon}` : ''}</div>
              <div className="text-white/30">needs more than {Math.ceil(sel.troops * wallMult(sel))} to take</div>
            </div>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between rounded-xl bg-white/5 px-3 py-1.5 text-[12px]">
                {ui?.picking ? (
                  <span className="text-white">Tap the outpost it should ship to.</span>
                ) : sel.route ? (
                  <span><b>Ships {Math.round(sel.route.pct * 100)}%</b> <span className="text-white/45">down the dotted road, every 2s</span></span>
                ) : (
                  <span className="text-white/45">No standing order.</span>
                )}
                {ui?.picking ? (
                  <button className={`${btn} bg-white/10 px-2.5 py-1`} onClick={() => act((w) => { w.picking = null; })}>Cancel</button>
                ) : sel.route ? (
                  <button className={`${btn} bg-white/10 px-2.5 py-1`} onClick={() => act((w) => { w.nodes[sel.id].route = null; })}>Clear</button>
                ) : (
                  <button className={`${btn} bg-white px-2.5 py-1 text-black`} onClick={() => act((w) => { w.picking = sel.id; })}>Auto-send {Math.round((ui?.sendPct ?? 0.5) * 100)}%</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">{upgRows(sel)}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
