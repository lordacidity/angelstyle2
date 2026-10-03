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
const CAMPAIGN_LEVELS = 24;
const ENDLESS_UNLOCK = 3;

const PLAYER = 1;
const COLORS: Record<number, string> = { 0: '#4a4a4a', 1: '#ffffff', 2: '#ff3b3b', 3: '#ff8a3b', 4: '#c04bff', 5: '#2ee6d6' };
const NAMES: Record<number, string> = { 2: 'RED', 3: 'AMBER', 4: 'VIOLET', 5: 'CYAN' };

const TIER_CAP = [40, 75, 150, 260];
const TIER_PROD = [1, 1.5, 2.2, 3.2];
const BASE_PROD_PER_S = 0.9;

const UPG = {
  prod: { name: 'Barracks', cost: [30, 55, 95, 240], desc: '+35% troops/s' },
  wall: { name: 'Walls', cost: [25, 50, 90, 220], desc: '+25% defence' },
  cannon: { name: 'Cannon', cost: [45, 80, 130, 300], desc: 'shooter' },
  tier: { name: 'Expand', cost: [60, 130, 340], desc: 'bigger, faster' },
} as const;
type UpgKey = keyof typeof UPG;
const CANNON_DMG = [0, 3, 6, 10, 15];
const CANNON_RANGE = 130;
/** A bigger outpost's guns reach further: +20% a size. */
const cannonRange = (n: Node, w: World) => CANNON_RANGE * (1 + 0.2 * (n.tier - 1)) * (n.owner === PLAYER ? (1 + 0.15 * w.tech.scouts) * (1 + META.range.per * w.meta.range / 100) : 1);
const CANNON_CD = 0.5;

// A mine: an outpost dug out for gold. It breeds nothing and keeps no
// walls, guns or barracks, only whatever garrison is sent to sit in it.
// Digging and deepening each cost a set number of troops. Gold a second by depth.
const MINE_GOLD = [0, 1.5, 3, 5];
/** Troops it takes to dig, then to deepen to 2 and to 3. */
const MINE_TROOPS = [100, 150, 250];

const TECH = {
  logistics: { name: 'Logistics', cost: [80, 280], desc: 'march 25% faster' },
  conscription: { name: 'Conscription', cost: [100, 160, 240, 520], desc: '+15% troops/s' },
  tithe: { name: 'Tithe', cost: [150, 340], desc: '+20% gold' },
  scouts: { name: 'Scouts', cost: [120, 280], desc: '+15% cannon range' },
} as const;
type TechKey = keyof typeof TECH;

const META = {
  prod: { name: 'Drill', cost: [40, 75, 120, 180, 260], desc: '+4% troops/s', unit: '%', per: 4 },
  speed: { name: 'Boots', cost: [45, 85, 140, 210], desc: '+6% march speed', unit: '%', per: 6 },
  gold: { name: 'War chest', cost: [30, 60, 100, 150], desc: '+12 starting gold', unit: 'g', per: 12 },
  cannon: { name: 'Powder', cost: [40, 80, 130, 200], desc: '+12% cannon damage', unit: '%', per: 12 },
  masonry: { name: 'Masonry', cost: [45, 90, 150, 230], desc: 'walls +5% stronger a level', unit: '%', per: 5 },
  range: { name: 'Spotters', cost: [40, 80, 130, 200], desc: '+8% cannon range', unit: '%', per: 8 },
  vault: { name: 'Vaults', cost: [40, 75, 120, 180, 260], desc: '+8% gold from all ground', unit: '%', per: 8 },
  cap: { name: 'Quarters', cost: [45, 90, 150, 230], desc: 'outposts hold +8% more', unit: '%', per: 8 },
  garrison: { name: 'Garrison', cost: [30, 60, 100, 150], desc: '+10 troops at the start', unit: '', per: 10 },
} as const;
type MetaKey = keyof typeof META;

// ── Save ───────────────────────────────────────────────────────────────────

interface Save { scrap: number; cleared: number; bestTime: number; meta: Record<MetaKey, number> }
const SAVE_KEY = 'redline.v1';
const freshSave = (): Save => ({ scrap: 0, cleared: 0, bestTime: 0, meta: { prod: 0, speed: 0, gold: 0, cannon: 0, masonry: 0, range: 0, vault: 0, cap: 0, garrison: 0 } });
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
  /** 0, or how deep a mine this is (1 to 3). */
  mine: number;
  /** Loot: soldiers who join whoever takes this, and a pile of gold for them. */
  loot: number; gold: number;
  /** The one outpost every sector of a choke map meets at. */
  hub: boolean;
  /** The holder's Armoury, as it bears on this ground: extra wall strength a level, extra capacity. */
  wallBoost: number; capBoost: number;
  /** A standing order: everything goes, every second, split evenly
   *  between these outposts. Yours only. */
  route: { to: number[] } | null; routeT: number;
}
interface Edge { a: number; b: number; len: number }
/** A column on the road. `from`/`to` are the leg it is on; `path` is the
 *  whole route, and `leg` which step of it. */
interface Convoy { id: number; owner: number; n: number; from: number; to: number; t: number; dur: number; path: number[]; leg: number }
interface Shot { x1: number; y1: number; x2: number; y2: number; age: number }
interface Faction { id: number; tick: number; dead: number; gold: number; buyT: number; tech: { conscription: number; logistics: number } }

interface Rules {
  level: number; endless: boolean; nodeCount: number; enemies: number;
  /** How tall the map is; wider than a screen is scrolled. */
  mapH: number;
  /** The twists of the later levels. */
  title?: string;
  twinHQ?: boolean; mines?: number; fortress?: boolean;
  /** Roads an outpost may have at most (4 unless said), and the size every neutral starts at. */
  maxDeg?: number; neutralTier?: number;
  /** Fog: only outposts beside yours show their numbers. Mercs: gold for 30
   *  troops at any outpost of yours. Shift: every so many seconds one road
   *  goes and another appears. */
  /** Fog: how many roads out from your ground you can see (the last ring
   *  shows no numbers); nothing past that. Shift: every so many seconds one
   *  road goes and another appears. */
  fog?: number; shift?: number;
  /** Choke: every side in its own sector, all of them meeting at one hub.
   *  Hill: hold the hub this many seconds to win. Loot and gold piles sit on
   *  neutral outposts for whoever takes them; hubLoot sits on the hub. Truce:
   *  nobody can take held ground for this many seconds. */
  choke?: boolean; hill?: number; loot?: { count: number; troops: number }; goldPiles?: { count: number; gold: number }; hubLoot?: number; truce?: number;
  /** Walls on every enemy outpost, and tech the generals open with. */
  enemyWalls?: number; enemyTech?: number;
  /** How canny the generals are: 1 pulls out of a lost outpost and shies
   *  from guns; 2 also rides out to meet columns on the road. */
  aiSmart: number;
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
  /** How many targets the order being pointed at takes, and those tapped so far. */
  pickN: number; picked: number[];
  /** Shifting sands: seconds to the next shift. */
  shiftT: number;
  /** The hill: how long you have held the hub, without a break. */
  hillT: number;
}

function rulesFor(level: number, endless: boolean): Rules {
  if (endless) {
    return {
      level, endless, nodeCount: 90, enemies: 3, mapH: 3200,
      aiInterval: 1.3, sendFrac: 0.7, aiMargin: 0.8, aiStageEvery: 2, aiSmart: 1,
      enemyExtra: 4, enemyGold: 200, neutralBase: 14,
    };
  }
  // The generals sharpen with the levels: one to twelve on their own scale,
  // then a notch every four levels. Their canniness climbs in three steps.
  const L = level <= 12 ? level : 11 + Math.floor((level - 12) / 4);
  const base: Rules = {
    level, endless, mapH: MAP_H,
    nodeCount: Math.min(18, 9 + L),
    enemies: level >= 10 ? 3 : level >= 5 ? 2 : 1,
    aiInterval: Math.max(1.0, 3.3 - L * 0.2),
    sendFrac: Math.min(0.8, 0.5 + L * 0.025),
    aiMargin: Math.min(0.85, 0.45 + L * 0.035),
    aiStageEvery: Math.max(1, 7 - Math.ceil(L / 2)),
    enemyExtra: Math.min(3, Math.floor(L / 3)),
    enemyGold: L * 20,
    neutralBase: 6 + L * 2,
    aiSmart: level <= 8 ? 0 : level <= 16 ? 1 : 2,
  };
  const late = (r: Rules): Rules => {
    // Past sixteen the purse grows and the generals open with tech of their own.
    if (level >= 17) r = { ...r, enemyGold: r.enemyGold * 1.5, enemyExtra: Math.min(4, r.enemyExtra + 1), enemyTech: 1 };
    if (level >= 21) r = { ...r, enemyGold: r.enemyGold * 1.5, enemyTech: 2 };
    return r;
  };
  return late(pick());
  function pick(): Rules {
  switch (level) {
    case 1: return { ...base, title: 'FIRST BLOOD' };
    case 2: return { ...base, title: 'THE SPREAD', nodeCount: 13 };
    case 3: return { ...base, title: 'LOOT', loot: { count: 3, troops: 40 } };
    case 4: return { ...base, title: 'TRUCE', truce: 90, enemies: 2 };
    case 5: return { ...base, title: 'GOLD PILES', goldPiles: { count: 3, gold: 80 }, fog: 3 };
    case 6: return { ...base, title: 'THE CHOKE', choke: true, enemies: 2, nodeCount: 16, mapH: 900 };
    case 7: return { ...base, title: 'WALLS UP', enemyWalls: 2 };
    case 8: return { ...base, title: 'THE HILL', choke: true, hill: 60, enemies: 3, nodeCount: 20, mapH: 1000 };
    case 9: return { ...base, title: 'TWIN HQ', twinHQ: true, enemies: 3, enemyGold: 200 };
    case 10: return { ...base, title: 'NARROW ROADS', maxDeg: 3, nodeCount: 22, mapH: 800, fog: 3 };
    case 11: return { ...base, title: 'TRUCE II', truce: 120, loot: { count: 4, troops: 50 }, enemyGold: 250 };
    case 12: return { ...base, title: 'FORTRESS', fortress: true, enemyGold: 300 };
    case 13: return { ...base, title: 'GOLD RUSH', mines: 5, enemyGold: 250, neutralBase: 20 };
    case 14: return { ...base, title: 'DEEP POCKETS', enemyGold: 500, enemyExtra: 1, neutralBase: 18, fog: 2 };
    case 15: return { ...base, title: 'FOUR FRONTS', enemies: 4, nodeCount: 36, mapH: 1200, enemyExtra: 2, enemyGold: 260 };
    case 16: return { ...base, title: 'RICH LAND', mines: 6, enemyGold: 300, enemyExtra: 1, fog: 2 };
    case 17: return { ...base, title: 'THE CHOKE II', choke: true, enemies: 3, fortress: true, hubLoot: 120, nodeCount: 24, mapH: 1100, enemyGold: 300 };
    case 18: return { ...base, title: 'HEAVY FOG', fog: 1, enemyGold: 150, enemyExtra: 1 };
    case 19: return { ...base, title: 'SHIFTING SANDS', shift: 40, maxDeg: 3, nodeCount: 22, mapH: 800, enemyGold: 350, enemyExtra: 2 };
    case 20: return { ...base, title: 'SCRAMBLE', truce: 45, loot: { count: 6, troops: 50 }, goldPiles: { count: 2, gold: 100 }, enemyGold: 300, enemyExtra: 1, fog: 2 };
    case 21: return { ...base, title: 'THE LONG CHOKE', choke: true, enemies: 4, fog: 2, loot: { count: 2, troops: 60 }, nodeCount: 30, mapH: 1300, enemyGold: 300 };
    case 22: return { ...base, title: 'THE GAUNTLET', enemies: 4, nodeCount: 54, mapH: 1800, twinHQ: true, enemyExtra: 3, enemyGold: 600, fog: 3 };
    case 23: return { ...base, title: 'THE HILL II', choke: true, hill: 90, enemies: 4, shift: 45, nodeCount: 28, mapH: 1300, enemyGold: 400, fog: 2 };
    case 24: return { ...base, title: 'ALL OF IT', fog: 1, shift: 45, enemies: 4, nodeCount: 48, mapH: 1600, fortress: true, twinHQ: true, enemyExtra: 2, enemyGold: 450, aiInterval: 1.0, aiMargin: 0.85, aiStageEvery: 1 };
    default: return base;
  }
  }
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

const newNode = (id: number, x: number, y: number): Node =>
  ({ id, x, y, owner: 0, troops: 0, tier: 1, base: false, prod: 0, wall: 0, cannon: 0, cd: 0, mine: 0, loot: 0, gold: 0, hub: false, wallBoost: 0, capBoost: 0, route: null, routeT: 0 });

/** A choke map: one hub in the middle, every side in a wedge of its own
 *  around it, each wedge joined to the hub by a single road and to nothing
 *  else. Returns the sectors' HQs, yours first. */
function buildChoke(rules: Rules, rnd: () => number): { nodes: Node[]; edges: Edge[]; hqs: number[] } {
  const k = rules.enemies + 1;
  const cx = MAP_W / 2, cy = rules.mapH / 2;
  const nodes: Node[] = [newNode(0, cx, cy)];
  nodes[0].hub = true;
  const R = 200;
  const xs = (MAP_W / 2 - 36) / R, ys = (rules.mapH / 2 - 40) / R;
  const sector: number[] = [-1];
  const per = Math.floor((rules.nodeCount - 1) / k);
  for (let i = 0; i < k; i++) {
    const theta = Math.PI / 2 + (2 * Math.PI * i) / k;
    let tries = 0, made = 0;
    while (made < per && tries++ < 6000) {
      const a = theta + (rnd() - 0.5) * (2 * Math.PI / k) * 0.78;
      const r = 80 + rnd() * (R - 80);
      const x = cx + r * Math.cos(a) * xs, y = cy + r * Math.sin(a) * ys;
      if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) >= 52)) { nodes.push(newNode(nodes.length, x, y)); sector.push(i); made++; }
    }
  }
  // Roads inside each wedge, nearest first, no crossings; a tree if need be.
  const edges: Edge[] = [];
  const deg = new Array(nodes.length).fill(0) as number[];
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const crosses = (a: number, b: number) => edges.some((f) => f.a !== a && f.a !== b && f.b !== a && f.b !== b && segmentsCross(nodes[a], nodes[b], nodes[f.a], nodes[f.b]));
  const pairs: Edge[] = [];
  for (let i = 1; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (sector[i] !== sector[j]) continue;
    pairs.push({ a: i, b: j, len: Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) });
  }
  pairs.sort((p, q) => p.len - q.len);
  for (const e of pairs) {
    if (e.len > 150 || deg[e.a] >= 3 || deg[e.b] >= 3 || crosses(e.a, e.b)) continue;
    edges.push(e); deg[e.a]++; deg[e.b]++; parent[find(e.a)] = find(e.b);
  }
  for (const e of pairs) {
    if (find(e.a) === find(e.b) || crosses(e.a, e.b)) continue;
    edges.push(e); deg[e.a]++; deg[e.b]++; parent[find(e.a)] = find(e.b);
  }
  for (const e of pairs) { if (find(e.a) !== find(e.b)) { edges.push(e); parent[find(e.a)] = find(e.b); } }
  // One road from each wedge to the hub, from its nearest outpost; the HQ is its farthest.
  const hqs: number[] = [];
  for (let i = 0; i < k; i++) {
    const mine = nodes.filter((n) => sector[n.id] === i);
    if (!mine.length) continue;
    const near = mine.reduce((p, n) => (Math.hypot(n.x - cx, n.y - cy) < Math.hypot(p.x - cx, p.y - cy) ? n : p));
    edges.push({ a: 0, b: near.id, len: Math.hypot(near.x - cx, near.y - cy) });
    const far = mine.reduce((p, n) => (Math.hypot(n.x - cx, n.y - cy) > Math.hypot(p.x - cx, p.y - cy) ? n : p));
    hqs.push(far.id);
  }
  return { nodes, edges, hqs };
}

function buildWorld(rules: Rules, meta: Record<MetaKey, number>, seedExtra = 0): World {
  const rnd = mulberry32(rules.level * 7919 + (rules.endless ? 104729 : 0) + seedExtra);
  const choke = rules.choke ? buildChoke(rules, rnd) : null;
  const nodes: Node[] = choke ? choke.nodes : [];
  const PAD = 34;
  const MIN_D = 74;
  let tries = 0;
  while (!choke && nodes.length < rules.nodeCount && tries++ < 40000) {
    const x = PAD + rnd() * (MAP_W - PAD * 2);
    const y = PAD + rnd() * (rules.mapH - PAD * 2);
    if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) >= MIN_D)) nodes.push(newNode(nodes.length, x, y));
  }
  // Edges: nearest pairs first, no crossings, no more than four per outpost,
  // then whatever a spanning tree still needs so nothing is cut off.
  const pairs: Edge[] = [];
  if (!choke) for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    pairs.push({ a: i, b: j, len: Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) });
  }
  pairs.sort((p, q) => p.len - q.len);
  const edges: Edge[] = choke ? choke.edges : [];
  const deg = new Array(nodes.length).fill(0) as number[];
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const crosses = (e: Edge) => edges.some((f) => f.a !== e.a && f.a !== e.b && f.b !== e.a && f.b !== e.b && segmentsCross(nodes[e.a], nodes[e.b], nodes[f.a], nodes[f.b]));
  for (const e of pairs) {
    const maxDeg = rules.maxDeg ?? 4;
    if (e.len > 150 || deg[e.a] >= maxDeg || deg[e.b] >= maxDeg || crosses(e)) continue;
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
  const home = choke ? nodes[choke.hqs[0]] : byY[Math.floor(rnd() * Math.min(3, byY.length))];
  home.owner = PLAYER; home.base = true; home.tier = 2; home.troops = 40 + META.garrison.per * meta.garrison; home.wall = 1;
  home.wallBoost = META.masonry.per * meta.masonry / 100; home.capBoost = META.cap.per * meta.cap / 100;
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
    if (choke) {
      best = nodes[choke.hqs[f + 1]] ?? null;
    } else if (rules.endless) {
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
    if (rules.fortress) { best.wall = 3; best.cannon = 2; best.tier = 3; }
    taken.add(best.id);
    // A few outposts already theirs, beside the base.
    let extra = rules.enemyExtra;
    for (const nb of adj[best.id]) {
      if (extra <= 0) break;
      const n = nodes[nb];
      if (taken.has(n.id) || n.owner !== 0) continue;
      n.owner = fid; n.troops = 15; n.wall = rules.enemyWalls ?? 0;
      taken.add(n.id); extra--;
    }
    factions.push({ id: fid, tick: rnd() * rules.aiInterval, dead: 0, gold: rules.enemyGold, buyT: 2, tech: { conscription: rules.enemyTech ?? 0, logistics: rules.enemyTech ? 1 : 0 } });
  }
  for (const n of nodes) {
    if (n.owner !== 0) continue;
    const far = Math.min(1, Math.hypot(n.x - home.x, n.y - home.y) / Math.hypot(MAP_W, MAP_H));
    n.troops = Math.round(rules.neutralBase * (0.4 + 1.6 * far) + rnd() * 10);
    if (rules.neutralTier) n.tier = rules.neutralTier; else if (rnd() < 0.18) n.tier = 2;
  }
  // Twin HQ: a second one of yours, beside the first.
  if (rules.twinHQ) {
    const twin = adj[home.id].map((i) => nodes[i]).filter((n) => n.owner === 0).sort((a, b) => b.y - a.y)[0];
    if (twin) { twin.owner = PLAYER; twin.base = true; twin.tier = 2; twin.troops = 40; twin.wall = 1; twin.wallBoost = home.wallBoost; twin.capBoost = home.capBoost; }
  }
  // The hub: a big neutral garrison, and loot if the level says so.
  if (choke) { nodes[0].troops = Math.round(rules.neutralBase * 2.5); nodes[0].tier = 2; nodes[0].loot = rules.hubLoot ?? 0; }
  // Loot and gold piles: on neutral outposts away from every HQ.
  const farFromHQs = () => nodes.filter((n) => n.owner === 0 && !n.hub && !adj[n.id].some((i) => nodes[i].base));
  if (rules.loot) {
    const pool = farFromHQs();
    for (let k = 0; k < rules.loot.count && pool.length; k++) pool.splice(Math.floor(rnd() * pool.length), 1)[0].loot = rules.loot.troops;
  }
  if (rules.goldPiles) {
    const pool = farFromHQs().filter((n) => !n.loot);
    for (let k = 0; k < rules.goldPiles.count && pool.length; k++) pool.splice(Math.floor(rnd() * pool.length), 1)[0].gold = rules.goldPiles.gold;
  }
  // Gold rush: mines already dug, out in the neutral ground, for whoever takes them.
  if (rules.mines) {
    const pool = nodes.filter((n) => n.owner === 0 && !adj[n.id].some((i) => nodes[i].base && nodes[i].owner === PLAYER));
    for (let k = 0; k < rules.mines && pool.length; k++) {
      const n = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      n.mine = 1;
    }
  }

  return {
    rules, nodes, edges, adj, convoys: [], shots: [], factions,
    gold: 40 + META.gold.per * meta.gold, time: 0,
    nextId: 1,
    tech: { logistics: 0, conscription: 0, tithe: 0, scouts: 0 }, meta,
    over: null, flash: { text: rules.endless ? 'THE LONG WAR' : rules.title ?? `LEVEL ${rules.level}`, age: 0 }, selected: null, picking: null, pickN: 1, picked: [], shiftT: rules.shift ?? 0, hillT: 0,
  };
}

// ── Simulation ─────────────────────────────────────────────────────────────

const capOf = (n: Node) => TIER_CAP[n.tier - 1] * (n.base ? 1.5 : 1) * (1 + n.capBoost);
const wallMult = (n: Node) => 1 + (0.25 + n.wallBoost) * n.wall;
/** Ground changes hands: it takes on the new holder's doctrine. */
function claim(w: World, n: Node, owner: number) {
  n.owner = owner;
  n.wallBoost = owner === PLAYER ? META.masonry.per * w.meta.masonry / 100 : 0;
  n.capBoost = owner === PLAYER ? META.cap.per * w.meta.cap / 100 : 0;
}
// One formula for everyone. Your tech and Armoury sit on top; the red has
// neither, only what it builds on the ground.
const prodOf = (w: World, n: Node) => {
  if (n.mine) return 0;
  let m = n.owner === PLAYER
    ? (1 + META.prod.per * w.meta.prod / 100) * (1 + 0.15 * w.tech.conscription)
    : 1 + 0.15 * (w.factions.find((f) => f.id === n.owner)?.tech.conscription ?? 0);
  m *= (n.base ? 1.5 : 1) * TIER_PROD[n.tier - 1] * (1 + 0.35 * n.prod);
  return BASE_PROD_PER_S * m;
};
/** What your gold is worth: Tithe and the Vaults. */
const goldMult = (w: World) => (1 + 0.2 * w.tech.tithe) * (1 + META.vault.per * w.meta.vault / 100);
const goldOf = (n: Node) => (n.mine ? MINE_GOLD[n.mine] : n.base ? 1.0 : 0.35 + 0.15 * (n.tier - 1));
const convoySpeed = (w: World, owner: number) =>
  60 * (owner === PLAYER
    ? (1 + META.speed.per * w.meta.speed / 100) * (1 + 0.25 * w.tech.logistics)
    : 1 + 0.25 * (w.factions.find((f) => f.id === owner)?.tech.logistics ?? 0));
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

/** A standing order's shipment: the whole garrison, split evenly. */
function shipOrder(w: World, n: Node) {
  if (!n.route) return;
  const each = Math.floor(n.troops / n.route.to.length);
  if (each < 1) return;
  for (const to of n.route.to) sendCount(w, n.id, to, each);
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
    // The road ahead may have shifted away: find a new one, or stop here.
    if (!w.adj[c.from].includes(c.to)) {
      const again = route(w, c.from, c.path[c.path.length - 1], c.owner);
      if (!again) { c.to = c.from; arrive(w, c); return; }
      c.path = again; c.leg = 0; c.to = again[1];
    }
    c.dur = edgeLen(w, c.from, c.to) / convoySpeed(w, c.owner);
    w.convoys.push(c);
    return;
  }
  arrive(w, c);
}

const truceOn = (w: World) => !!w.rules.truce && w.time < w.rules.truce;

function arrive(w: World, c: Convoy) {
  const n = w.nodes[c.to];
  if (n.owner === c.owner) { n.troops += c.n; return; }
  // A truce: held ground cannot be taken; the column turns round.
  if (truceOn(w) && n.owner !== 0) {
    const back = w.nodes[c.from];
    if (back.id === n.id) return;
    w.convoys.push({ ...c, id: w.nextId++, from: n.id, to: back.id, t: 0, dur: edgeLen(w, n.id, back.id) / convoySpeed(w, c.owner), path: [n.id, back.id], leg: 0 });
    return;
  }
  const def = n.troops * wallMult(n);
  if (c.n > def) {
    const was = n.owner;
    claim(w, n, c.owner);
    n.troops = c.n - def;
    // Loot: the soldiers here join the taker; a pile of gold is theirs too.
    if (n.loot) { n.troops += n.loot; n.loot = 0; }
    if (n.gold) {
      if (c.owner === PLAYER) w.gold += n.gold; else { const f = w.factions.find((x) => x.id === c.owner); if (f) f.gold += n.gold; }
      n.gold = 0;
    }
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
  // A canny general gets its troops out of an outpost that is about to
  // fall, to the strongest neighbour of its own, rather than lose them.
  if (r.aiSmart >= 1) {
    for (const n of w.nodes) {
      if (n.owner !== f.id || n.troops < 5) continue;
      const incoming = w.convoys.filter((c) => c.to === n.id && c.owner !== f.id && c.t > 0.5).reduce((s, c) => s + c.n, 0);
      if (incoming <= n.troops * wallMult(n) * 1.1) continue;
      const safe = w.adj[n.id].map((i) => w.nodes[i]).filter((m) => m.owner === f.id).sort((a, b) => b.troops - a.troops)[0];
      if (safe) send(w, n.id, safe.id, 0.9);
    }
  }
  // A cannier one rides out to meet a column on the road before it arrives,
  // when it has the men to win that fight and still hold the gate.
  if (r.aiSmart >= 2 && !truceOn(w)) {
    for (const c of w.convoys) {
      if (c.owner === f.id) continue;
      const n = w.nodes[c.to];
      if (n.owner !== f.id || c.t > 0.6) continue;
      if (w.convoys.some((d) => d.owner === f.id && d.from === n.id && d.to === c.from)) continue;
      const needed = Math.ceil(c.n * 1.2) + 1;
      if (n.troops - needed >= 10) sendCount(w, n.id, c.from, needed);
    }
  }
  for (const n of w.nodes) {
    if (n.owner !== f.id || n.troops < 8) continue;
    // Only the HQ acts every tick: an outpost's garrison sits out half of them.
    if (!n.base && ((n.id * 7 + Math.floor(w.time / w.rules.aiInterval)) & 1)) continue;
    const nbs = w.adj[n.id].map((i) => w.nodes[i]);
    const hostile = nbs.filter((m) => m.owner !== f.id && (!truceOn(w) || m.owner === 0));
    const avail = n.troops * frac;
    let best: Node | null = null; let bestScore = -Infinity;
    for (const m of hostile) {
      const incoming = w.convoys.filter((c) => c.to === m.id && c.owner === m.owner && seesColumn(w, f.id, c)).reduce((s, c) => s + c.n, 0);
      // A canny general counts what the guns on the way will cost.
      const guns = r.aiSmart >= 1 ? w.nodes.filter((g) => g.owner !== f.id && g.cannon && Math.hypot(g.x - m.x, g.y - m.y) < cannonRange(g, w)).reduce((s, g) => s + CANNON_DMG[g.cannon] * 3, 0) : 0;
      const need = (reckon(w, f.id, m) + incoming) * wallMult(m) + 1 + guns;
      if (avail < need * (m.owner === 0 ? 1.1 : 1.25)) continue;
      let score = (m.owner === PLAYER ? 3 : m.owner === 0 ? 1 : 2) + (m.base ? 2.5 : 0) + m.prod * 0.4 - need / avail + (m.hub ? 2 : 0) + (m.loot ? 1.5 : 0) + (m.gold ? 1 : 0);
      if (m.owner === PLAYER && m.cannon && r.aiSmart === 0) score += 1;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (best) { send(w, n.id, best.id, frac); continue; }
    // Full and nothing it can take: bleed the weakest of yours anyway.
    if (n.troops >= capOf(n) * 0.95) {
      const yours = hostile.filter((m) => m.owner === PLAYER).sort((a, b) => reckon(w, f.id, a) * wallMult(a) - reckon(w, f.id, b) * wallMult(b));
      if (yours.length && avail > reckon(w, f.id, yours[0]) * wallMult(yours[0]) * 0.6) { send(w, n.id, yours[0].id, 0.8); continue; }
    }
  }
  // Nothing full ever sits idle: an outpost near its cap with nothing to
  // take ships most of itself, by road, to the thinnest outpost of its that
  // touches the enemy or the unclaimed ground. Its production never stalls.
  const fronts = w.nodes.filter((n) => n.owner === f.id && w.adj[n.id].some((i) => w.nodes[i].owner !== f.id));
  for (const n of w.nodes) {
    if (n.owner !== f.id || n.mine || n.troops < capOf(n) * 0.8) continue;
    if (fronts.includes(n)) continue;
    const to = fronts.filter((m) => m.id !== n.id).sort((a, b) => a.troops - b.troops)[0];
    if (to) send(w, n.id, to.id, 0.7);
  }
  // Nothing falls to one column: the general picks the target that is
  // nearest to falling, stages for it — every outpost of its that touches
  // nothing hostile ships to the outpost of its beside the target, by road,
  // however far — and goes when what is staged plus what touches the target
  // can break it. Columns arrive one after another and each thins the walls
  // for the next.
  let bestT: Node | null = null; let bestRatio = Infinity; let bestFrom: Node[] = [];
  for (const m of w.nodes) {
    if (m.owner === f.id || (truceOn(w) && m.owner !== 0)) continue;
    const ring = w.adj[m.id].filter((i) => w.nodes[i].owner === f.id);
    if (!ring.length) continue;
    const ids = new Set<number>(ring);
    for (const i of ring) for (const j of w.adj[i]) if (w.nodes[j].owner === f.id && j !== m.id) ids.add(j);
    const from = [...ids].map((i) => w.nodes[i]).filter((n) => n.troops >= 10);
    if (!from.length) continue;
    const incoming = w.convoys.filter((c) => c.to === m.id && c.owner === m.owner && seesColumn(w, f.id, c)).reduce((s, c) => s + c.n, 0);
    const need = (reckon(w, f.id, m) + incoming) * wallMult(m) + 1 + (m.cannon ? 15 * m.cannon : 0);
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
  const held = w.nodes.filter((n) => n.owner === f.id);
  const mine = held.filter((n) => !n.mine);
  if (!mine.length) return;
  const threat = (n: Node) => w.adj[n.id].reduce((s, i) => s + (w.nodes[i].owner !== f.id && w.nodes[i].owner !== 0 ? reckon(w, f.id, w.nodes[i]) : 0), 0);
  const front = mine.filter((n) => threat(n) > 0).sort((a, b) => threat(b) - threat(a));
  const hq = mine.find((n) => n.base) ?? mine[0];
  // A mine in the rear, once there is a rear: one for every four outposts.
  const rear = held.filter((n) => !n.base && !n.mine && !w.adj[n.id].some((i) => w.nodes[i].owner !== f.id));
  const minesHeld = held.filter((n) => n.mine).length;
  if (held.length >= 4 && minesHeld < Math.floor(held.length / 4)) {
    const dig = rear.filter((n) => n.troops >= MINE_TROOPS[0]).sort((a, b) => b.troops - a.troops)[0];
    if (dig) digMineAt(dig);
  }
  // The list, most urgent first: a buy is an upgrade on an outpost or a tech.
  type Want = { cost: number | null; buy: () => void };
  const upg = (n: Node, k: UpgKey): Want => ({ cost: upgradeCost(n, k), buy: () => applyUpgrade(n, k) });
  const tech = (k: 'conscription' | 'logistics'): Want => {
    const costs = TECH[k].cost as readonly number[]; const lvl = f.tech[k];
    return { cost: lvl >= costs.length ? null : costs[lvl], buy: () => { f.tech[k]++; } };
  };
  const wants: Want[] = [];
  for (const n of front.slice(0, 2)) if (n.wall < 2) wants.push(upg(n, 'wall'));
  if (hq.prod < 2) wants.push(upg(hq, 'prod'));
  if (front[0] && front[0].cannon < 1) wants.push(upg(front[0], 'cannon'));
  if (held.length >= 3) wants.push(tech('conscription'));
  if (hq.tier < 3) wants.push(upg(hq, 'tier'));
  for (const n of mine) if (n.prod < 2) wants.push(upg(n, 'prod'));
  if (front[0] && front[0].wall < 3) wants.push(upg(front[0], 'wall'));
  if (held.length >= 4) wants.push(tech('logistics'));
  if (front[0] && front[0].cannon < 2) wants.push(upg(front[0], 'cannon'));
  for (const n of mine) if (n.prod < 3) wants.push(upg(n, 'prod'));
  if (held.length >= 5) wants.push(tech('conscription'));
  if (hq.tier < 4) wants.push(upg(hq, 'tier'));
  if (front[0] && front[0].cannon < 3) wants.push(upg(front[0], 'cannon'));
  if (front[0] && front[0].wall < 4) wants.push(upg(front[0], 'wall'));
  for (const n of mine) if (n.prod < 4) wants.push(upg(n, 'prod'));
  if (front[0] && front[0].cannon < 4) wants.push(upg(front[0], 'cannon'));
  for (const n of mine) if (n.tier < 3) wants.push(upg(n, 'tier'));
  // Two buys a tick, in order; it saves for the first thing it cannot afford.
  let bought = 0;
  for (const want of wants) {
    if (want.cost === null) continue;
    if (f.gold < want.cost) return;
    f.gold -= want.cost; want.buy();
    if (++bought >= 2) return;
  }
}

// Shifting sands: one road goes (never one the map would split without)
// and one appears, somewhere a road could run.
function shiftRoads(w: World) {
  const rnd = mulberry32(Math.floor(w.time * 7) + 13);
  const connectedWithout = (skip: number) => {
    const seen = new Set<number>([0]);
    for (const q = [0]; q.length;) {
      const i = q.shift()!;
      for (let k = 0; k < w.edges.length; k++) {
        if (k === skip) continue;
        const e = w.edges[k];
        const j = e.a === i ? e.b : e.b === i ? e.a : -1;
        if (j >= 0 && !seen.has(j)) { seen.add(j); q.push(j); }
      }
    }
    return seen.size === w.nodes.length;
  };
  const gone: number[] = [];
  for (let k = 0; k < w.edges.length; k++) if (connectedWithout(k)) gone.push(k);
  if (!gone.length) return;
  const drop = gone[Math.floor(rnd() * gone.length)];
  w.edges.splice(drop, 1);
  const crosses = (a: number, b: number) => w.edges.some((f) => f.a !== a && f.a !== b && f.b !== a && f.b !== b && segmentsCross(w.nodes[a], w.nodes[b], w.nodes[f.a], w.nodes[f.b]));
  const maxDeg = w.rules.maxDeg ?? 4;
  for (let tries = 0; tries < 200; tries++) {
    const a = Math.floor(rnd() * w.nodes.length), b = Math.floor(rnd() * w.nodes.length);
    if (a === b || w.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) continue;
    const len = Math.hypot(w.nodes[a].x - w.nodes[b].x, w.nodes[a].y - w.nodes[b].y);
    if (len > 150 || crosses(a, b)) continue;
    const deg = (i: number) => w.edges.filter((e) => e.a === i || e.b === i).length;
    if (deg(a) >= maxDeg || deg(b) >= maxDeg) continue;
    w.edges.push({ a, b, len });
    break;
  }
  w.adj = w.nodes.map(() => []);
  for (const e of w.edges) { w.adj[e.a].push(e.b); w.adj[e.b].push(e.a); }
  w.flash = { text: 'THE ROADS SHIFT', age: 0 };
}

/** Fog of war: what you can see, your outposts and whatever touches them. */
function seenByPlayer(w: World): Set<number> | null { return seenBy(w, PLAYER); }
/** Fog of war, for any side: its own outposts and the ones one road off.
 *  Null when there is no fog. */
function seenBy(w: World, owner: number): Set<number> | null {
  if (!w.rules.fog) return null;
  return new Set([...ringsFrom(w, owner).entries()].filter(([, r]) => r <= (w.rules.fog ?? 0)).map(([i]) => i));
}
/** How many roads each outpost is from a side's nearest ground (0 on it). */
function ringsFrom(w: World, owner: number): Map<number, number> {
  const ring = new Map<number, number>();
  const q: number[] = [];
  for (const n of w.nodes) if (n.owner === owner) { ring.set(n.id, 0); q.push(n.id); }
  while (q.length) { const i = q.shift()!; for (const j of w.adj[i]) if (!ring.has(j)) { ring.set(j, ring.get(i)! + 1); q.push(j); } }
  return ring;
}
const ringOf = (w: World, id: number) => ringsFrom(w, PLAYER).get(id) ?? Infinity;
/** The garrison a side reckons an outpost holds. In the fog, nobody's
 *  numbers show but your own: a neutral is taken for an average one, and a
 *  held outpost for half full. Walls show, so they are counted as they are. */
function reckon(w: World, owner: number, m: Node): number {
  if (!w.rules.fog || m.owner === owner) return m.troops;
  // Inside the fog's reach but short of its last ring, the numbers show.
  if ((ringsFrom(w, owner).get(m.id) ?? Infinity) < (w.rules.fog ?? 0)) return m.troops;
  return m.owner === 0 ? w.rules.neutralBase * 1.2 : capOf(m) * 0.5;
}
/** A column a side can see: on a road touching its ground. */
function seesColumn(w: World, owner: number, c: Convoy): boolean {
  if (!w.rules.fog || c.owner === owner) return true;
  const seen = seenBy(w, owner)!;
  return seen.has(c.from) && seen.has(c.to);
}

function step(w: World, dt: number) {
  if (w.over) return;
  w.time += dt;
  if (w.rules.shift) { w.shiftT -= dt; if (w.shiftT <= 0) { w.shiftT = w.rules.shift; shiftRoads(w); } }
  if (w.flash) { w.flash.age += dt; if (w.flash.age > 1.6) w.flash = null; }

  // Breeding and gold.
  for (const n of w.nodes) {
    if (n.owner === 0) continue;
    const cap = capOf(n);
    if (n.troops < cap) n.troops = Math.min(cap, n.troops + prodOf(w, n) * dt);
    if (n.owner === PLAYER) w.gold += goldOf(n) * goldMult(w) * dt;
    else { const f = w.factions.find((x) => x.id === n.owner); if (f) f.gold += goldOf(n) * dt; }
  }

  // Standing orders.
  const ROUTE_EVERY = 1;
  for (const n of w.nodes) {
    if (!n.route || n.owner !== PLAYER) continue;
    n.routeT -= dt;
    if (n.routeT > 0) continue;
    n.routeT = ROUTE_EVERY;
    shipOrder(w, n);
  }

  // Columns on the march.
  for (const c of w.convoys) c.t += dt / c.dur;
  const arrived = w.convoys.filter((c) => c.t >= 1);
  w.convoys = w.convoys.filter((c) => c.t < 1);
  for (const c of arrived) reachNode(w, c);

  // Columns that meet on the road fight there: head on, or one catching the
  // other up. The bigger marches on, short the smaller; equals die together.
  // Not under a truce.
  for (let i = 0; i < w.convoys.length; i++) {
    if (truceOn(w)) break;
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

  // Cannons. Silent under a truce.
  for (const n of w.nodes) {
    if (!n.cannon || n.owner === 0 || truceOn(w)) continue;
    n.cd -= dt;
    if (n.cd > 0) continue;
    let target: Convoy | null = null; let td = cannonRange(n, w);
    for (const c of w.convoys) {
      if (c.owner === n.owner) continue;
      const p = convoyPos(w, c);
      const d = Math.hypot(p.x - n.x, p.y - n.y);
      if (d < td) { td = d; target = c; }
    }
    if (!target) continue;
    const dmg = CANNON_DMG[n.cannon] * (n.owner === PLAYER ? 1 + META.cannon.per * w.meta.cannon / 100 : 1);
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
    if (f.dead) continue;
    f.tick -= dt;
    if (f.tick <= 0) { aiTick(w, f); f.tick = w.rules.aiInterval; }
    f.buyT -= dt;
    if (f.buyT <= 0) { aiSpend(w, f); f.buyT = 2; }
  }

  // The hill: hold the hub, unbroken, for the time the level asks.
  if (w.rules.hill) {
    const hub = w.nodes.find((n) => n.hub);
    w.hillT = hub && hub.owner === PLAYER ? w.hillT + dt : 0;
    if (w.hillT >= w.rules.hill) { w.over = 'win'; return; }
  }

  // The end.
  const mine = w.nodes.some((n) => n.owner === PLAYER) || w.convoys.some((c) => c.owner === PLAYER);
  if (!mine) { w.over = 'lose'; return; }
  const theirs = w.nodes.some((n) => n.owner >= 2) || w.convoys.some((c) => c.owner >= 2);
  if (!theirs) w.over = 'win';
}

/** Dig, or deepen, a mine: the troops it costs are spent, and so is
 *  everything built here; the rest of the garrison stays. */
function mineCost(n: Node): number | null { return n.mine >= 3 ? null : MINE_TROOPS[n.mine]; }
function digMine(w: World, id: number) {
  const n = w.nodes[id];
  if (n.owner !== PLAYER) return;
  digMineAt(n);
}
function digMineAt(n: Node) {
  if (n.base) return;
  const need = mineCost(n);
  if (need === null || n.troops < need) return;
  n.troops -= need; n.mine++;
  n.wall = 0; n.cannon = 0; n.prod = 0; n.route = null; n.cd = 0;
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
  if (n.owner !== PLAYER || n.mine) return;
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

// One offscreen canvas for the fog, kept the size of the screen.
let fogCanvas: HTMLCanvasElement | null = null;
function fogLayer(wPx: number, hPx: number): HTMLCanvasElement {
  if (!fogCanvas) fogCanvas = document.createElement('canvas');
  if (fogCanvas.width !== wPx || fogCanvas.height !== hPx) { fogCanvas.width = wPx; fogCanvas.height = hPx; }
  return fogCanvas;
}

const nodeR = (n: Node) => (n.base ? 17 + n.tier * 1.5 : 12 + n.tier * 2);

function draw(ctx: CanvasRenderingContext2D, w: World, view: { s: number; ox: number; oy: number; midY: number }, drag: { from: number; x: number; y: number; over: number | null } | null) {
  const { s, ox, oy } = view;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  const seen = seenByPlayer(w);
  const rings = seen ? ringsFrom(w, PLAYER) : new Map<number, number>();
  // Edges. In the fog, only roads that touch your ground.
  ctx.lineCap = 'round';
  for (const e of w.edges) {
    if (seen && !(seen.has(e.a) && seen.has(e.b))) continue;
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
  // Outposts. In the fog, only yours and the ones a road away, and those
  // keep their numbers to themselves.
  for (const n of w.nodes) {
    if (seen && !seen.has(n.id)) continue;
    const r = nodeR(n);
    const hidden = seen !== null && n.owner !== PLAYER && rings.get(n.id) === (w.rules.fog ?? 0);
    const col = COLORS[n.owner];
    const isSel = w.selected === n.id;
    const canTarget = w.picking !== null && w.picking !== n.id;
    if (n.cannon && n.owner !== 0) {
      ctx.strokeStyle = n.owner === PLAYER ? 'rgba(255,255,255,0.12)' : 'rgba(255,59,59,0.14)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, cannonRange(n, w), 0, Math.PI * 2); ctx.stroke();
    }
    if (canTarget) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 7 + n.wall * 4.5 + Math.sin(w.time * 6) * 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // The hub: a wide dashed ring round the one outpost everyone wants.
    if (n.hub) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 14, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (n.mine) {
      // A mine: a gold square, edged in its owner's colour.
      const q = r * 0.9;
      ctx.fillStyle = '#000000';
      ctx.fillRect(n.x - q, n.y - q, q * 2, q * 2);
      ctx.fillStyle = n.owner === PLAYER ? (n.route ? '#c9a24f' : '#ffd166') : '#ffd16655';
      ctx.fillRect(n.x - q, n.y - q, q * 2, q * 2);
      ctx.strokeStyle = n.owner === PLAYER ? '#ffd166' : col; ctx.lineWidth = 2.5;
      ctx.strokeRect(n.x - q, n.y - q, q * 2, q * 2);
    } else {
      ctx.fillStyle = '#000000';
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = n.owner === 0 ? '#111111' : n.owner === PLAYER ? (n.route ? '#a3a3a3' : '#ffffff') : col + '33';
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = n.base ? 4 : 2.5;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.stroke();
    }
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
    ctx.fillStyle = n.owner === PLAYER || n.mine ? '#000' : '#fff';
    if (n.mine && n.owner !== PLAYER) ctx.fillStyle = '#fff';
    ctx.font = `700 ${n.base ? 15 : 13}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(hidden ? '?' : String(Math.floor(n.troops)), n.x, n.y + 0.5);
    // Small marks for what is built.
    if (!hidden && (n.mine || n.loot || n.gold || n.hub || (n.owner !== 0 && (n.prod || n.cannon || n.base)))) {
      ctx.font = '600 8px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = n.mine ? '#ffd166' : 'rgba(255,255,255,0.65)';
      ctx.fillStyle = n.mine || n.gold ? '#ffd166' : n.loot ? '#38e08a' : 'rgba(255,255,255,0.65)';
      const bits = [n.hub ? 'HUB' : '', n.loot ? `+${n.loot}` : '', n.gold ? `${n.gold}g` : '', n.mine ? `MINE ${n.mine}` : '', n.base ? 'HQ' : '', n.prod ? `B${n.prod}` : '', n.cannon ? `C${n.cannon}` : ''].filter(Boolean).join(' ');
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
    for (const n of w.nodes) if (n.route && n.owner === PLAYER && n.route.to.includes(s.id) && n.id !== s.id) road(n.id, s.id, '#38e08a');
    if (s.route && s.owner === PLAYER) for (const to of s.route.to) road(s.id, to, '#ffd166');
    if (w.picking === s.id) for (const to of w.picked) road(s.id, to, '#ffd166');
  }
  // Columns.
  for (const c of w.convoys) {
    if (seen && c.owner !== PLAYER && !(seen.has(c.from) && seen.has(c.to))) continue;
    const p = convoyPos(w, c);
    const col = COLORS[c.owner];
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = '700 9px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(c.n)), p.x, p.y + 0.5);
  }
  // The fog itself: grey over the whole map, with a soft clearing around
  // each outpost of yours that reaches just past its neighbours.
  if (seen) {
    const fog = fogLayer(ctx.canvas.width, ctx.canvas.height);
    const fc = fog.getContext('2d')!;
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.globalCompositeOperation = 'source-over';
    fc.fillStyle = 'rgba(44,45,52,0.96)';
    fc.fillRect(0, 0, fog.width, fog.height);
    fc.setTransform(s, 0, 0, s, ox, oy);
    fc.globalCompositeOperation = 'destination-out';
    for (const n of w.nodes) {
      if (!seen.has(n.id)) continue;
      const reach = n.owner === PLAYER ? 90 : 62;
      const g = fc.createRadialGradient(n.x, n.y, reach * 0.55, n.x, n.y, reach);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = g;
      fc.beginPath(); fc.arc(n.x, n.y, reach, 0, Math.PI * 2); fc.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fog, 0, 0);
    ctx.setTransform(s, 0, 0, s, ox, oy);
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
  /** Everything you hold, breeding, a minute (full outposts breed nothing), and the gold it pays. */
  prodPerMin: number; goldPerMin: number;
  mine: number; theirs: number; picking: boolean; pickN: number; pickLeft: number;
  selHidden: boolean; shiftT: number;
  truceT: number; hillT: number; hillNeed: number;
  /** Whether the map runs past the screen, and which way there is more of it. */
  /** The scrollbar: how far down the map the view is (0..1) and how much of it shows (0..1); 1 means all. */
  scrollFrac: number; viewFrac: number;
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
  // Which outpost the panel last showed, so a new pick flips it back to Outpost.
  const lastSelRef = useRef<number | null>(null);
  const [run, setRun] = useState<{ level: number; endless: boolean }>({ level: 1, endless: false });

  const worldRef = useRef<World | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ s: 1, ox: 0, oy: 0, midY: MAP_H / 2 });
  // The camera: how far past the fit it is zoomed (1 is the fit), and the
  // map point under the middle of the screen. Set while paused, kept while
  // playing. Infinity for cy means "the bottom, where home is".
  const camRef = useRef({ zoom: 1.3, cx: MAP_W / 2, cy: Infinity });
  // What the scrollbar reads: how far down the view is, and how much it shows.
  const scrollFracRef = useRef(0);
  // Where the scrollbar was grabbed, and how far down it was then.
  const barGrabRef = useRef<{ y: number; frac: number } | null>(null);
  const viewFracRef = useRef(1);
  // Fingers on the map while paused: one pans, two pinch.
  const fingersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  // A finger down while paused: a tap if it stays put, a pan if it moves.
  const pausedTapRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const dragRef = useRef<{ from: number; x: number; y: number; moved: boolean; over: number | null } | null>(null);
  const pausedRef = useRef(false);
  const speedRef = useRef(0.5);
  const sendPctRef = useRef(1);
  const settledRef = useRef(false);
  // The last outpost tapped and when: a second tap on it inside 350ms is a double tap.
  const lastTapRef = useRef<{ id: number; t: number }>({ id: -1, t: 0 });
  /** Scroll to a fraction of the way down the map. */
  const scrollToRef = useRef<(frac: number) => void>(() => {});
  /** Re-fit the view to the camera. */
  const refitRef = useRef<() => void>(() => {});

  // localStorage is the browser's: read it once mounted, never on the server.
  useEffect(() => { const t = setTimeout(() => setSave(loadSave()), 0); return () => clearTimeout(t); }, []);

  const start = useCallback((level: number, endless: boolean) => {
    const s = loadSave();
    worldRef.current = buildWorld(rulesFor(level, endless), s.meta);
    pausedRef.current = false; speedRef.current = 0.5; sendPctRef.current = 1; settledRef.current = false;
    dragRef.current = null;
    setRun({ level, endless });
    setTab('post');
    setScreen('play');
    // Back to the bottom of the map, where home is, at the fit.
    camRef.current = { zoom: 1.3, cx: MAP_W / 2, cy: Infinity }; refitRef.current();
  }, []);

  // When a run ends, bank the scrap once.
  const settle = useCallback((w: World) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const s = loadSave();
    if (w.rules.endless) {
      s.scrap += w.over === 'win' ? 120 : Math.min(20, Math.floor(w.time / 30));
      if (w.over === 'win') s.bestTime = s.bestTime ? Math.min(s.bestTime, Math.floor(w.time)) : Math.floor(w.time);
    } else if (w.over === 'win') {
      const first = s.cleared < w.rules.level;
      s.scrap += Math.round((10 + w.rules.level * 4) * (first ? 1.5 : 1));
      s.cleared = Math.max(s.cleared, w.rules.level);
    } else {
      s.scrap += Math.min(6, Math.floor(w.time / 45));
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
      if (r.width < 1 || r.height < 1) return; // not on screen: nothing to fit to
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`;
      const mapH = worldRef.current?.rules.mapH ?? MAP_H;
      // The fit: the whole map, or its width when the whole would be too
      // small to read. The camera zooms in from there.
      let base = Math.min(r.width / MAP_W, r.height / mapH);
      if (base < 0.42) base = (r.width / MAP_W) * 0.8;
      const cam = camRef.current;
      cam.zoom = Math.max(1, Math.min(3, cam.zoom));
      const s = base * cam.zoom;
      const visW = r.width / s, visH = r.height / s;
      // The map never leaves the screen: centred where it is smaller than the
      // view, and held inside it where it is larger.
      cam.cx = MAP_W <= visW ? MAP_W / 2 : Math.max(visW / 2, Math.min(MAP_W - visW / 2, cam.cx));
      cam.cy = mapH <= visH ? mapH / 2 : Math.max(visH / 2, Math.min(mapH - visH / 2, cam.cy));
      const ox = r.width / 2 - cam.cx * s, oy = r.height / 2 - cam.cy * s;
      viewFracRef.current = Math.min(1, visH / mapH);
      scrollFracRef.current = mapH <= visH ? 0 : (cam.cy - visH / 2) / (mapH - visH);
      viewRef.current = { s: s * dpr, ox: ox * dpr, oy: oy * dpr, midY: cam.cy };
    };
    fit();
    refitRef.current = fit;
    scrollToRef.current = (frac: number) => {
      const r = wrap.getBoundingClientRect();
      const mapH = worldRef.current?.rules.mapH ?? MAP_H;
      const visH = r.height / (viewRef.current.s / Math.min(2, window.devicePixelRatio || 1));
      camRef.current.cy = visH / 2 + Math.max(0, Math.min(1, frac)) * (mapH - visH);
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
        if (w.selected !== null && w.selected !== lastSelRef.current) setTab('post');
        lastSelRef.current = w.selected;
        setUi({
          gold: w.gold, time: w.time, over: w.over, paused: pausedRef.current, speed: speedRef.current,
          sendPct: sendPctRef.current, selected: sel, tech: { ...w.tech },
          selProdPerMin: sel ? prodOf(w, sel) * 60 : 0, selHold: sel ? Math.ceil(sel.troops * wallMult(sel)) : 0,
          prodPerMin: w.nodes.filter((n) => n.owner === PLAYER && n.troops < capOf(n) - 0.5).reduce((t, n) => t + prodOf(w, n) * 60, 0),
          goldPerMin: w.nodes.filter((n) => n.owner === PLAYER).reduce((t, n) => t + goldOf(n), 0) * goldMult(w) * 60,
          mine: w.nodes.filter((n) => n.owner === PLAYER).length, theirs: w.nodes.filter((n) => n.owner >= 2).length, picking: w.picking !== null, pickN: w.pickN, pickLeft: w.pickN - w.picked.length,
          selHidden: !!(w.rules.fog && sel && sel.owner !== PLAYER && !(seenByPlayer(w)?.has(sel.id) && ringOf(w, sel.id) < (w.rules.fog ?? 0))), shiftT: w.rules.shift ? w.shiftT : 0, truceT: w.rules.truce ? Math.max(0, w.rules.truce - w.time) : 0, hillT: w.hillT, hillNeed: w.rules.hill ?? 0,
          scrollFrac: scrollFracRef.current, viewFrac: viewFracRef.current,
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
    const seen = seenByPlayer(w);
    let best: Node | null = null; let bd = 30;
    for (const n of w.nodes) { if (seen && !seen.has(n.id)) continue; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  // Paused: the map is the thing under the fingers. One drags it, two pinch it.
  const panDown = (e: React.PointerEvent) => {
    fingersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingersRef.current.size === 2) {
      const [a, b] = [...fingersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: camRef.current.zoom };
    }
  };
  const panMove = (e: React.PointerEvent) => {
    const f = fingersRef.current.get(e.pointerId); if (!f) return;
    const canvas = canvasRef.current!;
    const sCss = viewRef.current.s / (canvas.width / canvas.getBoundingClientRect().width);
    if (fingersRef.current.size >= 2 && pinchRef.current) {
      f.x = e.clientX; f.y = e.clientY;
      const [a, b] = [...fingersRef.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      camRef.current.zoom = pinchRef.current.zoom * (d / Math.max(1, pinchRef.current.dist));
    } else {
      camRef.current.cx -= (e.clientX - f.x) / sCss;
      camRef.current.cy -= (e.clientY - f.y) / sCss;
      f.x = e.clientX; f.y = e.clientY;
    }
    refitRef.current();
  };
  const panUp = (e: React.PointerEvent) => {
    fingersRef.current.delete(e.pointerId);
    if (fingersRef.current.size < 2) pinchRef.current = null;
  };
  // What a tap on an outpost does: picks it, answers an auto-send pick, or
  // (twice) sets or clears one. Playing or paused.
  const tapNode = (w: World, n: Node): boolean => {
    if (w.picking !== null) {
      const from = w.nodes[w.picking];
      if (n.id !== from.id && from.owner === PLAYER && !w.picked.includes(n.id)) w.picked.push(n.id);
      if (w.picked.length >= w.pickN) {
        from.route = { to: [...w.picked] }; from.routeT = 1;
        shipOrder(w, from);
        w.picking = null; w.picked = [];
      }
      return true;
    }
    const now = performance.now();
    const twice = lastTapRef.current.id === n.id && now - lastTapRef.current.t < 350;
    lastTapRef.current = { id: n.id, t: now };
    if (twice && n.owner === PLAYER) {
      if (n.route) n.route = null; else { w.picking = n.id; w.pickN = 1; w.picked = []; }
      w.selected = n.id;
      return true;
    }
    w.selected = n.id;
    return false;
  };
  const onDown = (e: React.PointerEvent) => {
    const w = worldRef.current; if (!w || w.over) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toMap(e);
    const n = hit(w, p);
    // Paused: a finger on one of yours still marches (below); anywhere else
    // it pans, or taps.
    if (pausedRef.current && !(n && n.owner === PLAYER && fingersRef.current.size === 0)) {
      panDown(e);
      pausedTapRef.current = fingersRef.current.size === 1 ? { x: e.clientX, y: e.clientY, moved: false } : null;
      return;
    }
    if (!n) { w.selected = null; w.picking = null; w.picked = []; dragRef.current = null; return; }
    if (tapNode(w, n)) { dragRef.current = null; return; }
    dragRef.current = n.owner === PLAYER ? { from: n.id, x: p.x, y: p.y, moved: false, over: null } : null;
  };
  const onMove = (e: React.PointerEvent) => {
    if (fingersRef.current.size) {
      const t = pausedTapRef.current;
      if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) t.moved = true;
      if (fingersRef.current.size > 1) pausedTapRef.current = null;
      panMove(e); return;
    }
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
    if (fingersRef.current.size) {
      panUp(e);
      // A still finger while paused is a tap on the map, same as playing.
      const t = pausedTapRef.current; pausedTapRef.current = null;
      const w = worldRef.current;
      if (t && !t.moved && w && !w.over) {
        const n = hit(w, toMap(e));
        if (n) tapNode(w, n); else { w.selected = null; w.picking = null; w.picked = []; }
      }
      return;
    }
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
            <p>An outpost with 100 troops can be dug into a <b className="text-white/80">mine</b>: it breeds nothing and keeps nothing built, but pays gold, more the deeper it goes. Digging and deepening cost troops. Whoever takes a mine keeps it.</p>
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
        className={`${btn} flex flex-col items-start rounded-xl bg-white/5 px-3 py-1 text-left`}>
        <div className="flex w-full items-center justify-between text-[13px]"><b>{u.name}</b><span className="text-white">{max ? 'MAX' : `${cost}g`}</span></div>
        <div className="text-[11px] text-white/45">{(() => {
          // Barracks and Expand: what the next level adds here, a minute.
          const rate = ui?.selProdPerMin ?? 0;
          if (k === 'prod') { const gain = max ? 0 : rate * ((1 + 0.35 * (lvl + 1)) / (1 + 0.35 * lvl) - 1); return `${max ? 'MAX' : `+${Math.round(gain)} troops/min`} · lv ${lvl}`; }
          if (k === 'tier') { const gain = max ? 0 : rate * (TIER_PROD[n.tier] / TIER_PROD[n.tier - 1] - 1); return `${max ? 'MAX' : `+${Math.round(gain)}/min · holds ${Math.round(capOf({ ...n, tier: n.tier + 1 }))}`} · size ${n.tier}`; }
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
          <div className="text-[11px] text-white/45">{ui?.mine ?? 0} vs {ui?.theirs ?? 0} outposts{(ui?.shiftT ?? 0) > 0 ? ` · roads shift in ${fmt(ui?.shiftT ?? 0)}s` : ''}{(ui?.truceT ?? 0) > 0 ? ` · truce ${fmt(ui?.truceT ?? 0)}s` : ''}{(ui?.hillNeed ?? 0) > 0 ? ` · hill ${fmt(ui?.hillT ?? 0)}/${ui?.hillNeed}s` : ''}</div>
        </div>
        <button className={`${btn} bg-white/10 px-3 py-1.5`} onClick={() => { if (confirm('Restart this level?')) start(run.level, run.endless); }}>↻</button>
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
        {/* A tall map: a scrollbar down the left, dragged or tapped, the thumb as long as the view is. */}
        {ui && ui.viewFrac < 1 && (
          <div className="absolute bottom-2 left-0 top-2 w-11" style={{ touchAction: 'none' }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); barGrabRef.current = { y: e.clientY, frac: ui.scrollFrac }; }}
            onPointerMove={(e) => { const g = barGrabRef.current; if (!g || !e.currentTarget.hasPointerCapture(e.pointerId)) return; const r = e.currentTarget.getBoundingClientRect(); scrollToRef.current(g.frac + (e.clientY - g.y) / r.height / (1 - ui.viewFrac)); }}
            onPointerUp={() => { barGrabRef.current = null; }} onPointerCancel={() => { barGrabRef.current = null; }}>
            <div className="absolute bottom-0 left-2 top-0 w-3 rounded-full bg-white/10" />
            <div className="absolute left-2 w-3 rounded-full bg-white/70" style={{ top: `${ui.scrollFrac * (1 - ui.viewFrac) * 100}%`, height: `${ui.viewFrac * 100}%` }} />
          </div>
        )}
        {ui?.over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 px-8 text-center">
            <div className={`text-5xl font-black ${ui.over === 'win' ? 'text-white' : 'text-[#ff3b3b]'}`}>{ui.over === 'win' ? 'HELD' : 'OVERRUN'}</div>
            <div className="mt-2 text-white/60">{ui.over === 'win' ? `${run.endless ? 'The long war won' : (ui.hillNeed ? 'The hill held' : `Level ${run.level} cleared`)} in ${clock(ui.time)}.` : `Fell at ${clock(ui.time)}.`}</div>
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
      <div className="px-3 pb-0.5 pt-1">
        <div className="flex items-center justify-between text-[13px]">
          <div className="leading-tight">
            <button className={`${btn} mb-1 whitespace-nowrap bg-white/10 px-3 py-1.5 text-[13px]`} onClick={() => act((w) => { for (const n of w.nodes) n.route = null; w.picking = null; w.picked = []; })}>Clear autos</button>
            <div className="whitespace-nowrap text-[11px] text-white/40"><b className="text-white/80">+{Math.round(ui?.prodPerMin ?? 0)}</b> troops/min</div>
            <div className="whitespace-nowrap text-[11px] text-white/40"><b className="text-white/80">+{Math.round(ui?.goldPerMin ?? 0)}</b> gold/min</div>
            <div><span className="text-white/40">Gold </span><b className="text-white">{fmt(ui?.gold ?? 0)}</b></div>
          </div>
          <div className="flex items-end gap-1.5">
            <button className={`${btn} px-3 py-1.5 ${tab === 'post' ? 'bg-white/20' : 'bg-white/5'}`} onClick={() => setTab('post')}>Outpost</button>
            <button className={`${btn} px-3 py-1.5 ${tab === 'tech' ? 'bg-white/20' : 'bg-white/5'}`} onClick={() => setTab('tech')}>Tech</button>
            <div className="flex flex-col gap-1">
              <button className={`${btn} bg-white/10 px-3 py-1 text-[12px]`} onClick={() => { const steps = [0.5, 1, 2]; speedRef.current = steps[(steps.indexOf(speedRef.current) + 1) % steps.length]; }}>{ui?.speed ?? 1}×</button>
              <button className={`${btn} bg-white/10 px-3 py-1 text-[12px]`} onClick={() => { pausedRef.current = !pausedRef.current; }}>{ui?.paused ? '▶' : '❚❚'}</button>
              <button className={`${btn} whitespace-nowrap bg-white/10 px-3 py-1.5`} onClick={() => { const steps = [0.25, 0.5, 1]; sendPctRef.current = steps[(steps.indexOf(sendPctRef.current) + 1) % steps.length]; }}>
                send {Math.round((ui?.sendPct ?? 1) * 100)}%
              </button>
            </div>
          </div>
        </div>
        <div className="mt-1 h-[184px]">
          {tab === 'tech' ? (
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(TECH) as TechKey[]).map((k) => {
                const t = TECH[k]; const lvl = ui?.tech[k] ?? 0; const costs = t.cost as readonly number[]; const max = lvl >= costs.length; const cost = max ? 0 : costs[lvl];
                return (
                  <button key={k} disabled={max || (ui?.gold ?? 0) < cost} onClick={() => act((w) => buyTech(w, k))}
                    className={`${btn} flex flex-col items-start rounded-xl bg-white/5 px-3 py-1 text-left`}>
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
              {ui?.selHidden ? (
                <div className="text-white/30">Its numbers are in the fog.{sel.wall ? ` Walls ${sel.wall}.` : ''}{sel.cannon ? ` Cannon ${sel.cannon}.` : ''}</div>
              ) : (
                <>
                  <div>{Math.floor(sel.troops)} troops{sel.wall ? ` · walls ${sel.wall} (×${wallMult(sel).toFixed(1)})` : ''}{sel.cannon ? ` · cannon ${sel.cannon}` : ''}</div>
                  <div className="text-white/30">needs more than {Math.ceil(sel.troops * wallMult(sel))} to take</div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between text-[12px]">
                {ui?.picking ? (
                  <span className="text-[#ffd166]">{ui.pickN === 1 ? 'Tap the target.' : ui.pickLeft === 2 ? 'Tap the first target.' : 'Tap the second.'}</span>
                ) : (
                  <span className="text-white/50">
                    {sel.mine ? <span className="text-white/40">breeds nothing</span> : <><b className="text-white">+{Math.round(ui?.selProdPerMin ?? 0)}</b> troops/min{sel.troops >= capOf(sel) - 0.5 ? ' (full)' : ''}</>}
                    <span className="text-white/25"> · </span>falls to <b className="text-white">{(ui?.selHold ?? 0) + 1}</b>+
                  </span>
                )}
                {ui?.picking ? (
                  <button className={`${btn} bg-white/10 px-2.5 py-1`} onClick={() => act((w) => { w.picking = null; w.picked = []; })}>Cancel</button>
                ) : (
                  <span className="flex gap-1.5">
                    <button className={`${btn} bg-white/10 px-2.5 py-1`} onClick={() => act((w) => { w.picking = sel.id; w.pickN = 2; w.picked = []; })}>Split 50/50</button>
                    {sel.route && <button className={`${btn} bg-white/10 px-2.5 py-1`} onClick={() => act((w) => { w.nodes[sel.id].route = null; })}>Clear</button>}
                  </span>
                )}
              </div>
              {sel.mine ? (
                <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                  <div>
                    <div className="text-[13px]"><b className="text-[#ffd166]">Mine {sel.mine}</b> <span className="text-white/45">· +{Math.round(MINE_GOLD[sel.mine] * 60)} gold/min</span></div>
                    <div className="text-[11px] text-white/45">{mineCost(sel) === null ? 'As deep as it goes.' : `Deepen: ${MINE_TROOPS[sel.mine]} troops · +${Math.round((MINE_GOLD[sel.mine + 1] - MINE_GOLD[sel.mine]) * 60)} gold/min`}</div>
                  </div>
                  {mineCost(sel) !== null && (
                    <button disabled={sel.troops < MINE_TROOPS[sel.mine]} onClick={() => act((w) => digMine(w, sel.id))} className={`${btn} bg-[#ffd166] px-3 py-1.5 text-[13px] text-black`}>Deepen</button>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1.5">{upgRows(sel)}</div>
                  <button disabled={sel.base || sel.troops < MINE_TROOPS[0]} onClick={() => act((w) => digMine(w, sel.id))}
                    className={`${btn} mt-1 flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-1 text-left`}>
                    <span className="text-[13px]"><b className="text-[#ffd166]">Dig mine</b> <span className="text-white/45">· +{Math.round(MINE_GOLD[1] * 60)} gold/min</span></span>
                    <span className="text-[12px] text-white/60">{sel.base ? 'not an HQ' : `${MINE_TROOPS[0]} troops`}</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
