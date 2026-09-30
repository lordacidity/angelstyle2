'use client';

// The spider: everyone and everything in the log, drawn as one web.
//
//   circle   a person, colored by warmth (green once they have invested),
//            bigger the more they have been touched
//   square   a firm, holding its people
//   diamond  a place, holding its firms and people
//   small    an event that involved two or more people, holding them together
//   center   you, tied to everyone you have ever reached
//
// Drawn ties (friends, mutuals...) run person to person in their own colors.
//
// The same web is laid out five ways, and the lines stay in all of them:
//
//   free      nothing but the forces: everything pushes everything else away,
//             every line pulls its two ends together, and it settles
//   map       places pinned where they are on the earth, over country outlines;
//             the people and firms of a place gather around it
//   rings     you in the middle; the closer someone is (invested, hot, warm,
//             cold), the nearer their ring
//   clusters  everyone gathered by their firm (or their place), so the lines
//             that cross between groups are the ones to look at
//   timeline  everyone at the date they were last touched, oldest on the left,
//             so who has gone quiet is on the left and today is on the right
//
// Drag a node to move it, drag the background to pan, scroll to zoom, click
// to open. The layout is a small force simulation written here rather than
// pulled in as a dependency; each layout only adds a pull of its own.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EVENT_KIND_LABEL, FIRM_KIND_LABEL, LINK_KIND_LABEL,
  type AidenEvent, type AidenPlace, type AidenSnapshot,
} from '@/lib/aiden-types';
import { outlines, project } from '@/lib/aiden-geo';
import { AidenLockedError, aidenFetch, type AidenIndex, type UseAidenData } from './useAidenData';
import type { AidenNav, Selection } from './aiden-nav';
import {
  Empty, FIRM_COLOR, INVESTED_COLOR, KIND_COLOR, LINK_COLOR, PLACE_COLOR, SearchBox, WARMTH_COLOR,
  ago, btnGhost, btnPrimary, fmtDay, inputCls,
} from './aiden-ui';

export type Layout = 'free' | 'map' | 'rings' | 'clusters' | 'timeline';
type ClusterBy = 'firm' | 'place';

type NodeType = 'me' | 'person' | 'firm' | 'place' | 'event';
type EdgeKind = 'me' | 'firm' | 'place' | 'tie' | 'event';

interface NodeDef {
  id: string;
  type: NodeType;
  refId: string;
  label: string;
  sub: string;
  color: string;
  r: number;
}

interface EdgeDef {
  a: string;
  b: string;
  kind: EdgeKind;
  color: string;
  len: number;
  pull: number;
  width: number;
  opacity: number;
  dash?: string;
  title?: string;
}

interface Graph {
  nodes: NodeDef[];
  edges: EdgeDef[];
  near: Map<string, Set<string>>;
}

interface Show {
  me: boolean;
  firms: boolean;
  places: boolean;
  events: boolean;
  ties: boolean;
}

const ME = 'me';
const ME_COLOR = '#fafafa';

// What each layout shows to begin with. Any of it can be toggled after.
const DEFAULT_SHOW: Record<Layout, Show> = {
  free: { me: true, firms: true, places: true, events: true, ties: true },
  // On the map everyone is understood to connect to you.
  map: { me: false, firms: true, places: true, events: true, ties: true },
  rings: { me: true, firms: true, places: false, events: true, ties: true },
  clusters: { me: false, firms: true, places: false, events: true, ties: true },
  timeline: { me: false, firms: true, places: false, events: true, ties: true },
};

function buildGraph(data: AidenSnapshot, index: AidenIndex, show: Show): Graph {
  const nodes: NodeDef[] = [];
  const edges: EdgeDef[] = [];
  const have = new Set<string>();
  const push = (n: NodeDef) => { nodes.push(n); have.add(n.id); };

  if (show.me) {
    push({ id: ME, type: 'me', refId: '', label: 'You', sub: '', color: ME_COLOR, r: 13 });
  }

  if (show.places) {
    for (const p of data.places) {
      push({ id: `place:${p.id}`, type: 'place', refId: p.id, label: p.name, sub: 'Place', color: PLACE_COLOR, r: 9 });
    }
  }

  if (show.firms) {
    for (const f of data.firms) {
      const staff = data.people.filter((p) => p.firmId === f.id).length;
      push({
        id: `firm:${f.id}`, type: 'firm', refId: f.id, label: f.name,
        sub: `${FIRM_KIND_LABEL[f.kind]}, ${staff} ${staff === 1 ? 'person' : 'people'}`,
        color: FIRM_COLOR, r: 8 + Math.min(6, staff),
      });
      if (f.placeId && have.has(`place:${f.placeId}`)) {
        edges.push({
          a: `firm:${f.id}`, b: `place:${f.placeId}`, kind: 'place', color: PLACE_COLOR,
          len: 110, pull: 0.12, width: 1, opacity: 0.3,
        });
      }
    }
  }

  for (const p of data.people) {
    const touches = index.eventsOf.get(p.id)?.length ?? 0;
    const last = index.lastTouch.get(p.id);
    const firm = p.firmId ? index.firm.get(p.firmId) : undefined;
    const invested = index.invested.has(p.id);
    const id = `person:${p.id}`;
    push({
      id, type: 'person', refId: p.id, label: p.name,
      sub: [
        [p.title, firm?.name].filter(Boolean).join(' at '),
        invested ? 'invested' : p.warmth,
        touches ? `${touches} ${touches === 1 ? 'touch' : 'touches'}, last ${ago(last)}` : 'never contacted',
      ].filter(Boolean).join('. '),
      color: invested ? INVESTED_COLOR : WARMTH_COLOR[p.warmth], r: 5.5 + Math.min(6, touches * 0.9),
    });

    const inFirm = Boolean(p.firmId && have.has(`firm:${p.firmId}`));
    if (inFirm) {
      edges.push({
        a: id, b: `firm:${p.firmId}`, kind: 'firm', color: FIRM_COLOR,
        len: 62, pull: 0.4, width: 1.2, opacity: 0.5,
      });
    }
    // Someone whose firm already sits in their place reaches it through the
    // firm; a second line to the same place would only be clutter.
    if (p.placeId && have.has(`place:${p.placeId}`) && !(inFirm && firm?.placeId === p.placeId)) {
      edges.push({
        a: id, b: `place:${p.placeId}`, kind: 'place', color: PLACE_COLOR,
        len: 100, pull: 0.1, width: 1, opacity: 0.25,
      });
    }
    if (show.me && touches > 0) {
      edges.push({
        a: ME, b: id, kind: 'me', color: ME_COLOR,
        len: 150, pull: 0.05, width: Math.min(3, 0.6 + touches * 0.3), opacity: 0.1,
        title: `${touches} ${touches === 1 ? 'touch' : 'touches'}`,
      });
    }
  }

  if (show.ties) {
    for (const l of data.links) {
      const a = `person:${l.aId}`;
      const b = `person:${l.bId}`;
      if (!have.has(a) || !have.has(b)) continue;
      edges.push({
        a, b, kind: 'tie', color: LINK_COLOR[l.kind], len: 80, pull: 0.3, width: 1.7, opacity: 0.85,
        title: `${LINK_KIND_LABEL[l.kind]}${l.note ? `: ${l.note}` : ''}`,
      });
    }
  }

  if (show.events) {
    for (const e of data.events) {
      const people = e.people.filter((ep) => have.has(`person:${ep.personId}`));
      if (people.length < 2) continue;
      const id = `event:${e.id}`;
      const color = KIND_COLOR[e.kind];
      push({
        id, type: 'event', refId: e.id, label: e.title || EVENT_KIND_LABEL[e.kind],
        sub: `${EVENT_KIND_LABEL[e.kind]}, ${fmtDay(e.happenedAt)}, ${people.length} people`,
        color, r: 4.5,
      });
      for (const ep of people) {
        edges.push({
          a: id, b: `person:${ep.personId}`, kind: 'event', color, len: 55, pull: 0.25,
          width: ep.role === 'host' ? 1.8 : 1, opacity: 0.45, dash: ep.role === 'host' ? undefined : '3 3',
          title: ep.role === 'host' ? 'Host' : undefined,
        });
      }
      if (e.placeId && have.has(`place:${e.placeId}`)) {
        edges.push({
          a: id, b: `place:${e.placeId}`, kind: 'place', color: PLACE_COLOR,
          len: 100, pull: 0.08, width: 1, opacity: 0.2,
        });
      }
    }
  }

  const near = new Map<string, Set<string>>();
  for (const n of nodes) near.set(n.id, new Set());
  for (const e of edges) {
    near.get(e.a)?.add(e.b);
    near.get(e.b)?.add(e.a);
  }
  return { nodes, edges, near };
}

// ── What each layout adds to the forces ───────────────────────────────────────
interface Anchor { x: number; y: number; pull: number; keep: number }

interface Plan {
  /** Pulled toward a point, once further from it than `keep`. */
  anchor: Map<string, Anchor>;
  /** Held at a distance from the origin. */
  radial: Map<string, { r: number; pull: number }>;
  /** Held at an x. */
  lockX: Map<string, number>;
  /** Held exactly here. */
  pin: Map<string, { x: number; y: number }>;
  /** The pull back toward the origin, per axis. */
  center: { x: number; y: number };
  /** What is drawn beneath the web. */
  under:
    | { kind: 'none' }
    | { kind: 'map'; nowhere: { x: number; y: number } | null }
    | { kind: 'rings'; rings: { r: number; label: string; color: string }[] }
    | { kind: 'axis'; ticks: { x: number; label: string }[]; today: number; never: number | null }
    | { kind: 'groups'; labels: { x: number; y: number; label: string }[] };
}

const RING: Record<'invested' | 'hot' | 'warm' | 'cold', number> = { invested: 130, hot: 240, warm: 360, cold: 490 };
const SPAN = 1700; // the timeline, left to right
const DAY = 86_400_000;

function planLayout(
  layout: Layout,
  graph: Graph,
  data: AidenSnapshot,
  index: AidenIndex,
  clusterBy: ClusterBy,
): Plan {
  const plan: Plan = {
    anchor: new Map(), radial: new Map(), lockX: new Map(), pin: new Map(),
    center: { x: 0.035, y: 0.035 }, under: { kind: 'none' },
  };
  const has = (id: string) => graph.near.has(id);

  if (layout === 'map') {
    plan.center = { x: 0, y: 0 };
    const at = new Map<string, { x: number; y: number }>();
    let minX = Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const pl of data.places) {
      if (pl.lat === null || pl.lng === null) continue;
      const pt = project(pl.lat, pl.lng);
      at.set(pl.id, pt);
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    // Whatever has no place on the earth gathers off to the left of it.
    const nowhere = at.size ? { x: minX - 320, y: (minY + maxY) / 2 } : { x: 0, y: 0 };
    plan.under = { kind: 'map', nowhere };

    for (const pl of data.places) {
      const id = `place:${pl.id}`;
      if (!has(id)) continue;
      const pt = at.get(pl.id);
      if (pt) plan.pin.set(id, pt);
      else plan.anchor.set(id, { ...nowhere, pull: 0.05, keep: 30 });
    }
    for (const f of data.firms) {
      const id = `firm:${f.id}`;
      if (!has(id)) continue;
      const pt = f.placeId ? at.get(f.placeId) : undefined;
      plan.anchor.set(id, pt ? { ...pt, pull: 0.1, keep: 18 } : { ...nowhere, pull: 0.05, keep: 30 });
    }
    for (const p of data.people) {
      const id = `person:${p.id}`;
      if (!has(id)) continue;
      const placeId = p.placeId ?? (p.firmId ? index.firm.get(p.firmId)?.placeId : null);
      const pt = placeId ? at.get(placeId) : undefined;
      plan.anchor.set(id, pt ? { ...pt, pull: 0.08, keep: 22 } : { ...nowhere, pull: 0.05, keep: 30 });
    }
    if (has(ME)) plan.anchor.set(ME, { ...nowhere, pull: 0.05, keep: 0 });
    return plan;
  }

  if (layout === 'rings') {
    plan.center = { x: 0, y: 0 };
    plan.under = {
      kind: 'rings',
      rings: [
        { r: RING.invested, label: 'invested', color: INVESTED_COLOR },
        { r: RING.hot, label: 'hot', color: WARMTH_COLOR.hot },
        { r: RING.warm, label: 'warm', color: WARMTH_COLOR.warm },
        { r: RING.cold, label: 'cold', color: WARMTH_COLOR.cold },
      ],
    };
    if (has(ME)) plan.pin.set(ME, { x: 0, y: 0 });
    const ringOf = new Map<string, number>();
    for (const p of data.people) {
      const r = RING[index.invested.has(p.id) ? 'invested' : p.warmth];
      ringOf.set(p.id, r);
      if (has(`person:${p.id}`)) plan.radial.set(`person:${p.id}`, { r, pull: 0.12 });
    }
    for (const f of data.firms) {
      const id = `firm:${f.id}`;
      if (!has(id)) continue;
      const staff = data.people.filter((p) => p.firmId === f.id).map((p) => ringOf.get(p.id) ?? RING.cold);
      const r = staff.length ? staff.reduce((a, b) => a + b, 0) / staff.length : RING.cold + 80;
      plan.radial.set(id, { r, pull: 0.06 });
    }
    for (const pl of data.places) {
      if (has(`place:${pl.id}`)) plan.radial.set(`place:${pl.id}`, { r: RING.cold + 140, pull: 0.05 });
    }
    return plan;
  }

  if (layout === 'clusters') {
    plan.center = { x: 0, y: 0 };
    // One group per firm (or place), the biggest first, on a grid.
    type Group = { key: string; label: string; center?: string; members: string[] };
    const groups = new Map<string, Group>();
    const grab = (key: string, label: string, center?: string) => {
      let g = groups.get(key);
      if (!g) { g = { key, label, center, members: [] }; groups.set(key, g); }
      return g;
    };
    if (clusterBy === 'firm') {
      for (const f of data.firms) if (has(`firm:${f.id}`)) grab(f.id, f.name, `firm:${f.id}`);
      for (const p of data.people) {
        if (!has(`person:${p.id}`)) continue;
        const f = p.firmId ? index.firm.get(p.firmId) : undefined;
        (f ? grab(f.id, f.name, `firm:${f.id}`) : grab('none', 'No firm')).members.push(`person:${p.id}`);
      }
      for (const pl of data.places) if (has(`place:${pl.id}`)) grab('places', 'Places').members.push(`place:${pl.id}`);
    } else {
      for (const pl of data.places) if (has(`place:${pl.id}`)) grab(pl.id, pl.name, `place:${pl.id}`);
      for (const f of data.firms) {
        if (!has(`firm:${f.id}`)) continue;
        const pl = f.placeId ? index.place.get(f.placeId) : undefined;
        (pl ? grab(pl.id, pl.name, `place:${pl.id}`) : grab('none', 'No place')).members.push(`firm:${f.id}`);
      }
      for (const p of data.people) {
        if (!has(`person:${p.id}`)) continue;
        const placeId = p.placeId ?? (p.firmId ? index.firm.get(p.firmId)?.placeId : null);
        const pl = placeId ? index.place.get(placeId) : undefined;
        (pl ? grab(pl.id, pl.name, `place:${pl.id}`) : grab('none', 'No place')).members.push(`person:${p.id}`);
      }
    }
    const list = [...groups.values()].filter((g) => g.members.length || g.center);
    list.sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    const labels: { x: number; y: number; label: string }[] = [];
    list.forEach((g, i) => {
      const size = 150 + 22 * Math.sqrt(g.members.length);
      const cx = ((i % cols) - (cols - 1) / 2) * 300;
      const cy = (Math.floor(i / cols) - (Math.ceil(list.length / cols) - 1) / 2) * 300;
      if (g.center) plan.anchor.set(g.center, { x: cx, y: cy, pull: 0.3, keep: 0 });
      else labels.push({ x: cx, y: cy - size / 2, label: g.label });
      for (const m of g.members) plan.anchor.set(m, { x: cx, y: cy, pull: 0.1, keep: 0 });
    });
    if (has(ME)) plan.anchor.set(ME, { x: 0, y: -(Math.ceil(list.length / cols) / 2) * 300 - 200, pull: 0.2, keep: 0 });
    plan.under = { kind: 'groups', labels };
    return plan;
  }

  if (layout === 'timeline') {
    plan.center = { x: 0, y: 0.03 };
    const now = Date.now();
    let first = now;
    for (const e of data.events) {
      const t = new Date(e.happenedAt).getTime();
      if (t < first) first = t;
    }
    first = Math.min(first, now - 90 * DAY);
    const xOf = (t: number) => ((t - first) / (now - first)) * SPAN - SPAN / 2;
    const never = -SPAN / 2 - 220;

    const xPerson = new Map<string, number>();
    let anyNever = false;
    for (const p of data.people) {
      const last = index.lastTouch.get(p.id);
      const x = last ? xOf(new Date(last).getTime()) : never;
      if (!last) anyNever = true;
      xPerson.set(p.id, x);
      if (has(`person:${p.id}`)) plan.lockX.set(`person:${p.id}`, x);
    }
    for (const f of data.firms) {
      const id = `firm:${f.id}`;
      if (!has(id)) continue;
      const xs = data.people.filter((p) => p.firmId === f.id).map((p) => xPerson.get(p.id) ?? never);
      plan.lockX.set(id, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : never);
    }
    for (const e of data.events) {
      const id = `event:${e.id}`;
      if (has(id)) plan.lockX.set(id, xOf(new Date(e.happenedAt).getTime()));
    }
    for (const pl of data.places) {
      if (has(`place:${pl.id}`)) plan.lockX.set(`place:${pl.id}`, never);
    }
    if (has(ME)) plan.lockX.set(ME, SPAN / 2 + 120);

    // A tick at the first of each month, thinned out when there are many.
    const ticks: { x: number; label: string }[] = [];
    const d = new Date(first);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + 1);
    const months = (now - first) / (30 * DAY);
    const step = months > 36 ? 6 : months > 15 ? 3 : 1;
    while (d.getTime() < now) {
      if (d.getMonth() % step === 0) {
        ticks.push({
          x: xOf(d.getTime()),
          label: d.toLocaleDateString(undefined, { month: 'short', ...(d.getMonth() === 0 || step > 1 ? { year: '2-digit' } : {}) }),
        });
      }
      d.setMonth(d.getMonth() + 1);
    }
    plan.under = { kind: 'axis', ticks, today: SPAN / 2, never: anyNever ? never : null };
    return plan;
  }

  return plan;
}

// ── The simulation ────────────────────────────────────────────────────────────
interface Pt { x: number; y: number; vx: number; vy: number }

interface Sim {
  pts: Map<string, Pt>;
  graph: Graph;
  plan: Plan;
  alpha: number;
  raf: number | null;
  dragging: string | null;
}

const PUSH = -420;        // how hard everything shoves everything else away
const PUSH_REACH = 520;   // and how far that carries
const DRAG = 0.58;        // how much speed survives a tick
const COOL = 0.022;       // how fast it settles
const REST = 0.006;       // below this it has settled

function tick(sim: Sim): void {
  const { pts, graph, plan } = sim;
  sim.alpha += (0 - sim.alpha) * COOL;
  const a = sim.alpha;

  for (const e of graph.edges) {
    const p = pts.get(e.a);
    const q = pts.get(e.b);
    if (!p || !q) continue;
    let dx = q.x + q.vx - p.x - p.vx;
    let dy = q.y + q.vy - p.y - p.vy;
    const l = Math.hypot(dx, dy) || 0.001;
    const k = ((l - e.len) / l) * a * e.pull;
    dx *= k;
    dy *= k;
    // The busier end moves less, so a firm isn't dragged around by each hire.
    const da = graph.near.get(e.a)?.size ?? 1;
    const db = graph.near.get(e.b)?.size ?? 1;
    const bias = da / (da + db);
    q.vx -= dx * bias;
    q.vy -= dy * bias;
    p.vx += dx * (1 - bias);
    p.vy += dy * (1 - bias);
  }

  const list = graph.nodes;
  for (let i = 0; i < list.length; i++) {
    const p = pts.get(list[i].id);
    if (!p) continue;
    for (let j = i + 1; j < list.length; j++) {
      const q = pts.get(list[j].id);
      if (!q) continue;
      let dx = q.x - p.x;
      let dy = q.y - p.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        // Two nodes on the same spot have no direction to part in; give one.
        dx = (Math.random() - 0.5) * 2;
        dy = (Math.random() - 0.5) * 2;
        d2 = dx * dx + dy * dy;
      }
      if (d2 > PUSH_REACH * PUSH_REACH) continue;
      const f = (PUSH * a) / d2;
      p.vx += dx * f;
      p.vy += dy * f;
      q.vx -= dx * f;
      q.vy -= dy * f;

      // And never on top of each other.
      const gap = list[i].r + list[j].r + 10;
      if (d2 < gap * gap) {
        const d = Math.sqrt(d2);
        const shove = ((gap - d) / d) * 0.5 * Math.min(1, a * 3 + 0.2);
        p.vx -= dx * shove * 0.5;
        p.vy -= dy * shove * 0.5;
        q.vx += dx * shove * 0.5;
        q.vy += dy * shove * 0.5;
      }
    }
  }

  for (const n of list) {
    const p = pts.get(n.id);
    if (!p) continue;
    if (sim.dragging === n.id) {
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    const pin = plan.pin.get(n.id);
    if (pin) {
      p.x = pin.x;
      p.y = pin.y;
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    const anchor = plan.anchor.get(n.id);
    if (anchor) {
      const dx = anchor.x - p.x;
      const dy = anchor.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > anchor.keep) {
        const k = ((d - anchor.keep) / d) * anchor.pull * a;
        p.vx += dx * k;
        p.vy += dy * k;
      }
    }
    const radial = plan.radial.get(n.id);
    if (radial) {
      const r = Math.hypot(p.x, p.y) || 1;
      const k = ((radial.r - r) / r) * radial.pull * a;
      p.vx += p.x * k;
      p.vy += p.y * k;
    }
    const lockX = plan.lockX.get(n.id);
    if (lockX !== undefined) p.vx += (lockX - p.x) * 0.5 * Math.max(a, 0.05);

    const pull = n.type === 'me' ? 4 : 1;
    p.vx -= p.x * plan.center.x * pull * a;
    p.vy -= p.y * plan.center.y * pull * a;
    p.vx *= DRAG;
    p.vy *= DRAG;
    p.x += p.vx;
    p.y += p.vy;
  }
}

interface View { x: number; y: number; k: number }
type Positions = Map<string, { x: number; y: number }>;

function fitView(layout: Positions, w: number, h: number, maxK = 1.5): View | null {
  if (!layout.size || w < 50 || h < 50) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of layout.values()) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const k = Math.max(0.12, Math.min(maxK, Math.min((w - 140) / (maxX - minX || 1), (h - 140) / (maxY - minY || 1))));
  return { k, x: w / 2 - (k * (minX + maxX)) / 2, y: h / 2 - (k * (minY + maxY)) / 2 };
}

// ── The view ──────────────────────────────────────────────────────────────────
const TOGGLES: { key: keyof Show; label: string; color: string }[] = [
  { key: 'me', label: 'You', color: ME_COLOR },
  { key: 'firms', label: 'Firms', color: FIRM_COLOR },
  { key: 'places', label: 'Places', color: PLACE_COLOR },
  { key: 'events', label: 'Events', color: KIND_COLOR.event },
  { key: 'ties', label: 'Ties', color: LINK_COLOR.friend },
];

export function AidenGraph({
  api, nav, selection, active, layout,
}: {
  api: UseAidenData;
  nav: AidenNav;
  selection: Selection | null;
  active: boolean;
  layout: Layout;
}) {
  // What is shown, per layout: each starts from its own defaults and keeps
  // whatever has been toggled since.
  const [shows, setShows] = useState<Partial<Record<Layout, Show>>>({});
  const show = shows[layout] ?? DEFAULT_SHOW[layout];
  const setShow = (next: Show) => setShows((s) => ({ ...s, [layout]: next }));
  const [clusterBy, setClusterBy] = useState<ClusterBy>('firm');
  const [positions, setPositions] = useState<Positions>(new Map());
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [looking, setLooking] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const graph = useMemo(() => buildGraph(api.data, api.index, show), [api.data, api.index, show]);
  const plan = useMemo(
    () => planLayout(layout, graph, api.data, api.index, clusterBy),
    [api.data, api.index, clusterBy, graph, layout],
  );

  const box = useRef<HTMLDivElement>(null);
  const sim = useRef<Sim>({ pts: new Map(), graph, plan, alpha: 0, raf: null, dragging: null });
  // The view follows the layout until it is touched; after that it is left alone.
  const follow = useRef(true);
  const sizeRef = useRef(size);
  const viewRef = useRef(view);
  const activeRef = useRef(active);
  const layoutRef = useRef(layout);
  const press = useRef<
    | { mode: 'pan'; x: number; y: number; view: View; moved: boolean }
    | { mode: 'node'; id: string; x: number; y: number; moved: boolean }
    | null
  >(null);

  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { viewRef.current = view; }, [view]);

  const publish = useCallback(() => {
    const next: Positions = new Map();
    for (const [id, p] of sim.current.pts) next.set(id, { x: p.x, y: p.y });
    setPositions(next);
    return next;
  }, []);

  const run = useCallback(() => {
    const s = sim.current;
    if (s.raf !== null) return;
    const step = () => {
      s.raf = null;
      if (!activeRef.current) return;
      tick(s);
      const next = publish();
      const settled = s.alpha < REST && !s.dragging;
      if (follow.current) {
        const v = fitView(next, sizeRef.current.w, sizeRef.current.h, layoutRef.current === 'map' ? 3 : 1.5);
        if (v) setView(v);
      }
      if (!settled) s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  }, [publish]);

  // A new layout: the view frames it again, and everything drifts from where
  // it was to where it now goes.
  useEffect(() => {
    layoutRef.current = layout;
    follow.current = true;
    sim.current.alpha = Math.max(sim.current.alpha, 0.8);
    run();
  }, [layout, run]);

  // A changed graph keeps every node it still has where it was, and drops new
  // ones in beside something they are tied to.
  useEffect(() => {
    const s = sim.current;
    s.graph = graph;
    s.plan = plan;
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const id of [...s.pts.keys()]) if (!ids.has(id)) s.pts.delete(id);
    const fresh = s.pts.size === 0;
    graph.nodes.forEach((n, i) => {
      if (s.pts.has(n.id)) return;
      const pin = plan.pin.get(n.id) ?? plan.anchor.get(n.id);
      if (pin) {
        s.pts.set(n.id, { x: pin.x + (Math.random() - 0.5) * 20, y: pin.y + (Math.random() - 0.5) * 20, vx: 0, vy: 0 });
        return;
      }
      if (n.type === 'me') {
        s.pts.set(n.id, { x: 0, y: 0, vx: 0, vy: 0 });
        return;
      }
      let anchor: Pt | undefined;
      for (const other of graph.near.get(n.id) ?? []) {
        anchor = s.pts.get(other);
        if (anchor) break;
      }
      const angle = i * 2.399963; // the golden angle: an even spread, no two alike
      const reach = anchor ? 40 : 60 + 14 * Math.sqrt(i + 1);
      s.pts.set(n.id, {
        x: (anchor?.x ?? 0) + Math.cos(angle) * reach,
        y: (anchor?.y ?? 0) + Math.sin(angle) * reach,
        vx: 0,
        vy: 0,
      });
    });
    s.alpha = Math.max(s.alpha, fresh ? 1 : 0.5);
    run();
  }, [graph, plan, run]);

  // Off-tab the section is display:none. Nothing is simulated there, and it
  // picks up where it was on the way back.
  useEffect(() => {
    activeRef.current = active;
    if (active && sim.current.alpha >= REST) run();
  }, [active, run]);

  useEffect(() => {
    const s = sim.current;
    return () => {
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      s.raf = null;
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The first time there is room to draw in, frame what is there.
  useEffect(() => {
    if (!follow.current || size.w < 50) return;
    const v = fitView(positions, size.w, size.h, layout === 'map' ? 3 : 1.5);
    if (v) setView(v);
    // Only the box changing size should re-frame; the layout does its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  // Zoom, about the cursor. A listener of our own because React's wheel
  // handler is passive and the page would scroll underneath.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      follow.current = false;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.max(0.08, Math.min(6, v.k * Math.exp(-e.deltaY * 0.0015)));
        const f = k / v.k;
        return { k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── The map's lookups: places with no point yet are found once ───────────
  const lookUp = useCallback(async (places: AidenPlace[]) => {
    setLookupError(null);
    for (const place of places) {
      setLooking(place.name);
      try {
        await aidenFetch('/api/aiden/geocode', { method: 'POST', body: JSON.stringify({ placeId: place.id }) });
      } catch (e) {
        if (e instanceof AidenLockedError) break;
        setLookupError(e instanceof Error ? e.message : 'lookup failed');
        break;
      }
    }
    setLooking(null);
    await api.reload();
  }, [api]);

  const unplaced = useMemo(
    () => api.data.places.filter((p) => p.lat === null || p.lng === null),
    [api.data.places],
  );
  const lookedOnce = useRef(false);
  useEffect(() => {
    if (layout !== 'map' || !active || lookedOnce.current) return;
    const fresh = api.data.places.filter((p) => (p.lat === null || p.lng === null) && p.geoStatus === '');
    if (!fresh.length) return;
    lookedOnce.current = true;
    void lookUp(fresh);
  }, [active, api.data.places, layout, lookUp]);

  // ── Pointer ──────────────────────────────────────────────────────────────
  function toWorld(clientX: number, clientY: number) {
    const r = box.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.k, y: (clientY - (r?.top ?? 0) - v.y) / v.k };
  }

  function onNodeDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    box.current?.setPointerCapture(e.pointerId);
    press.current = { mode: 'node', id, x: e.clientX, y: e.clientY, moved: false };
  }

  function onBoxDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    box.current?.setPointerCapture(e.pointerId);
    press.current = { mode: 'pan', x: e.clientX, y: e.clientY, view: viewRef.current, moved: false };
  }

  function onMove(e: React.PointerEvent) {
    const p = press.current;
    if (!p) return;
    const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4;
    if (!p.moved && !far) return;
    p.moved = true;
    if (p.mode === 'pan') {
      follow.current = false;
      setView({ ...p.view, x: p.view.x + e.clientX - p.x, y: p.view.y + e.clientY - p.y });
      return;
    }
    const s = sim.current;
    const pt = s.pts.get(p.id);
    if (!pt) return;
    const w = toWorld(e.clientX, e.clientY);
    pt.x = w.x;
    pt.y = w.y;
    s.dragging = p.id;
    s.alpha = Math.max(s.alpha, 0.3);
    follow.current = false;
    run();
  }

  function openNode(n: NodeDef) {
    if (n.type === 'person' || n.type === 'firm' || n.type === 'place') {
      nav.select({ type: n.type, id: n.refId });
    } else if (n.type === 'event') {
      const ev: AidenEvent | undefined = api.data.events.find((x) => x.id === n.refId);
      if (ev) nav.open({ kind: 'event', initial: ev });
    }
  }

  function onUp(e: React.PointerEvent) {
    const p = press.current;
    press.current = null;
    if (box.current?.hasPointerCapture(e.pointerId)) box.current.releasePointerCapture(e.pointerId);
    sim.current.dragging = null;
    if (!p) return;
    if (p.mode === 'node' && !p.moved) {
      const n = graph.nodes.find((x) => x.id === p.id);
      if (n) openNode(n);
    } else if (p.mode === 'pan' && !p.moved) {
      nav.select(null);
    }
  }

  function refit() {
    follow.current = true;
    const v = fitView(positions, size.w, size.h, layout === 'map' ? 3 : 1.5);
    if (v) setView(v);
  }

  function shake() {
    follow.current = true;
    sim.current.alpha = 1;
    run();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  const needle = q.trim().toLowerCase();
  const found = useMemo(
    () => (needle ? new Set(graph.nodes.filter((n) => n.label.toLowerCase().includes(needle)).map((n) => n.id)) : null),
    [graph.nodes, needle],
  );

  function jumpToFound() {
    if (!found?.size) return;
    const first = positions.get([...found][0]);
    if (!first) return;
    follow.current = false;
    const k = Math.max(view.k, 1.1);
    setView({ k, x: size.w / 2 - first.x * k, y: size.h / 2 - first.y * k });
  }

  const selectedId = selection ? `${selection.type}:${selection.id}` : null;
  const focus = hover ?? selectedId;
  const lit = focus && graph.near.has(focus) ? graph.near.get(focus)! : null;
  const isLit = (id: string) => {
    if (found) return found.has(id);
    if (!focus || !lit) return true;
    return id === focus || lit.has(id);
  };
  const dense = graph.nodes.length > 140;
  const hovered = hover ? graph.nodes.find((n) => n.id === hover) : undefined;
  const hoveredAt = hover ? positions.get(hover) : undefined;
  // Text and thin lines keep their size on screen as the view zooms.
  const inv = 1 / Math.max(0.6, view.k);
  const under = plan.under;
  const ground = under.kind === 'map' ? outlines() : null;

  if (!api.data.people.length && !api.data.firms.length) {
    return (
      <Empty
        title="Nothing to draw yet"
        body="Add some people and firms, connect them, and log events. The web draws itself from the log."
        action={<button onClick={() => nav.open({ kind: 'person' })} className={btnPrimary}>Add a person</button>}
      />
    );
  }

  return (
    <div className="relative h-full min-h-[480px] overflow-hidden rounded-lg border border-zinc-800 bg-[#0b0b0b]">
      <div
        ref={box}
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onBoxDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <svg width="100%" height="100%" className="block">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {/* what lies beneath */}
            {ground && (
              <g className="pointer-events-none">
                <path d={ground.world} fill="#151517" stroke="#2c2c31" strokeWidth={1.2 * inv} strokeLinejoin="round" />
                <path d={ground.states} fill="none" stroke="#232327" strokeWidth={0.8 * inv} strokeLinejoin="round" />
                {under.kind === 'map' && under.nowhere && (
                  <text x={under.nowhere.x} y={under.nowhere.y - 70} textAnchor="middle" fontSize={12 * inv} fill="#52525b">
                    no place
                  </text>
                )}
              </g>
            )}
            {under.kind === 'rings' && (
              <g className="pointer-events-none">
                {under.rings.map((r) => (
                  <g key={r.label}>
                    <circle r={r.r} fill="none" stroke={r.color} strokeWidth={1 * inv} opacity={0.25} strokeDasharray={`${4 * inv} ${6 * inv}`} />
                    <text x={0} y={-r.r - 6 * inv} textAnchor="middle" fontSize={11 * inv} fill={r.color} opacity={0.7}>{r.label}</text>
                  </g>
                ))}
              </g>
            )}
            {under.kind === 'axis' && (
              <g className="pointer-events-none">
                <line x1={-SPAN / 2 - 80} x2={SPAN / 2 + 60} y1={0} y2={0} stroke="#27272a" strokeWidth={1 * inv} />
                {under.ticks.map((t) => (
                  <g key={t.x}>
                    <line x1={t.x} x2={t.x} y1={-2000} y2={2000} stroke="#1c1c20" strokeWidth={1 * inv} />
                    <text x={t.x + 4 * inv} y={-8 * inv} fontSize={11 * inv} fill="#71717a">{t.label}</text>
                  </g>
                ))}
                <line x1={under.today} x2={under.today} y1={-2000} y2={2000} stroke="#e4e4e7" strokeWidth={1 * inv} strokeDasharray={`${3 * inv} ${3 * inv}`} opacity={0.5} />
                <text x={under.today + 4 * inv} y={-8 * inv} fontSize={11 * inv} fill="#e4e4e7" opacity={0.7}>today</text>
                {under.never !== null && (
                  <text x={under.never} y={-8 * inv} textAnchor="middle" fontSize={11 * inv} fill="#71717a">never contacted</text>
                )}
              </g>
            )}
            {under.kind === 'groups' && (
              <g className="pointer-events-none">
                {under.labels.map((l) => (
                  <text key={l.label} x={l.x} y={l.y} textAnchor="middle" fontSize={12 * inv} fill="#52525b">{l.label}</text>
                ))}
              </g>
            )}

            {graph.edges.map((e, i) => {
              const p = positions.get(e.a);
              const t = positions.get(e.b);
              if (!p || !t) return null;
              const on = found
                ? found.has(e.a) && found.has(e.b)
                : !focus || e.a === focus || e.b === focus;
              return (
                <line
                  key={i}
                  x1={p.x} y1={p.y} x2={t.x} y2={t.y}
                  stroke={e.color}
                  strokeWidth={e.width / Math.sqrt(view.k)}
                  strokeDasharray={e.dash}
                  strokeLinecap="round"
                  opacity={on ? (focus && !found ? Math.min(1, e.opacity * 2.2) : e.opacity) : e.opacity * 0.12}
                >
                  {e.title && <title>{e.title}</title>}
                </line>
              );
            })}

            {graph.nodes.map((n) => {
              const p = positions.get(n.id);
              if (!p) return null;
              const on = isLit(n.id);
              const chosen = n.id === selectedId;
              const label =
                !dense || view.k > 1 || n.type === 'firm' || n.type === 'place' || n.type === 'me'
                || n.id === focus || Boolean(lit?.has(n.id) && focus) || Boolean(found?.has(n.id));
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={on ? 1 : 0.14}
                  className="cursor-pointer"
                  onPointerDown={(e) => onNodeDown(e, n.id)}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                >
                  {chosen && <circle r={n.r + 6} fill="none" stroke="#ffffff" strokeWidth={1.5 / view.k} opacity={0.9} />}
                  {n.type === 'firm' && (
                    <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={3} fill={n.color} stroke="#0b0b0b" strokeWidth={1.5} />
                  )}
                  {n.type === 'place' && (
                    <rect
                      x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={2}
                      transform="rotate(45)" fill={n.color} stroke="#0b0b0b" strokeWidth={1.5}
                    />
                  )}
                  {(n.type === 'person' || n.type === 'event' || n.type === 'me') && (
                    <circle
                      r={n.r}
                      fill={n.type === 'event' ? '#0b0b0b' : n.color}
                      stroke={n.type === 'event' ? n.color : '#0b0b0b'}
                      strokeWidth={n.type === 'event' ? 1.6 : 1.5}
                    />
                  )}
                  {label && n.type !== 'event' && (
                    <text
                      y={n.r + (n.type === 'place' ? 16 : 12) * inv + 2}
                      textAnchor="middle"
                      fontSize={(n.type === 'person' ? 10.5 : 11.5) * inv}
                      fontWeight={n.type === 'person' ? 400 : 600}
                      fill={n.type === 'person' ? '#d4d4d8' : n.color}
                      stroke="#0b0b0b"
                      strokeWidth={3 * inv}
                      paintOrder="stroke"
                      className="pointer-events-none"
                    >
                      {n.label.length > 26 ? `${n.label.slice(0, 25)}...` : n.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {hovered && hoveredAt && hovered.type !== 'me' && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-zinc-800 bg-[#161616]/95 px-2.5 py-1.5 shadow-xl backdrop-blur"
          style={{
            left: Math.min(Math.max(8, hoveredAt.x * view.k + view.x + 14), Math.max(8, size.w - 270)),
            top: Math.max(8, hoveredAt.y * view.k + view.y - 14 - hovered.r * view.k - 44),
          }}
        >
          <p className="truncate text-[12px] font-medium text-white">{hovered.label}</p>
          {hovered.sub && <p className="text-[10.5px] leading-snug text-zinc-500">{hovered.sub}</p>}
        </div>
      )}

      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5">
        <div
          onKeyDown={(e) => { if (e.key === 'Enter') jumpToFound(); }}
          className="rounded-md bg-[#0b0b0b]/90 backdrop-blur"
        >
          <SearchBox value={q} onChange={setQ} placeholder="Find in the web" />
        </div>
        {TOGGLES.map((t) => {
          const on = show[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setShow({ ...show, [t.key]: !show[t.key] })}
              className="flex items-center gap-1.5 rounded-full border bg-[#0b0b0b]/90 px-2.5 py-1 text-[11px] font-medium backdrop-blur transition-colors"
              style={on ? { color: '#e4e4e7', borderColor: '#3f3f46' } : { color: '#52525b', borderColor: '#27272a' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: on ? t.color : '#3f3f46' }} />
              {t.label}
            </button>
          );
        })}
        {layout === 'clusters' && (
          <select
            value={clusterBy}
            onChange={(e) => setClusterBy(e.target.value as ClusterBy)}
            className={`${inputCls} w-auto bg-[#0b0b0b]/90 py-1 pr-7 text-[11px] backdrop-blur`}
          >
            <option value="firm">By firm</option>
            <option value="place">By place</option>
          </select>
        )}
      </div>

      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <div className="flex gap-1.5">
          <button type="button" onClick={refit} className={`${btnGhost} bg-[#0b0b0b]/90 backdrop-blur`}>Fit</button>
          <button type="button" onClick={shake} className={`${btnGhost} bg-[#0b0b0b]/90 backdrop-blur`}>Re-lay</button>
        </div>
        {layout === 'map' && (unplaced.length > 0 || looking || lookupError) && (
          <div className="w-[260px] rounded-md border border-zinc-800 bg-[#0b0b0b]/90 px-3 py-2 text-[11px] backdrop-blur">
            {looking ? (
              <p className="flex items-center gap-2 text-zinc-300">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
                Finding {looking}...
              </p>
            ) : (
              <>
                <p className="text-zinc-400">
                  {unplaced.length} {unplaced.length === 1 ? 'place is' : 'places are'} not on the map yet
                </p>
                <p className="mt-1 truncate text-zinc-600">{unplaced.map((p) => p.name).join(', ')}</p>
                <p className="mt-1.5 text-zinc-600">
                  Not found by name? Edit the place and say what to look it up as.
                </p>
                <button type="button" onClick={() => void lookUp(unplaced)} className={`${btnGhost} mt-2`}>
                  Look them up
                </button>
              </>
            )}
            {lookupError && <p className="mt-1.5 text-red-300">{lookupError}</p>}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[#0b0b0b]/85 px-2.5 py-1.5 text-[10.5px] text-zinc-500 backdrop-blur">
        {(['cold', 'warm', 'hot'] as const).map((w) => (
          <span key={w} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: WARMTH_COLOR[w] }} />
            {w}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: INVESTED_COLOR }} />
          invested
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: FIRM_COLOR }} />
          firm
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rotate-45" style={{ backgroundColor: PLACE_COLOR }} />
          place
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border" style={{ borderColor: KIND_COLOR.event }} />
          shared event
        </span>
        <span className="text-zinc-700">
          {graph.nodes.length} nodes, {graph.edges.length} lines
        </span>
      </div>
    </div>
  );
}
