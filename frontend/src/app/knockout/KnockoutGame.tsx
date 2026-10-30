'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Both players aim in secret (pass the phone between them), then every piece
// launches at once. Pieces whose center leaves the board fall off. The board
// shrinks a little each round, so games always end.

type Team = 0 | 1;
interface Disc { x: number; y: number; vx: number; vy: number; team: Team; ax: number; ay: number; out: number }
type Phase =
  | { kind: 'setup' }
  | { kind: 'pass'; team: Team }
  | { kind: 'aim'; team: Team }
  | { kind: 'sim' }
  | { kind: 'over'; winner: Team | null };

const TEAMS = [
  { name: 'Red', fill: '#e8485e', rim: '#ffd0d7' },
  { name: 'Black', fill: '#1c1c1f', rim: '#9a9aa0' },
];
const DISC = 0.075;     // piece radius, board starts at radius 1
const MAX_PULL = 0.5;   // longest drag that counts
const POWER = 10;       // launch speed per unit of pull
const DRAG = 1.3;       // exponential slow-down per second
const VIEW = 1.12;      // world units from center to canvas edge
const COUNTS = [1, 2, 3, 4, 5, 6, 8];

function setupDiscs(n: number): Disc[] {
  const discs: Disc[] = [];
  const spread = Math.min(Math.PI * 0.75, 0.35 * (n - 1));
  for (const team of [0, 1] as Team[]) {
    const center = team === 0 ? Math.PI : 0;
    for (let k = 0; k < n; k++) {
      const a = center + (n === 1 ? 0 : -spread / 2 + (spread * k) / (n - 1));
      const r = n > 5 && k % 2 ? 0.38 : 0.6;
      discs.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, team, ax: 0, ay: 0, out: 0 });
    }
  }
  return discs;
}

/** Turns every piece's aim into velocity at once. */
function fire(g: { discs: Disc[]; shrunk: boolean }) {
  for (const d of g.discs) {
    d.vx = d.ax * POWER;
    d.vy = d.ay * POWER;
    d.ax = d.ay = 0;
  }
  g.shrunk = false;
}

export default function KnockoutGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef({ discs: [] as Disc[], r: 1, rTarget: 1, shrunk: false, dragging: -1 });
  const phaseRef = useRef<Phase>({ kind: 'setup' });
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [count, setCount] = useState(4);
  const [alive, setAlive] = useState<[number, number]>([0, 0]);

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
    const d = game.current.discs.filter((x) => !x.out);
    setAlive([d.filter((x) => x.team === 0).length, d.filter((x) => x.team === 1).length]);
  }, []);

  const start = () => {
    game.current = { discs: setupDiscs(count), r: 1, rTarget: 1, shrunk: false, dragging: -1 };
    go({ kind: 'pass', team: 0 });
  };

  const launch = () => {
    fire(game.current);
    go({ kind: 'sim' });
  };

  // Physics + drawing loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const STEP = 1 / 120;

    const step = () => {
      const g = game.current;
      const live = g.discs.filter((d) => !d.out);
      for (const d of g.discs) {
        d.x += d.vx * STEP;
        d.y += d.vy * STEP;
        const f = Math.exp(-DRAG * STEP);
        d.vx *= f;
        d.vy *= f;
        const s = Math.hypot(d.vx, d.vy);
        if (s < 0.03) d.vx = d.vy = 0;
        if (d.out) d.out = Math.min(1, d.out + STEP * 2.5);
        else if (Math.hypot(d.x, d.y) > g.r) d.out = 0.001;
      }
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
    };

    const settled = () => {
      const g = game.current;
      const moving = g.discs.some((d) => (!d.out && (d.vx || d.vy)) || (d.out > 0 && d.out < 1));
      if (moving || Math.abs(g.r - g.rTarget) > 0.002) return;
      if (!g.shrunk) {
        g.shrunk = true;
        g.rTarget = Math.max(0.5, g.r * 0.92);
        return;
      }
      const left = [0, 1].map((t) => g.discs.some((d) => !d.out && d.team === t));
      if (!left[0] || !left[1]) go({ kind: 'over', winner: left[0] ? 0 : left[1] ? 1 : null });
      else go({ kind: 'pass', team: 0 });
    };

    const draw = () => {
      const g = game.current;
      const ph = phaseRef.current;
      const w = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(w * dpr);
      }
      const s = (w * dpr) / (VIEW * 2);
      ctx.setTransform(s, 0, 0, s, (w * dpr) / 2, (w * dpr) / 2);
      ctx.clearRect(-VIEW, -VIEW, VIEW * 2, VIEW * 2);

      ctx.beginPath();
      ctx.arc(0, 0, g.r, 0, Math.PI * 2);
      ctx.fillStyle = '#e4e8ee';
      ctx.fill();

      const aiming = ph.kind === 'aim' ? ph.team : -1;
      for (const d of g.discs) {
        if (d.out >= 1) continue;
        const scale = 1 - d.out;
        ctx.globalAlpha = scale;
        ctx.beginPath();
        ctx.arc(d.x, d.y, DISC * scale, 0, Math.PI * 2);
        ctx.fillStyle = TEAMS[d.team].fill;
        ctx.fill();
        ctx.lineWidth = 0.012;
        ctx.strokeStyle = TEAMS[d.team].rim;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (d.team === aiming && (d.ax || d.ay)) {
          const tx = d.x + d.ax * 1.6, ty = d.y + d.ay * 1.6;
          const ang = Math.atan2(d.ay, d.ax);
          ctx.strokeStyle = TEAMS[d.team].fill;
          ctx.lineWidth = 0.025;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(d.x + Math.cos(ang) * DISC, d.y + Math.sin(ang) * DISC);
          ctx.lineTo(tx, ty);
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx - Math.cos(ang - 0.5) * 0.07, ty - Math.sin(ang - 0.5) * 0.07);
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx - Math.cos(ang + 0.5) * 0.07, ty - Math.sin(ang + 0.5) * 0.07);
          ctx.stroke();
        }
      }
    };

    const frame = (now: number) => {
      const g = game.current;
      acc = Math.min(acc + (now - last) / 1000, 0.1);
      last = now;
      if (phaseRef.current.kind === 'sim') {
        while (acc >= STEP) { step(); acc -= STEP; }
        g.r += (g.rTarget - g.r) * 0.15;
        if (g.shrunk) for (const d of g.discs) if (!d.out && Math.hypot(d.x, d.y) > g.r) d.out = 0.001;
        settled();
      } else acc = 0;
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [go]);

  const toWorld = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width * 2 - 1) * VIEW,
      y: ((e.clientY - rect.top) / rect.height * 2 - 1) * VIEW,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if (phase.kind !== 'aim') return;
    const p = toWorld(e);
    const g = game.current;
    let best = -1, bestD = DISC * 2.4;
    g.discs.forEach((d, i) => {
      if (d.out || d.team !== phase.team) return;
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < bestD) { bestD = dist; best = i; }
    });
    g.dragging = best;
    if (best >= 0) (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const g = game.current;
    if (g.dragging < 0) return;
    const d = g.discs[g.dragging];
    const p = toWorld(e);
    let ax = d.x - p.x, ay = d.y - p.y;
    const len = Math.hypot(ax, ay);
    if (len < DISC * 0.6) { ax = ay = 0; }
    else if (len > MAX_PULL) { ax *= MAX_PULL / len; ay *= MAX_PULL / len; }
    d.ax = ax;
    d.ay = ay;
  };

  const onUp = () => { game.current.dragging = -1; };

  const other = (t: Team): Team => (t === 0 ? 1 : 0);

  return (
    <main className="ko">
      <header className="ko-top">
        <h1>Knockout</h1>
        {phase.kind !== 'setup' && (
          <div className="ko-count">
            <span style={{ color: TEAMS[0].fill }}>{alive[0]}</span>
            <span className="ko-dim">–</span>
            <span>{alive[1]}</span>
          </div>
        )}
      </header>

      <div className="ko-board">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />

        {phase.kind === 'setup' && (
          <div className="ko-cover">
            <div className="ko-card">
              <p>Pieces each</p>
              <div className="ko-pick">
                {COUNTS.map((n) => (
                  <button key={n} className={n === count ? 'on' : ''} onClick={() => setCount(n)}>{n}</button>
                ))}
              </div>
              <button className="ko-primary" onClick={start}>Start</button>
            </div>
          </div>
        )}

        {phase.kind === 'pass' && (
          <div className="ko-cover solid">
            <div className="ko-card">
              <p>{TEAMS[phase.team].name}&apos;s turn to aim</p>
              <p className="ko-dim">{TEAMS[other(phase.team)].name}, look away</p>
              <button className="ko-primary" onClick={() => go({ kind: 'aim', team: phase.team })}>
                I&apos;m {TEAMS[phase.team].name}
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'over' && (
          <div className="ko-cover">
            <div className="ko-card">
              <p className="ko-big">{phase.winner === null ? 'Draw' : `${TEAMS[phase.winner].name} wins`}</p>
              <button className="ko-primary" onClick={() => go({ kind: 'setup' })}>Play again</button>
            </div>
          </div>
        )}
      </div>

      {phase.kind === 'aim' && (
        <div className="ko-bar">
          <span>{TEAMS[phase.team].name}: pull back from a piece to aim</span>
          <button
            className="ko-primary"
            onClick={() => (phase.team === 0 ? go({ kind: 'pass', team: 1 }) : launch())}
          >
            {phase.team === 0 ? 'Done' : 'Go'}
          </button>
        </div>
      )}
    </main>
  );
}
