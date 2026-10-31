'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DISC, MAX_PULL, POWER, STEP, nextRadius, step, type Disc, type Team } from './physics';
import { planShots, type Level, type Shot } from './bot';

// Both sides aim in secret, then every piece launches at once. Two players
// pass the phone between them; against the bot, it locks in its shots before
// you aim. Pieces whose center leaves the board fall off. The board shrinks a
// little each round, so games always end.

type Mode = 'bot' | 'pvp';
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
const VIEW = 1.12;      // world units from center to canvas edge
const COUNTS = [1, 2, 3, 4, 5, 6, 8];
const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

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
function fire(g: { discs: Disc[]; shrunk: boolean; botPlan: Shot[] | null }) {
  g.discs.forEach((d, i) => {
    const s = g.botPlan && d.team === 1 ? g.botPlan[i] : d;
    d.vx = s.ax * POWER;
    d.vy = s.ay * POWER;
    d.ax = d.ay = 0;
  });
  g.botPlan = null;
  g.shrunk = false;
}

export default function KnockoutGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef({ discs: [] as Disc[], r: 1, rTarget: 1, shrunk: false, dragging: -1, botPlan: null as Shot[] | null });
  const phaseRef = useRef<Phase>({ kind: 'setup' });
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [count, setCount] = useState(4);
  const [alive, setAlive] = useState<[number, number]>([0, 0]);
  const [mode, setMode] = useState<Mode>('bot');
  const [level, setLevel] = useState<Level>('hard');
  const [botReady, setBotReady] = useState(false);
  const setup = useRef({ mode: 'bot' as Mode, level: 'hard' as Level });

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
    const d = game.current.discs.filter((x) => !x.out);
    setAlive([d.filter((x) => x.team === 0).length, d.filter((x) => x.team === 1).length]);
  }, []);

  // The bot plans from positions alone, copied out before you can aim: it is
  // never handed an arrow, so it has nothing of yours to read.
  const planBot = useCallback(() => {
    const g = game.current;
    const pieces = g.discs.map((d) => ({ x: d.x, y: d.y, team: d.team, out: d.out > 0 }));
    g.botPlan = planShots(pieces, 1, g.r, setup.current.level);
    setBotReady(true);
  }, []);

  const beginRound = useCallback(() => {
    if (setup.current.mode === 'pvp') return go({ kind: 'pass', team: 0 });
    game.current.botPlan = null;
    setBotReady(false);
    go({ kind: 'aim', team: 0 });
    setTimeout(planBot, 60);
  }, [go, planBot]);

  const start = () => {
    setup.current = { mode, level };
    game.current = { discs: setupDiscs(count), r: 1, rTarget: 1, shrunk: false, dragging: -1, botPlan: null };
    beginRound();
  };

  const launch = () => {
    if (setup.current.mode === 'bot' && !game.current.botPlan) planBot();
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

    const settled = () => {
      const g = game.current;
      const moving = g.discs.some((d) => (!d.out && (d.vx || d.vy)) || (d.out > 0 && d.out < 1));
      if (moving || Math.abs(g.r - g.rTarget) > 0.002) return;
      if (!g.shrunk) {
        g.shrunk = true;
        g.rTarget = nextRadius(g.r);
        return;
      }
      const left = [0, 1].map((t) => g.discs.some((d) => !d.out && d.team === t));
      if (!left[0] || !left[1]) go({ kind: 'over', winner: left[0] ? 0 : left[1] ? 1 : null });
      else beginRound();
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
          const tx = d.x + d.ax, ty = d.y + d.ay;
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
        while (acc >= STEP) { step(g.discs, g.r); acc -= STEP; }
        g.r += (g.rTarget - g.r) * 0.15;
        if (g.shrunk) for (const d of g.discs) if (!d.out && Math.hypot(d.x, d.y) > g.r) d.out = 0.001;
        settled();
      } else acc = 0;
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [go, beginRound]);

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
    let ax = p.x - d.x, ay = p.y - d.y;
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
              <div className="ko-pick">
                <button className={mode === 'bot' ? 'on wide' : 'wide'} onClick={() => setMode('bot')}>Vs bot</button>
                <button className={mode === 'pvp' ? 'on wide' : 'wide'} onClick={() => setMode('pvp')}>2 players</button>
              </div>
              {mode === 'bot' && (
                <div className="ko-pick">
                  {LEVELS.map((l) => (
                    <button key={l} className={l === level ? 'on wide' : 'wide'} onClick={() => setLevel(l)}>{cap(l)}</button>
                  ))}
                </div>
              )}
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
              <p className="ko-big">
                {phase.winner === null
                  ? 'Draw'
                  : mode === 'bot'
                    ? (phase.winner === 0 ? 'You win' : 'Bot wins')
                    : `${TEAMS[phase.winner].name} wins`}
              </p>
              <button className="ko-primary" onClick={() => go({ kind: 'setup' })}>Play again</button>
            </div>
          </div>
        )}
      </div>

      {phase.kind === 'aim' && (
        <div className="ko-bar">
          <span>
            {mode === 'bot'
              ? (botReady ? 'Bot has locked in. Drag a piece where you want it to go.' : 'Bot is choosing…')
              : `${TEAMS[phase.team].name}: drag a piece where you want it to go`}
          </span>
          {mode === 'bot' ? (
            <button className="ko-primary" onClick={launch}>Go</button>
          ) : (
            <button
              className="ko-primary"
              onClick={() => (phase.team === 0 ? go({ kind: 'pass', team: 1 }) : launch())}
            >
              {phase.team === 0 ? 'Done' : 'Go'}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
