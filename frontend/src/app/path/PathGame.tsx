'use client';

// PATH
//
// Balls of colour roll down a road. Drop towers beside it to pop them before
// they reach the end. Every pop pays a little gold; every wave sent pays more.
// Spend it on towers and on their upgrades: two lines each, one can go to the
// top and the other then stops at its first step. Forty waves to hold the
// road; after that, freeplay for as long as you last.
//
// One canvas and a few buttons, meant for a phone held upright.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  H, KINDS, LAST_WAVE, MAPS, ROAD, TARGETS, TOWERS, TOWER_KEYS, TOWER_R, W,
  canPlace, canUpgrade, newWorld, waveGroups, place, sell, sellValue, sendWave, statsOf, step, track, upgrade, waveRunning,
  type MapDef, type Target, type Tower, type TowerKey, type World,
} from './engine';

// ── Save ───────────────────────────────────────────────────────────────────

interface RunSave {
  map: string; gold: number; lives: number; wave: number; paidWave: number; freeplay: boolean;
  towers: { key: TowerKey; x: number; y: number; lv: [number, number]; spent: number; target: Target }[];
}
interface Save { best: Record<string, number>; run: RunSave | null }
const SAVE_KEY = 'path.v1';
function loadSave(): Save {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as Partial<Save> | null;
    return { best: s?.best ?? {}, run: s?.run ?? null };
  } catch { return { best: {}, run: null }; }
}
function storeSave(s: Save) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* private mode */ } }

function snapshot(w: World): RunSave {
  return {
    map: w.map.id, gold: Math.floor(w.gold), lives: w.lives, wave: w.wave, paidWave: w.paidWave, freeplay: w.freeplay,
    towers: w.towers.map((t) => ({ key: t.key, x: t.x, y: t.y, lv: t.lv, spent: t.spent, target: t.target })),
  };
}
function restore(r: RunSave): World | null {
  const map = MAPS.find((m) => m.id === r.map);
  if (!map) return null;
  const w = newWorld(map);
  Object.assign(w, { gold: r.gold, lives: r.lives, wave: r.wave, paidWave: r.paidWave, freeplay: r.freeplay, bestCleared: r.wave });
  for (const t of r.towers) {
    w.towers.push({ id: w.nextId++, key: t.key, x: t.x, y: t.y, lv: t.lv, spent: t.spent, target: t.target, cd: 0, aim: -Math.PI / 2, stats: statsOf(t.key, t.lv), pops: 0 });
  }
  return w;
}

// ── Drawing ────────────────────────────────────────────────────────────────

const FONT = '-apple-system, system-ui, sans-serif';
const ACCENT = '#ff3b3b';

function roadPath(ctx: CanvasRenderingContext2D, map: MapDef) {
  ctx.beginPath();
  map.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
}

function drawTower(ctx: CanvasRenderingContext2D, key: TowerKey, x: number, y: number, aim: number, lv: [number, number], alpha = 1) {
  const c = TOWERS[key].color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = c;
  ctx.fillStyle = '#000';
  const r = TOWER_R;
  if (key === 'cannon' || key === 'bank') {
    ctx.fillRect(x - r + 1, y - r + 1, (r - 1) * 2, (r - 1) * 2);
    ctx.strokeRect(x - r + 1, y - r + 1, (r - 1) * 2, (r - 1) * 2);
  } else if (key === 'sniper') {
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (key === 'spray') {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // What it points with.
  if (key === 'dart' || key === 'sniper' || key === 'cannon') {
    const len = key === 'sniper' ? 16 : key === 'cannon' ? 12 : 10;
    ctx.lineWidth = key === 'cannon' ? 5 : 2.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(aim) * len, y + Math.sin(aim) * len); ctx.stroke();
  }
  if (key === 'frost') {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (key === 'bank') {
    ctx.fillStyle = c; ctx.font = `800 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', x, y + 1);
  }
  if (key === 'spray') {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Upgrade pips: one dot a level, path one on the left, path two on the right.
  const pips = [...Array(lv[0]).fill(0), ...Array(lv[1]).fill(1)];
  pips.forEach((p, i) => {
    ctx.fillStyle = p === 0 ? '#ffffff' : ACCENT;
    ctx.beginPath(); ctx.arc(x - ((pips.length - 1) * 5) / 2 + i * 5, y + r + 5, 1.8, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

interface Ghost { x: number; y: number; ok: boolean }

function draw(ctx: CanvasRenderingContext2D, w: World, sel: Tower | null, placing: TowerKey | null, ghost: Ghost | null) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  // A faint grid of dots.
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 10; x < W; x += 20) for (let y = 10; y < H; y += 20) ctx.fillRect(x - 0.5, y - 0.5, 1, 1);

  // The road.
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  roadPath(ctx, w.map); ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = ROAD + 4; ctx.stroke();
  roadPath(ctx, w.map); ctx.strokeStyle = '#161616'; ctx.lineWidth = ROAD; ctx.stroke();
  roadPath(ctx, w.map); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.setLineDash([4, 8]); ctx.stroke(); ctx.setLineDash([]);
  // The end of the road: a red line across it.
  const pts = w.map.pts; const e = pts[pts.length - 1]; const e0 = pts[pts.length - 2];
  const ang = Math.atan2(e.y - e0.y, e.x - e0.x);
  if (e.x > 0 && e.x < W && e.y > 0 && e.y < H) {
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 3; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(ang + Math.PI / 2) * (ROAD / 2 + 3), e.y + Math.sin(ang + Math.PI / 2) * (ROAD / 2 + 3));
    ctx.lineTo(e.x - Math.cos(ang + Math.PI / 2) * (ROAD / 2 + 3), e.y - Math.sin(ang + Math.PI / 2) * (ROAD / 2 + 3));
    ctx.stroke();
  } else {
    // Off the bottom: a red bar along the edge where it leaves.
    const ex = Math.max(0, Math.min(W, e0.x)); const ey = Math.max(0, Math.min(H, e.y));
    ctx.fillStyle = ACCENT; ctx.fillRect(ex - ROAD / 2 - 3, ey - 3, ROAD + 6, 3);
  }
  ctx.lineCap = 'round';

  // Ranges.
  const ring = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color + '14'; ctx.strokeStyle = color + '66'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  };
  if (sel && sel.stats.range > 0 && sel.stats.range < 2000) ring(sel.x, sel.y, sel.stats.range, '#ffffff');

  // Towers.
  for (const t of w.towers) {
    drawTower(ctx, t.key, t.x, t.y, t.aim, t.lv);
    if (t === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(t.x, t.y, TOWER_R + 5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  }

  // Balls, the ones furthest along on top.
  const balls = [...w.balls].sort((a, b) => a.d - b.d);
  for (const b of balls) {
    const k = KINDS[b.kind];
    ctx.fillStyle = k.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, k.r, 0, Math.PI * 2); ctx.fill();
    if (b.kind === 'black') { ctx.strokeStyle = '#6a6a72'; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (b.kind === 'iron') { ctx.strokeStyle = '#d7dbe2'; ctx.lineWidth = 2; ctx.stroke(); }
    if (b.kind === 'shell') {
      // Cracks as it wears.
      const worn = 1 - b.hp / k.hp;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < Math.ceil(worn * 4); i++) {
        const a = i * 1.7;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(a) * k.r, b.y + Math.sin(a) * k.r); ctx.stroke();
      }
    }
    if (k.boss) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(b.x - k.r, b.y - k.r - 9, k.r * 2, 4);
      ctx.fillStyle = '#fff'; ctx.fillRect(b.x - k.r, b.y - k.r - 9, k.r * 2 * (b.hp / k.hp), 4);
    }
    // A shine, so they read as balls.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(b.x - k.r * 0.35, b.y - k.r * 0.35, k.r * 0.28, 0, Math.PI * 2); ctx.fill();
    if (b.slowT > 0) { ctx.strokeStyle = 'rgba(46,230,214,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b.x, b.y, k.r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
  }

  // Shots.
  for (const s of w.shots) {
    if (s.kind === 'shell') { ctx.fillStyle = '#c04bff'; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill(); continue; }
    const sp = Math.hypot(s.vx, s.vy) || 1;
    ctx.strokeStyle = s.heavy ? '#ff8a3b' : '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - (s.vx / sp) * 6, s.y - (s.vy / sp) * 6); ctx.stroke();
  }

  // Effects.
  for (const f of w.fx) {
    const p = f.t / f.life;
    ctx.globalAlpha = 1 - p;
    if (f.kind === 'pop') {
      ctx.strokeStyle = f.color; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2; const r1 = f.r * (0.8 + p * 1.2); const r2 = r1 + 3;
        ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); ctx.lineTo(f.x + Math.cos(a) * r2, f.y + Math.sin(a) * r2); ctx.stroke();
      }
    } else if (f.kind === 'blast') {
      ctx.strokeStyle = f.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + p * 0.6), 0, Math.PI * 2); ctx.stroke();
    } else if (f.kind === 'pulse') {
      ctx.strokeStyle = f.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * p, 0, Math.PI * 2); ctx.stroke();
    } else if (f.kind === 'tracer') {
      ctx.strokeStyle = f.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x2!, f.y2!); ctx.stroke();
    } else if (f.kind === 'coin') {
      ctx.fillStyle = f.color; ctx.font = `800 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.text ?? '', f.x, f.y - p * 14);
    }
    ctx.globalAlpha = 1;
  }

  // The tower being dropped.
  if (placing && ghost) {
    const st = statsOf(placing, [0, 0]);
    if (st.range > 0 && st.range < 2000) ring(ghost.x, ghost.y, st.range, ghost.ok ? '#ffffff' : ACCENT);
    drawTower(ctx, placing, ghost.x, ghost.y, -Math.PI / 2, [0, 0], ghost.ok ? 0.9 : 0.4);
    if (!ghost.ok) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ghost.x, ghost.y, TOWER_R + 3, 0, Math.PI * 2); ctx.stroke(); }
  }
}

function MapThumb({ map }: { map: MapDef }) {
  const d = map.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(0)} ${p.y.toFixed(0)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-[62px] shrink-0 rounded-lg bg-black">
      <path d={d} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={ROAD} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TARGET_NAME: Record<Target, string> = { first: 'First', last: 'Last', strong: 'Strong', close: 'Close' };

/** What the buttons show, copied out of the world ten times a second. */
interface Ui {
  gold: number; lives: number; wave: number; map: MapDef; running: boolean; over: World['over'];
  paused: boolean; speed: number; auto: boolean; placing: TowerKey | null;
  sel: null | { id: number; key: TowerKey; lv: [number, number]; target: Target; pops: number; sell: number; open: [boolean, boolean] };
}

// ── The page ───────────────────────────────────────────────────────────────

export default function PathGame() {
  const [screen, setScreen] = useState<'menu' | 'play'>('menu');
  // Client-only (PathClient), so the save can be read straight away.
  const [save, setSave] = useState<Save>(loadSave);
  const [ui, setUi] = useState<Ui | null>(null);
  const worldRef = useRef<World | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef({ s: 1, ox: 0, oy: 0, dpr: 1 });
  const ctl = useRef({ paused: false, speed: 1, auto: false, idle: 0, placing: null as TowerKey | null, sel: null as number | null, ghost: null as Ghost | null, down: false, savedAt: -1 });
  const bump = useCallback(() => {
    const w = worldRef.current; const c = ctl.current;
    if (!w) { setUi(null); return; }
    const t = w.towers.find((o) => o.id === c.sel);
    setUi({
      gold: Math.floor(w.gold), lives: w.lives, wave: w.wave, map: w.map, running: waveRunning(w), over: w.over,
      paused: c.paused, speed: c.speed, auto: c.auto, placing: c.placing,
      sel: t ? { id: t.id, key: t.key, lv: t.lv, target: t.target, pops: t.pops, sell: sellValue(t), open: [canUpgrade(t, 0), canUpgrade(t, 1)] } : null,
    });
  }, []);

  const start = (map: MapDef, resume?: RunSave) => {
    const w = (resume && restore(resume)) || newWorld(map);
    worldRef.current = w;
    Object.assign(ctl.current, { paused: false, speed: 1, idle: 0, placing: null, sel: null, ghost: null, savedAt: w.wave });
    setScreen('play');
    bump();
  };

  const persist = useCallback((w: World) => {
    const s = loadSave();
    s.best[w.map.id] = Math.max(s.best[w.map.id] ?? 0, w.bestCleared);
    s.run = w.over ? null : snapshot(w);
    storeSave(s); setSave(s);
  }, []);

  // The loop.
  useEffect(() => {
    if (screen !== 'play') return;
    let raf = 0; let last = performance.now(); let acc = 0; let uiT = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const w = worldRef.current; const cv = canvasRef.current;
      if (!w || !cv) return;
      const real = Math.min(0.1, (now - last) / 1000); last = now;
      const c = ctl.current;
      if (!c.paused && !w.over) {
        acc += real * c.speed;
        const DT = 1 / 60;
        let n = 0;
        while (acc >= DT && n < 12) { step(w, DT); acc -= DT; n++; }
        if (n === 12) acc = 0;
        // Between waves: autosave, and send the next one if auto is on.
        if (!waveRunning(w)) {
          if (c.savedAt !== w.wave || w.over) { c.savedAt = w.wave; persist(w); }
          if (c.auto && w.wave > 0 && !w.over) { c.idle += real; if (c.idle > 0.8) { c.idle = 0; sendWave(w); } }
        } else c.idle = 0;
        if (w.over) persist(w);
      }
      const v = viewRef.current;
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(v.s * v.dpr, 0, 0, v.s * v.dpr, v.ox * v.dpr, v.oy * v.dpr);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      const sel = w.towers.find((t) => t.id === c.sel) ?? null;
      draw(ctx, w, sel, c.placing, c.ghost);
      ctx.restore();
      uiT += real;
      if (uiT > 0.1) { uiT = 0; bump(); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [screen, bump, persist]);

  // Fit the board to the space it has.
  useEffect(() => {
    if (screen !== 'play') return;
    const box = boxRef.current; const cv = canvasRef.current;
    if (!box || !cv) return;
    const fit = () => {
      const r = box.getBoundingClientRect(); const dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`;
      const s = Math.min(r.width / W, r.height / H);
      viewRef.current = { s, ox: (r.width - W * s) / 2, oy: (r.height - H * s) / 2, dpr };
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(box);
    return () => ro.disconnect();
  }, [screen]);

  // Pause when the phone looks away.
  useEffect(() => {
    const away = () => { if (document.hidden && worldRef.current) { ctl.current.paused = true; bump(); } };
    document.addEventListener('visibilitychange', away);
    return () => document.removeEventListener('visibilitychange', away);
  }, [bump]);

  const toWorld = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect(); const v = viewRef.current;
    return { x: (e.clientX - r.left - v.ox) / v.s, y: (e.clientY - r.top - v.oy) / v.s };
  };
  /** On a touch screen the tower sits above the finger, where it can be seen. */
  const ghostAt = (e: React.PointerEvent): Ghost => {
    const p = toWorld(e); const w = worldRef.current!;
    const y = e.pointerType === 'touch' ? p.y - 38 : p.y;
    return { x: p.x, y, ok: canPlace(w, p.x, y) && w.gold >= TOWERS[ctl.current.placing!].cost };
  };
  const onDown = (e: React.PointerEvent) => {
    const w = worldRef.current; if (!w) return;
    const c = ctl.current;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    c.down = true;
    if (c.placing) { c.ghost = ghostAt(e); bump(); return; }
    const p = toWorld(e);
    const hit = w.towers.find((t) => Math.hypot(t.x - p.x, t.y - p.y) <= TOWER_R + 6);
    c.sel = hit ? hit.id : null;
    bump();
  };
  const onMove = (e: React.PointerEvent) => {
    const c = ctl.current;
    if (c.placing && (c.down || e.pointerType === 'mouse')) c.ghost = ghostAt(e);
  };
  const onUp = (e: React.PointerEvent) => {
    const w = worldRef.current; const c = ctl.current;
    c.down = false;
    if (!w || !c.placing) return;
    const g = ghostAt(e);
    if (g.ok) {
      const t = place(w, c.placing, g.x, g.y);
      if (t) { c.placing = null; c.ghost = null; c.sel = null; }
    } else if (e.pointerType === 'touch') c.ghost = null;
    bump();
  };

  // ── Screens ──────────────────────────────────────────────────────────────

  const shell = 'fixed inset-0 bg-[#000000] text-white select-none overflow-hidden flex flex-col';
  const shellStyle: React.CSSProperties = {
    paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
    WebkitTouchCallout: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation', overscrollBehavior: 'none',
    fontFamily: FONT,
  };
  const btn = 'rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-30';

  if (screen === 'menu') {
    const run = save.run; const runMap = run && MAPS.find((m) => m.id === run.map);
    return (
      <div className={shell} style={shellStyle}>
        <div className="mx-auto w-full max-w-[480px] flex-1 overflow-y-auto px-5 py-6">
          <div className="text-4xl font-black tracking-tight text-[#ff3b3b]">PATH</div>
          <div className="mt-1 text-sm text-white/50">Hold the road.</div>
          {run && runMap && (
            <button onClick={() => start(runMap, run)} className={`${btn} mt-5 w-full bg-white py-4 text-lg text-black`}>
              RESUME · {runMap.name.toUpperCase()} · WAVE {run.wave + 1}
            </button>
          )}
          <div className="mt-6 text-[11px] uppercase tracking-wider text-white/40">{run ? 'New game' : 'Pick a road'}</div>
          <div className="mt-2 space-y-2">
            {MAPS.map((m) => {
              const best = save.best[m.id] ?? 0;
              return (
                <button key={m.id} onClick={() => { if (!run || confirm('Start over? The saved game will be lost.')) start(m); }}
                  className={`${btn} flex w-full items-center gap-4 bg-white/5 p-3 text-left`}>
                  <MapThumb map={m} />
                  <div className="flex-1">
                    <div className="text-lg">{m.name}</div>
                    <div className="text-[13px] font-normal text-white/50">{m.blurb} {Math.round(track(m).len)} long.</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wider text-white/40">Best</div>
                    <div className={`text-xl ${best >= LAST_WAVE ? 'text-[#ffd166]' : ''}`}>{best || '—'}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-8 space-y-2 text-[13px] leading-snug text-white/50">
            <p><b className="text-white/80">Tap a tower</b> in the shop, then touch the board and slide to where it goes. Lift to drop it. It can&apos;t sit on the road.</p>
            <p><b className="text-white/80">Tap a tower</b> on the board to upgrade it, sell it, or change what it aims at. Each has two lines of upgrades: one can go all the way, the other then stops at its first.</p>
            <p>Balls come in layers. Pop a pink and a yellow takes its place. <b className="text-white/80">Black</b> shrugs off cannons. <b className="text-white/80">White</b> shrugs off frost. <b className="text-white/80">Iron</b> only breaks to cannons, snipers and the top upgrades. Every ball that reaches the red line costs a life for each layer it still has.</p>
            <p className="text-white/30">Survive {LAST_WAVE} waves. Then keep going.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!ui) return <div className={shell} style={shellStyle} />;
  const sel = ui.sel;
  /** Do something to the world, then show it. */
  const act = (f: (w: World, c: typeof ctl.current) => void) => { const w = worldRef.current; if (w) { f(w, ctl.current); bump(); } };
  const withSel = (f: (w: World, t: Tower, c: typeof ctl.current) => void) => act((w, c) => { const t = w.towers.find((o) => o.id === c.sel); if (t) f(w, t, c); });
  const quit = () => { const w = worldRef.current; if (w) persist(w); worldRef.current = null; setScreen('menu'); setUi(null); };
  const replay = () => start(ui.map);

  return (
    <div className={shell} style={shellStyle}>
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col">
        {/* Top: out, lives, gold, wave. */}
        <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[13px]">
          <button className={`${btn} bg-white/10 px-3 py-1.5`} onClick={quit}>✕</button>
          <div className="flex items-baseline gap-4 tabular-nums">
            <span className={`text-lg font-black ${ui.lives <= 20 ? 'text-[#ff3b3b]' : ''}`}>♥ {ui.lives}</span>
            <span className="text-lg font-black text-[#ffd166]">${Math.floor(ui.gold)}</span>
          </div>
          <div className="text-right">
            <div className="font-black tabular-nums">WAVE {ui.wave}<span className="text-white/40">/{LAST_WAVE}</span></div>
            <div className="flex items-center justify-end gap-1 text-[11px] text-white/45">
              next
              {[...new Set(waveGroups(ui.wave + 1).map((g) => g.kind))].map((k) => (
                <span key={k} className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KINDS[k].color, outline: k === 'black' ? '1px solid #6a6a72' : k === 'iron' ? '1px solid #d7dbe2' : undefined }} />
              ))}
            </div>
          </div>
        </div>

        {/* The board. */}
        <div ref={boxRef} className="relative min-h-0 flex-1">
          <canvas ref={canvasRef} className="absolute inset-0 block" style={{ touchAction: 'none' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            onPointerCancel={() => { ctl.current.down = false; ctl.current.ghost = null; }}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') ctl.current.ghost = null; }} />
          {ui.paused && !ui.over && (
            <button className="absolute inset-0 flex items-center justify-center bg-black/60" onClick={() => act((_, c) => { c.paused = false; })}>
              <div className="text-center"><div className="text-4xl font-black">PAUSED</div><div className="mt-1 text-sm text-white/50">tap to carry on</div></div>
            </button>
          )}
          {ui.over && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-8 text-center">
              <div className={`text-5xl font-black ${ui.over === 'win' ? 'text-white' : 'text-[#ff3b3b]'}`}>{ui.over === 'win' ? 'HELD' : 'OVERRUN'}</div>
              <div className="text-sm text-white/60">{ui.over === 'win' ? `All ${LAST_WAVE} waves. The road is yours.` : `Wave ${ui.wave} got through.`}</div>
              {ui.over === 'win' && (
                <button className={`${btn} w-full bg-white py-3 text-black`} onClick={() => act((w) => { w.over = null; w.freeplay = true; })}>Keep going</button>
              )}
              <button className={`${btn} w-full ${ui.over === 'win' ? 'bg-white/10' : 'bg-white text-black'} py-3`} onClick={replay}>Play again</button>
              <button className={`${btn} w-full bg-white/10 py-3`} onClick={quit}>Menu</button>
            </div>
          )}
        </div>

        {/* Bottom: controls, then the shop or the picked tower. */}
        <div className="px-3 pb-2 pt-1.5">
          <div className="mb-1.5 flex gap-1.5">
            <button className={`${btn} flex-1 py-2.5 text-[15px] ${ui.running ? 'bg-white/10' : 'bg-white text-black'}`} disabled={!!ui.over}
              onClick={() => act((w, c) => { sendWave(w); c.paused = false; })}>
              {ui.running ? `▶ SEND ${ui.wave + 1} EARLY` : `▶ WAVE ${ui.wave + 1}`}
            </button>
            <button className={`${btn} w-14 py-2.5 text-[13px] ${ui.auto ? 'bg-[#ff3b3b] text-white' : 'bg-white/10'}`} onClick={() => act((_, c) => { c.auto = !c.auto; })}>AUTO</button>
            <button className={`${btn} w-12 py-2.5 text-[14px] ${ui.speed > 1 ? 'bg-white text-black' : 'bg-white/10'}`} onClick={() => act((_, c) => { c.speed = c.speed === 1 ? 2 : c.speed === 2 ? 3 : 1; })}>{ui.speed}×</button>
            <button className={`${btn} w-12 bg-white/10 py-2.5 text-[14px]`} onClick={() => act((_, c) => { c.paused = !c.paused; })}>{ui.paused ? '▶' : '❚❚'}</button>
          </div>

          <div className="h-[122px]">
            {sel ? (
              <div className="flex h-full flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-[13px]">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TOWERS[sel.key].color }} />
                  <b>{TOWERS[sel.key].name}</b>
                  <span className="text-white/40">{sel.pops} pops</span>
                  <span className="flex-1" />
                  {sel.key !== 'bank' && sel.key !== 'frost' && sel.key !== 'spray' && (
                    <button className={`${btn} bg-white/10 px-2.5 py-1.5`} onClick={() => withSel((_, t) => { t.target = TARGETS[(TARGETS.indexOf(t.target) + 1) % TARGETS.length]; })}>
                      {TARGET_NAME[sel.target]} ▸
                    </button>
                  )}
                  <button className={`${btn} bg-white/10 px-2.5 py-1.5 text-[#ffd166]`} onClick={() => withSel((w, t, c) => { sell(w, t); c.sel = null; })}>Sell ${sel.sell}</button>
                  <button className={`${btn} bg-white/10 px-2.5 py-1.5`} onClick={() => act((_, c) => { c.sel = null; })}>✕</button>
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5">
                  {([0, 1] as const).map((p) => {
                    const lv = sel.lv[p]; const path = TOWERS[sel.key].paths[p];
                    const next = path[lv]; const open = sel.open[p];
                    const poor = !!next && ui.gold < next.cost;
                    return (
                      <button key={p} disabled={!open || poor} onClick={() => withSel((w, t) => { upgrade(w, t, p); })}
                        className={`${btn} flex flex-col items-start justify-between bg-white/5 px-3 py-2 text-left disabled:opacity-100`}>
                        <div className="flex w-full items-center gap-1">
                          {path.map((_, i) => <span key={i} className="inline-block h-1.5 w-4 rounded-full" style={{ background: i < lv ? (p ? ACCENT : '#fff') : 'rgba(255,255,255,0.15)' }} />)}
                        </div>
                        {next ? (
                          <>
                            <div className={!open ? 'opacity-30' : poor ? 'opacity-50' : ''}>
                              <div className="text-[14px]">{next.name}</div>
                              <div className="text-[11px] font-normal leading-tight text-white/50">{next.desc}</div>
                            </div>
                            <div className={`text-[13px] ${!open ? 'text-white/30' : poor ? 'text-white/40' : 'text-[#ffd166]'}`}>{open ? `$${next.cost}` : 'Locked'}</div>
                          </>
                        ) : (
                          <div className="text-[13px] text-white/40">Maxed</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col gap-1.5">
                <div className="grid flex-1 grid-cols-3 gap-1.5">
                  {TOWER_KEYS.map((k) => {
                    const t = TOWERS[k]; const on = ui.placing === k;
                    return (
                      <button key={k} disabled={ui.gold < t.cost && !on}
                        onClick={() => act((_, c) => { c.placing = on ? null : k; c.ghost = null; c.sel = null; })}
                        className={`${btn} flex flex-col items-start justify-center px-2.5 text-left ${on ? 'bg-white text-black' : 'bg-white/5'}`}>
                        <div className="flex items-center gap-1.5 text-[14px]">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color, outline: on ? '1px solid #000' : undefined }} />{t.name}
                        </div>
                        <div className={`text-[12px] ${on ? 'text-black/60' : 'text-[#ffd166]'}`}>${t.cost}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="text-center text-[12px] text-white/40">
                  {ui.placing ? <>Touch the board and slide to place. {TOWERS[ui.placing].desc}</> : 'Tap a tower to buy it. Tap one on the board to upgrade it.'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
