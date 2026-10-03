'use client';

// REDLINE
//
// A territory war for one thumb. The map is a web of outposts; you hold one,
// the red holds one or more, the rest are neutral. Every outpost you hold
// breeds troops. Tap one of yours, tap a neighbour, and a column marches: if
// it outnumbers what is waiting it takes the ground, otherwise it dies on the
// walls. Gold trickles in from everything you hold and buys walls, barracks,
// cannons and bigger outposts. The red plays by the same rules: same
// breeding, same caps, the same gold from the same ground, spent on the same
// upgrades. What it gets on the harder levels is a head start you can see
// on the map (outposts already held, a fatter purse) and sharper generals.
// Clear every red outpost to win. Lose your last one and it's over.
//
// Campaign: twelve levels, each meaner than the last. The Long War: one
// map many screens tall, three factions stacked up it, scrolled with the
// arrows, won the same way. Scrap earned either way buys permanent upgrades
// in the Armoury.
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

const TIER_CAP = [40, 75, 150];
const TIER_PROD = [1, 1.5, 2.2];
const BASE_PROD_PER_S = 0.9;

const UPG = {
  prod: { name: 'Barracks', cost: [30, 55, 95], desc: '+35% troops/s' },
  wall: { name: 'Walls', cost: [25, 50, 90], desc: '+25% defence' },
  cannon: { name: 'Cannon', cost: [45, 80, 130], desc: 'shooter' },
  tier: { name: 'Expand', cost: [60, 130], desc: 'bigger, faster' },
} as const;
type UpgKey = keyof typeof UPG;
const CANNON_DMG = [0, 5, 9, 14];
const CANNON_RANGE = 130;
/** A bigger outpost's guns reach further: +20% a size. */
const cannonRange = (n: Node) => CANNON_RANGE * (1 + 0.2 * (n.tier - 1));
const CANNON_CD = 0.4;

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

interface Save { scrap: number; cleared: number; bestTime: number; meta: Record<MetaKey, number> }
const SAVE_KEY = 'redline.v1';
const freshSave = (): Save => ({ scrap: 0, cleared: 0, bestTime: 0, meta: { prod: 0, speed: 0, gold: 0, cannon: 0 } });
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
  /** A standing order: ship everything to that outpost, every few
   *  seconds, for as long as it stands. Yours only. */
  route: { to: number } | null; routeT: number;
}
interface Edge { a: number; b: number; len: number }
/** A column on the road. `from`/`to` are the leg it is on; `path` is the
 *  whole route, and `leg` which step of it. */
interface Convoy { id: number; owner: number; n: number; from: number; to: number; t: number; dur: number; path: number[]; leg: number }
interface Shot { x1: number; y1: number; x2: number; y2: number; age: number }
interface Faction { id: number; tick: number; dead: number; gold: number; buyT: number }

interface Rules {
  level: number; endless: boolean; nodeCount: number; enemies: number;
  /** How tall the map is; wider than a screen is scrolled. */
  mapH: number;
  aiInterval: number; sendFrac: number;
  /** How good the generals are: the margin they will attack on (bigger is
   *  bolder), and how often they think to mass for a push (1 is every tick). */
  aiMargin: number; aiStageEvery: number;
  /** The head start: outposts already held beside each HQ, and gold in hand. */
  enemyExtra: number; enemyGold: number; neutralBase: number;
}

interface World {
  rules: Rules;
  nodes: Node[]; edges: Edge[]; adj: number[][];
  convoys: Convoy[]; shots: Shot[]; factions: Faction[];
  gold: number; time: number;
  /** Endless: how many times a broken faction has landed again. */
  nextId: number;
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
      level, endless, nodeCount: 90, enemies: 3, mapH: 3200,
      aiInterval: 1.3, sendFrac: 0.7, aiMargin: 0.8, aiStageEvery: 2,
      enemyExtra: 4, enemyGold: 200, neutralBase: 14,
    };
  }
  const L = level;
  return {
    level, endless, mapH: MAP_H,
    nodeCount: Math.min(18, 9 + L),
    enemies: L >= 10 ? 3 : L >= 5 ? 2 : 1,
    aiInterval: Math.max(1.0, 3.3 - L * 0.2),
    sendFrac: Math.min(0.8, 0.5 + L * 0.025),
    aiMargin: Math.min(0.85, 0.45 + L * 0.035),
    aiStageEvery: Math.max(1, 7 - Math.ceil(L / 2)),
    enemyExtra: Math.min(3, Math.floor(L / 3)),
    enemyGold: L * 20,
    neutralBase: 6 + L * 2,
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
  while (nodes.length < rules.nodeCount && tries++ < 40000) {
    const x = PAD + rnd() * (MAP_W - PAD * 2);
    const y = PAD + rnd() * (rules.mapH - PAD * 2);
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
    let best: Node | null = null; let bestD = -Infinity;
    if (rules.endless) {
      // The long war: each HQ sits higher up the map than the last.
      const want = rules.mapH * (0.62 - 0.28 * f);
      for (const n of nodes) {
        if (taken.has(n.id) || hops[n.id] < 4) continue;
        const d = -Math.abs(n.y - want);
        if (d > bestD) { bestD = d; best = n; }
      }
    } else {
      for (const n of nodes) {
        if (taken.has(n.id) || hops[n.id] < Math.min(rules.level >= 6 ? 4 : 3, maxHops)) continue;
        let d = Math.hypot(n.x - home.x, n.y - home.y) + hops[n.id] * 40;
        for (const t of taken) if (t !== home.id) d = Math.min(d, Math.hypot(n.x - nodes[t].x, n.y - nodes[t].y) * 1.4);
        if (d > bestD) { bestD = d; best = n; }
      }
    }
    if (!best) break;
    best.owner = fid; best.base = true; best.tier = 2; best.troops = 40; best.wall = 1;
    taken.add(best.id);
    // A few outposts already theirs, beside the base.
    let extra = rules.enemyExtra;
    for (const nb of adj[best.id]) {
      if (extra <= 0) break;
      const n = nodes[nb];
      if (taken.has(n.id) || n.owner !== 0) continue;
      n.owner = fid; n.troops = 15;
      taken.add(n.id); extra--;
    }
    factions.push({ id: fid, tick: rnd() * rules.aiInterval, dead: 0, gold: rules.enemyGold, buyT: 3 });
  }
  for (const n of nodes) {
    if (n.owner !== 0) continue;
    const far = Math.min(1, Math.hypot(n.x - home.x, n.y - home.y) / Math.hypot(MAP_W, MAP_H));
    n.troops = Math.round(rules.neutralBase * (0.4 + 1.6 * far) + rnd() * 10);
    if (rnd() < 0.18) n.tier = 2;
  }

  return {
    rules, nodes, edges, adj, convoys: [], shots: [], factions,
    gold: 40 + META.gold.per * meta.gold, time: 0,
    nextId: 1,
    tech: { logistics: 0, conscription: 0 }, meta,
    over: null, flash: { text: rules.endless ? 'THE LONG WAR' : `LEVEL ${rules.level}`, age: 0 }, selected: null, picking: null,
  };
}

// ── Simulation ─────────────────────────────────────────────────────────────

const capOf = (n: Node) => TIER_CAP[n.tier - 1] * (n.base ? 1.5 : 1);
const wallMult = (n: Node) => 1 + 0.25 * n.wall;
// One formula for everyone. Your tech and Armoury sit on top; the red has
// neither, only what it builds on the ground.
const prodOf = (w: World, n: Node) => {
  let m = n.owner === PLAYER ? (1 + META.prod.per * w.meta.prod / 100) * (1 + 0.15 * w.tech.conscription) : 1;
  m *= (n.base ? 1.5 : 1) * TIER_PROD[n.tier - 1] * (1 + 0.35 * n.prod);
  return BASE_PROD_PER_S * m;
};
const goldOf = (n: Node) => (n.base ? 1.0 : 0.35 + 0.15 * (n.tier - 1));
const convoySpeed = (w: World, owner: number) =>
  60 * (owner === PLAYER ? (1 + META.speed.per * w.meta.speed / 100) * (1 + 0.25 * w.tech.logistics) : 1);
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

function send(w: World, from: number, to: number, frac: number) { sendCount(w, from, to, Math.floor(w.nodes[from].troops * frac)); }
function sendCount(w: World, from: number, to: number, amount: number) {
  const n = w.nodes[from];
  const path = w.adj[from].includes(to) ? [from, to] : route(w, from, to, n.owner);
  if (!path) return;
  amount = Math.min(amount, Math.floor(n.troops));
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
// the front from the rear.
function aiTick(w: World, f: Faction) {
  const r = w.rules;
  const frac = r.sendFrac;
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
  }
  // Nothing falls to one column: the general picks the target that is
  // nearest to falling, stages for it — every outpost of its that touches
  // nothing hostile ships to the outpost of its beside the target, by road,
  // however far — and goes when what is staged plus what touches the target
  // can break it. Columns arrive one after another and each thins the walls
  // for the next.
  let bestT: Node | null = null; let bestRatio = Infinity; let bestFrom: Node[] = [];
  for (const m of w.nodes) {
    if (m.owner === f.id) continue;
    const ring = w.adj[m.id].filter((i) => w.nodes[i].owner === f.id);
    if (!ring.length) continue;
    const ids = new Set<number>(ring);
    for (const i of ring) for (const j of w.adj[i]) if (w.nodes[j].owner === f.id && j !== m.id) ids.add(j);
    const from = [...ids].map((i) => w.nodes[i]).filter((n) => n.troops >= 10);
    if (!from.length) continue;
    const incoming = w.convoys.filter((c) => c.to === m.id && c.owner === m.owner).reduce((s, c) => s + c.n, 0);
    const need = (m.troops + incoming) * wallMult(m) + 1 + (m.cannon ? 15 * m.cannon : 0);
    const avail = from.reduce((s, n) => s + n.troops * frac, 0);
    const ratio = need / avail;
    if (ratio < bestRatio) { bestRatio = ratio; bestT = m; bestFrom = from; }
  }
  if (!bestT) return;
  if (bestRatio < r.aiMargin) { for (const n of bestFrom) send(w, n.id, bestT.id, frac); return; }
  if (Math.floor(w.time / r.aiInterval) % r.aiStageEvery !== 0) return;
  const stage = w.adj[bestT.id].map((i) => w.nodes[i]).filter((n) => n.owner === f.id).sort((a, b) => b.troops - a.troops)[0];
  if (!stage) return;
  for (const n of w.nodes) {
    if (n.owner !== f.id || n.id === stage.id || n.troops < 12) continue;
    if (w.adj[n.id].some((i) => w.nodes[i].owner !== f.id && w.nodes[i].owner !== 0)) continue; // it holds a front
    send(w, n.id, stage.id, 0.7);
  }
}

// What a general buys, every few seconds, out of the same purse you have:
// walls and then a cannon where the enemy is closest, barracks and a bigger
// HQ behind that. One thing a tick, the most urgent it can afford.
function aiSpend(w: World, f: Faction) {
  const mine = w.nodes.filter((n) => n.owner === f.id);
  if (!mine.length) return;
  const threat = (n: Node) => w.adj[n.id].reduce((s, i) => s + (w.nodes[i].owner !== f.id && w.nodes[i].owner !== 0 ? w.nodes[i].troops : 0), 0);
  const front = mine.filter((n) => threat(n) > 0).sort((a, b) => threat(b) - threat(a));
  const hq = mine.find((n) => n.base) ?? mine[0];
  const wants: [Node, UpgKey][] = [];
  for (const n of front.slice(0, 2)) { if (n.wall < 2) wants.push([n, 'wall']); }
  if (front[0] && front[0].cannon < 1) wants.push([front[0], 'cannon']);
  if (hq.prod < 2) wants.push([hq, 'prod']);
  if (front[0] && front[0].wall < 3) wants.push([front[0], 'wall']);
  if (hq.tier < 3) wants.push([hq, 'tier']);
  if (front[0] && front[0].cannon < 3) wants.push([front[0], 'cannon']);
  for (const n of mine) if (n.prod < 3) wants.push([n, 'prod']);
  for (const [n, k] of wants) {
    const cost = upgradeCost(n, k);
    if (cost === null) continue;
    if (f.gold < cost) return; // the most urgent thing it cannot yet afford: save for it
    f.gold -= cost; applyUpgrade(n, k);
    return;
  }
}

function step(w: World, dt: number) {
  if (w.over) return;
  w.time += dt;
  if (w.flash) { w.flash.age += dt; if (w.flash.age > 1.6) w.flash = null; }

  // Breeding and gold.
  for (const n of w.nodes) {
    if (n.owner === 0) continue;
    const cap = capOf(n);
    if (n.troops < cap) n.troops = Math.min(cap, n.troops + prodOf(w, n) * dt);
    if (n.owner === PLAYER) w.gold += goldOf(n) * dt;
    else { const f = w.factions.find((x) => x.id === n.owner); if (f) f.gold += goldOf(n) * dt; }
  }

  // Standing orders.
  const ROUTE_EVERY = 2;
  for (const n of w.nodes) {
    if (!n.route || n.owner !== PLAYER) continue;
    n.routeT -= dt;
    if (n.routeT > 0) continue;
    n.routeT = ROUTE_EVERY;
    if (n.troops >= 3) send(w, n.id, n.route.to, 1);
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
    let target: Convoy | null = null; let td = cannonRange(n);
    for (const c of w.convoys) {
      if (c.owner === n.owner) continue;
      const p = convoyPos(w, c);
      const d = Math.hypot(p.x - n.x, p.y - n.y);
      if (d < td) { td = d; target = c; }
    }
    if (!target) continue;
    // A shot takes at most a fifth of the column: guns shred a trickle and
    // only thin a push.
    const dmg = CANNON_DMG[n.cannon] * (n.owner === PLAYER ? 1 + META.cannon.per * w.meta.cannon / 100 : 1);
    target.n -= Math.min(dmg, target.n * 0.2);
    const p = convoyPos(w, target);
    w.shots.push({ x1: n.x, y1: n.y, x2: p.x, y2: p.y, age: 0 });
    n.cd = CANNON_CD;
  }
  w.convoys = w.convoys.filter((c) => c.n > 0.5);
  for (const s of w.shots) s.age += dt;
  w.shots = w.shots.filter((s) => s.age < 0.14);

  // Generals.
  for (const f of w.factions) {
    if (f.dead) continue;
    f.tick -= dt;
    if (f.tick <= 0) { aiTick(w, f); f.tick = w.rules.aiInterval; }
    f.buyT -= dt;
    if (f.buyT <= 0) { aiSpend(w, f); f.buyT = 3; }
  }

  // The end.
  const mine = w.nodes.some((n) => n.owner === PLAYER) || w.convoys.some((c) => c.owner === PLAYER);
  if (!mine) { w.over = 'lose'; return; }
  const theirs = w.nodes.some((n) => n.owner >= 2) || w.convoys.some((c) => c.owner >= 2);
  if (!theirs) w.over = 'win';
}

/** What the next level of this costs here, or null at the top. */
function upgradeCost(n: Node, key: UpgKey): number | null {
  const lvl = key === 'tier' ? n.tier - 1 : n[key];
  const costs = UPG[key].cost as readonly number[];
  return lvl >= costs.length ? null : costs[lvl];
}
function applyUpgrade(n: Node, key: UpgKey) { if (key === 'tier') n.tier++; else n[key]++; }
function buyUpgrade(w: World, id: number, key: UpgKey) {
  const n = w.nodes[id];
  if (n.owner !== PLAYER) return;
  const cost = upgradeCost(n, key);
  if (cost === null || w.gold < cost) return;
  w.gold -= cost;
  applyUpgrade(n, key);
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

function draw(ctx: CanvasRenderingContext2D, w: World, view: { s: number; ox: number; oy: number; midY: number }, drag: { from: number; x: number; y: number; over: number | null } | null) {
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
      ctx.beginPath(); ctx.arc(n.x, n.y, cannonRange(n), 0, Math.PI * 2); ctx.stroke();
    }
    if (canTarget) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 7 + n.wall * 4.5 + Math.sin(w.time * 6) * 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#000000';
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = n.owner === 0 ? '#111111' : n.owner === PLAYER ? (n.route ? '#a3a3a3' : '#ffffff') : col + '33';
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = n.base ? 4 : 2.5;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.stroke();
    // Walls: a solid ring for each level, stacked outward, with four gates.
    for (let k = 0; k < n.wall; k++) {
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      const rr = r + 5 + k * 4.5;
      for (let g = 0; g < 4; g++) {
        const a0 = g * Math.PI / 2 + 0.12;
        ctx.beginPath(); ctx.arc(n.x, n.y, rr, a0, a0 + Math.PI / 2 - 0.24); ctx.stroke();
      }
    }
    if (isSel) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 9 + n.wall * 4.5, 0, Math.PI * 2); ctx.stroke();
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
  // Standing orders, for the picked outpost only: gold for where it ships,
  // green for every outpost shipping to it.
  if (w.selected !== null) {
    const road = (from: number, to: number, color: string) => {
      const path = route(w, from, to, PLAYER);
      if (!path) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.setLineDash([3, 6]);
      ctx.lineDashOffset = -w.time * 24;
      ctx.beginPath(); ctx.moveTo(w.nodes[from].x, w.nodes[from].y);
      for (const i of path.slice(1)) ctx.lineTo(w.nodes[i].x, w.nodes[i].y);
      ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    };
    const s = w.nodes[w.selected];
    for (const n of w.nodes) if (n.route && n.owner === PLAYER && n.route.to === s.id && n.id !== s.id) road(n.id, s.id, '#38e08a');
    if (s.route && s.owner === PLAYER) road(s.id, s.route.to, '#ffd166');
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
    ctx.fillText(w.flash.text, MAP_W / 2, view.midY - 40);
  }
  ctx.restore();
}

// ── UI ─────────────────────────────────────────────────────────────────────

interface Ui {
  gold: number; time: number; over: 'win' | 'lose' | null; paused: boolean; speed: number;
  sendPct: number; selected: Node | null; tech: Record<TechKey, number>;
  /** The picked outpost: troops it breeds a minute, and what it takes to fall. */
  selProdPerMin: number; selHold: number;
  /** Everything you hold, breeding, a minute (full outposts breed nothing). */
  prodPerMin: number;
  mine: number; theirs: number; picking: boolean;
  /** Whether the map runs past the screen, and which way there is more of it. */
  canUp: boolean; canDown: boolean;
  /** Every troop on the map and on the road, by faction. */
  army: { owner: number; n: number }[];
}

const fmt = (n: number) => String(Math.floor(n));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function Game() {
  const [save, setSave] = useState<Save>(freshSave);
  const [screen, setScreen] = useState<'menu' | 'armoury' | 'play'>('menu');
  const [ui, setUi] = useState<Ui | null>(null);
  const [tab, setTab] = useState<'post' | 'tech'>('post');
  const [run, setRun] = useState<{ level: number; endless: boolean }>({ level: 1, endless: false });

  const worldRef = useRef<World | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ s: 1, ox: 0, oy: 0, midY: MAP_H / 2 });
  // How far down the map the top of the screen is (map px), on a tall map.
  const scrollRef = useRef(0);
  const maxScrollRef = useRef(0);
  const maxScroll = () => maxScrollRef.current;
  const dragRef = useRef<{ from: number; x: number; y: number; moved: boolean; over: number | null } | null>(null);
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const sendPctRef = useRef(1);
  const settledRef = useRef(false);
  // The last outpost tapped and when: a second tap on it inside 350ms is a double tap.
  const lastTapRef = useRef<{ id: number; t: number }>({ id: -1, t: 0 });
  const scrollByRef = useRef<(dir: number) => void>(() => {});

  // localStorage is the browser's: read it once mounted, never on the server.
  useEffect(() => { const t = setTimeout(() => setSave(loadSave()), 0); return () => clearTimeout(t); }, []);

  const start = useCallback((level: number, endless: boolean) => {
    const s = loadSave();
    worldRef.current = buildWorld(rulesFor(level, endless), s.meta);
    pausedRef.current = false; speedRef.current = 1; sendPctRef.current = 1; settledRef.current = false;
    dragRef.current = null;
    setRun({ level, endless });
    setTab('post');
    setScreen('play');
    // Back to the bottom of the map, where home is.
    scrollRef.current = Infinity; scrollByRef.current(0);
  }, []);

  // When a run ends, bank the scrap once.
  const settle = useCallback((w: World) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const s = loadSave();
    if (w.rules.endless) {
      s.scrap += w.over === 'win' ? 150 : Math.min(30, Math.floor(w.time / 20));
      if (w.over === 'win') s.bestTime = s.bestTime ? Math.min(s.bestTime, Math.floor(w.time)) : Math.floor(w.time);
    } else if (w.over === 'win') {
      const first = s.cleared < w.rules.level;
      s.scrap += (15 + w.rules.level * 6) * (first ? 2 : 1);
      s.cleared = Math.max(s.cleared, w.rules.level);
    } else {
      s.scrap += Math.min(10, Math.floor(w.time / 30));
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
      const mapH = worldRef.current?.rules.mapH ?? MAP_H;
      // Fit the map, or fit its width and scroll, when it is taller than that.
      let s = Math.min(r.width / MAP_W, r.height / mapH);
      let oy = (r.height - mapH * s) / 2;
      // Too small to read whole: fill the width instead and scroll it.
      if (s < 0.55) { s = (r.width / MAP_W) * 0.8; oy = 0; }
      const visibleH = r.height / s;
      maxScrollRef.current = Math.max(0, mapH - visibleH);
      scrollRef.current = Math.max(0, Math.min(maxScrollRef.current, scrollRef.current));
      if (maxScrollRef.current > 0) oy = -scrollRef.current * s;
      const midY = (r.height / 2 - oy) / s;
      viewRef.current = { s: s * dpr, ox: (r.width - MAP_W * s) / 2 * dpr, oy: oy * dpr, midY };
    };
    scrollRef.current = Infinity; // start at the bottom: home
    fit();
    scrollByRef.current = (dir: number) => {
      const r = wrap.getBoundingClientRect();
      const visibleH = r.height / (viewRef.current.s / Math.min(2, window.devicePixelRatio || 1));
      scrollRef.current += dir * visibleH * 0.6;
      fit();
    };
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
      // Slow is a shorter tick; fast is two ticks, so nothing jumps a road.
      const speed = speedRef.current;
      if (speed < 1) step(w, dt * speed);
      else for (let i = 0; i < speed; i++) step(w, dt);
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
          gold: w.gold, time: w.time, over: w.over, paused: pausedRef.current, speed: speedRef.current,
          sendPct: sendPctRef.current, selected: sel, tech: { ...w.tech },
          selProdPerMin: sel ? prodOf(w, sel) * 60 : 0, selHold: sel ? Math.ceil(sel.troops * wallMult(sel)) : 0,
          prodPerMin: w.nodes.filter((n) => n.owner === PLAYER && n.troops < capOf(n) - 0.5).reduce((t, n) => t + prodOf(w, n) * 60, 0),
          mine: w.nodes.filter((n) => n.owner === PLAYER).length, theirs: w.nodes.filter((n) => n.owner >= 2).length, picking: w.picking !== null,
          canUp: scrollRef.current > 0.5, canDown: scrollRef.current < maxScroll() - 0.5,
          army: (() => {
            const by = new Map<number, number>();
            for (const n of w.nodes) if (n.owner !== 0) by.set(n.owner, (by.get(n.owner) ?? 0) + n.troops);
            for (const c of w.convoys) by.set(c.owner, (by.get(c.owner) ?? 0) + c.n);
            return [...by].map(([owner, n]) => ({ owner, n })).sort((a, b) => a.owner - b.owner);
          })(),
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
      if (n.id !== from.id && from.owner === PLAYER) { from.route = { to: n.id }; from.routeT = 0; }
      w.picking = null; dragRef.current = null;
      return;
    }
    // Double tap on one of yours: set an auto-send (tap the target next), or
    // clear the one it has.
    const now = performance.now();
    const twice = lastTapRef.current.id === n.id && now - lastTapRef.current.t < 350;
    lastTapRef.current = { id: n.id, t: now };
    if (twice && n.owner === PLAYER) {
      if (n.route) n.route = null; else w.picking = n.id;
      w.selected = n.id; dragRef.current = null;
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
            <div className="text-right"><div className="text-[11px] uppercase tracking-wider text-white/40">Long war best</div><div className="text-xl font-bold">{save.bestTime ? clock(save.bestTime) : '—'}</div></div>
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
            {endlessOpen ? 'THE LONG WAR' : `The Long War unlocks after level ${ENDLESS_UNLOCK}`}
          </button>
          <div className="mt-8 space-y-2 text-[13px] leading-snug text-white/50">
            <p><b className="text-white/80">Drag</b> from one of your outposts to any other to march. Columns take the shortest road through your ground and fight at the first outpost on it that is not yours, and columns that outnumber the defenders take the ground. <b className="text-white/80">Tap</b> an outpost to build on it, or give it a standing order to keep shipping troops somewhere.</p>
            <p>Outposts breed troops up to their cap. Gold trickles from everything you hold. Spend it on the picked outpost, or on tech for all of them.</p>
            <p>The red plays by your rules: same breeding, same gold, same upgrades bought with it. On the harder levels it starts with more ground and more gold, and its generals are quicker. Clear every red outpost to win.</p>
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
        <div className="text-[11px] text-white/45">{(() => {
          // Barracks and Expand: what the next level adds here, a minute.
          const rate = ui?.selProdPerMin ?? 0;
          if (k === 'prod') { const gain = max ? 0 : rate * ((1 + 0.35 * (lvl + 1)) / (1 + 0.35 * lvl) - 1); return `${max ? 'MAX' : `+${Math.round(gain)} troops/min`} · lv ${lvl}`; }
          if (k === 'tier') { const gain = max ? 0 : rate * (TIER_PROD[n.tier] / TIER_PROD[n.tier - 1] - 1); return `${max ? 'MAX' : `+${Math.round(gain)}/min, holds ${Math.round(capOf({ ...n, tier: n.tier + 1 }))}, +20% range`} · size ${n.tier}`; }
          return `${u.desc} · lv ${lvl}`;
        })()}</div>
      </button>
    );
  });

  return (
    <div className={shell} style={shellStyle}>
      <div className="flex items-center justify-between px-3 pt-2 pb-1 text-[13px]">
        <button className={`${btn} bg-white/10 px-3 py-1.5`} onClick={() => { setScreen('menu'); worldRef.current = null; }}>✕</button>
        <div className="text-center">
          <div className="font-black">{run.endless ? 'LONG WAR' : `LEVEL ${run.level}`} <span className="text-white/40">· {clock(ui?.time ?? 0)}</span></div>
          <div className="text-[11px] text-white/45">{ui?.mine ?? 0} vs {ui?.theirs ?? 0} outposts</div>
        </div>
        <div className="flex gap-1.5">
          <button className={`${btn} bg-white/10 px-2.5 py-1.5`} onClick={() => { if (confirm('Restart this level?')) start(run.level, run.endless); }}>↻</button>
          <button className={`${btn} bg-white/10 px-2.5 py-1.5`} onClick={() => { const steps = [0.5, 1, 2]; speedRef.current = steps[(steps.indexOf(speedRef.current) + 1) % steps.length]; }}>{ui?.speed ?? 1}×</button>
          <button className={`${btn} bg-white/10 px-2.5 py-1.5`} onClick={() => { pausedRef.current = !pausedRef.current; }}>{ui?.paused ? '▶' : '❚❚'}</button>
        </div>
      </div>
      {/* Every troop alive, yours against theirs. */}
      {ui && ui.army.length > 0 && (() => {
        const total = ui.army.reduce((s, a) => s + a.n, 0) || 1;
        return (
          <div className="px-3 pb-1.5">
            <div className="flex h-[6px] w-full overflow-hidden rounded-full bg-white/10">
              {ui.army.map((a) => <div key={a.owner} style={{ width: `${(a.n / total) * 100}%`, background: COLORS[a.owner] }} />)}
            </div>
            <div className="mt-1 flex justify-between text-[11px]">
              {ui.army.map((a) => (
                <span key={a.owner} style={{ color: a.owner === PLAYER ? '#fff' : COLORS[a.owner] }}>
                  {a.owner === PLAYER ? 'YOU' : NAMES[a.owner]} <b>{fmt(a.n)}</b>
                </span>
              ))}
            </div>
          </div>
        );
      })()}
      <div ref={wrapRef} className="relative flex-1 min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 block" style={{ touchAction: 'none' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        {(ui?.canUp || ui?.canDown) && (
          <div className="absolute left-2 top-2 flex flex-col gap-1.5">
            <button disabled={!ui?.canUp} className={`${btn} h-11 w-11 bg-white/10 text-lg`} onClick={() => scrollByRef.current(-1)}>▲</button>
            <button disabled={!ui?.canDown} className={`${btn} h-11 w-11 bg-white/10 text-lg`} onClick={() => scrollByRef.current(1)}>▼</button>
          </div>
        )}
        {ui?.over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 px-8 text-center">
            <div className={`text-5xl font-black ${ui.over === 'win' ? 'text-white' : 'text-[#ff3b3b]'}`}>{ui.over === 'win' ? 'HELD' : 'OVERRUN'}</div>
            <div className="mt-2 text-white/60">{ui.over === 'win' ? `${run.endless ? 'The long war won' : `Level ${run.level} cleared`} in ${clock(ui.time)}.` : `Fell at ${clock(ui.time)}.`}</div>
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
          <div className="leading-tight">
            <div className="text-[11px] text-white/40"><b className="text-white/80">+{Math.round(ui?.prodPerMin ?? 0)}</b> troops/min</div>
            <div><span className="text-white/40">Gold </span><b className="text-white">{fmt(ui?.gold ?? 0)}</b></div>
          </div>
          <div className="flex gap-1.5">
            <button className={`${btn} px-3 py-1.5 ${tab === 'post' ? 'bg-white/20' : 'bg-white/5'}`} onClick={() => setTab('post')}>Outpost</button>
            <button className={`${btn} px-3 py-1.5 ${tab === 'tech' ? 'bg-white/20' : 'bg-white/5'}`} onClick={() => setTab('tech')}>Tech</button>
            <button className={`${btn} bg-white/10 px-3 py-1.5`} onClick={() => { const steps = [0.25, 0.5, 1]; sendPctRef.current = steps[(steps.indexOf(sendPctRef.current) + 1) % steps.length]; }}>
              send {Math.round((ui?.sendPct ?? 1) * 100)}%
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
              <div className="grid grid-cols-2 gap-1.5">{upgRows(sel)}</div>
              {ui?.picking ? (
                <div className="mt-1.5 text-center text-[12px] text-[#ffd166]">Tap where it should auto-send.</div>
              ) : sel.route ? (
                <div className="mt-1.5 text-center text-[12px] text-[#ffd166]">Auto-sending · double-tap to stop</div>
              ) : (
                <div className="mt-1.5 text-center text-[12px] text-white/30">Double-tap to auto-send</div>
              )}
              <div className="mt-1.5 flex justify-between text-[12px] text-white/50">
                <span><b className="text-white">+{Math.round(ui?.selProdPerMin ?? 0)}</b> troops/min{sel.troops >= capOf(sel) - 0.5 ? ' (full)' : ''}</span>
                <span>falls to <b className="text-white">{(ui?.selHold ?? 0) + 1}</b>+</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
