'use client';

import { useEffect, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────────
// Sparkline breeder (TESTING ONLY — route: /sparkline)
//
// Mirrors generateFallbackSparkline() in CanvasGrid.tsx, but PURE RANDOM (no
// seed) — every card is one unique, randomly generated sparkline, frozen until
// you breed or reroll. Every constant in the formula is a gene. Workflow: pick
// the cards you like → Breed → your picks survive (★ elites) and the rest of the
// population becomes crossover + slight mutation of them, each freshly randomized.
// Repeat until the population reliably looks the way you want, then copy that
// genome's numbers into CanvasGrid.tsx.
// ──────────────────────────────────────────────────────────────────────────────

const COLOR_POSITIVE = '#04df9d';
const POP = 12;

interface Params {
  nBase: number;        // minimum number of points
  nRange: number;       // extra random points: nBase .. nBase+nRange-1
  wiggleBase: number;   // baseline swing depth (fraction of full height)
  wiggleRange: number;  // extra random swing depth
  swingProb: number;    // probability a point gets an extra fat-tail swing
  swingMag: number;     // extra swing magnitude multiplier (× wiggle)
  taperPow: number;     // endpoint pinning: sin(πt)^pow (1 = soft, higher = harder pin)
  fillLo: number;       // normalized floor
  fillSpan: number;     // normalized span (fillLo .. fillLo+fillSpan)
}

const DEFAULTS: Params = {
  nBase: 13, nRange: 9,
  wiggleBase: 0.34, wiggleRange: 0.18,
  swingProb: 0.22, swingMag: 1.8,
  taperPow: 1,
  fillLo: 0.1, fillSpan: 0.8,
};

// gene → display + breeding metadata
const GENES: { key: keyof Params; label: string; min: number; max: number; mut: number; int?: boolean }[] = [
  { key: 'nBase',       label: 'N base',        min: 2,   max: 40, mut: 2,    int: true },
  { key: 'nRange',      label: 'N range',       min: 0,   max: 30, mut: 2,    int: true },
  { key: 'wiggleBase',  label: 'Wiggle base',   min: 0,   max: 1,  mut: 0.04 },
  { key: 'wiggleRange', label: 'Wiggle range',  min: 0,   max: 1,  mut: 0.04 },
  { key: 'swingProb',   label: 'Swing prob',    min: 0,   max: 1,  mut: 0.04 },
  { key: 'swingMag',    label: 'Swing mag',     min: 0,   max: 4,  mut: 0.2 },
  { key: 'taperPow',    label: 'Taper power',   min: 0.4, max: 4,  mut: 0.2 },
  { key: 'fillLo',      label: 'Fill floor',    min: 0,   max: 0.5, mut: 0.03 },
  { key: 'fillSpan',    label: 'Fill span',     min: 0.1, max: 1,  mut: 0.04 },
];

interface SparkPoint { value: number; timestamp: number }
interface Genome { id: string; params: Params; data: SparkPoint[] }

// Mirror of the new CanvasGrid.generateFallbackSparkline (volatile climb: rising
// backbone + tapered mean-zero jitter), but PURE RANDOM — every call is unique.
function generateSparkline(p: Params): SparkPoint[] {
  const rand = Math.random;
  const N = Math.max(2, Math.round(p.nBase) + Math.floor(rand() * Math.max(1, Math.round(p.nRange))));
  const wiggle = p.wiggleBase + rand() * p.wiggleRange;
  const vals: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);                              // 0..1 rising backbone
    const taper = Math.pow(Math.sin(Math.PI * t), p.taperPow); // 0 at ends → pins endpoints
    let j = (rand() - 0.5) * wiggle;                    // mean-zero pullback noise
    if (rand() < p.swingProb) j += (rand() - 0.5) * wiggle * p.swingMag; // bigger swing
    vals.push(t + j * taper);
  }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const range = Math.max(1e-6, hi - lo);
  return vals.map((x, i) => ({ value: p.fillLo + ((x - lo) / range) * p.fillSpan, timestamp: i }));
}

// Kalshi-style step line, same drawing as drawMarketRow.ts (hold then jump).
function drawSpark(canvas: HTMLCanvasElement, data: SparkPoint[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  if (data.length < 1) return;

  const PAD = 12;
  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  const vals = data.length === 1 ? [data[0]!.value, data[0]!.value] : data.map(p => p.value);
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const vRange = vMax - vMin;
  const pts = vals.map((v, i) => ({
    x: PAD + (i / (vals.length - 1)) * innerW,
    y: vRange === 0 ? PAD + innerH / 2 : PAD + (1 - (v - vMin) / vRange) * innerH,
  }));

  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.lineTo(pts[i + 1]!.x, pts[i]!.y);     // hold
    ctx.lineTo(pts[i + 1]!.x, pts[i + 1]!.y); // jump
  }
  ctx.strokeStyle = COLOR_POSITIVE;
  ctx.lineWidth = 3;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.stroke();
}

// ── Genetics ──────────────────────────────────────────────────────────────────
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function mutate(p: Params, rate = 0.7): Params {
  const out: Params = { ...p };
  for (const g of GENES) {
    if (Math.random() < rate) {
      let v = (p[g.key] as number) + (Math.random() * 2 - 1) * g.mut;
      v = clamp(v, g.min, g.max);
      if (g.int) v = Math.round(v);
      (out[g.key] as number) = v;
    }
  }
  return out;
}

function crossover(a: Params, b: Params): Params {
  const out = { ...a };
  for (const g of GENES) (out[g.key] as number) = Math.random() < 0.5 ? (a[g.key] as number) : (b[g.key] as number);
  return out;
}

let GID = 0;
const makeGenome = (params: Params): Genome => ({ id: `g${GID++}`, params, data: generateSparkline(params) });
const seedPopulation = (base: Params): Genome[] => Array.from({ length: POP }, () => makeGenome(mutate(base, 0.8)));

// ── Components ──────────────────────────────────────────────────────────────────
function Card({ genome, selected, onClick }: { genome: Genome; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawSpark(ref.current, genome.data); }, [genome]);
  const d = genome.data;
  const net = d.length ? d[d.length - 1]!.value - d[0]!.value : 0;
  return (
    <button
      onClick={onClick}
      style={{
        padding: 6, background: 'transparent', cursor: 'pointer',
        border: `2px solid ${selected ? COLOR_POSITIVE : '#222'}`,
        borderRadius: 10, boxShadow: selected ? `0 0 0 3px ${COLOR_POSITIVE}33` : 'none',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      <canvas ref={ref} width={240} height={96} style={{ borderRadius: 6, display: 'block' }} />
      <div style={{ fontSize: 10, color: net >= 0 ? COLOR_POSITIVE : '#ff5d5d', fontFamily: 'monospace', textAlign: 'left' }}>
        {selected ? '★ ' : ''}{d.length}pts · net {net >= 0 ? '+' : ''}{net.toFixed(3)}
      </div>
    </button>
  );
}

export default function SparklineBreeder() {
  const [gen, setGen] = useState(0);
  const [population, setPopulation] = useState<Genome[]>(() => seedPopulation(DEFAULTS));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function breed() {
    const parents = population.filter(g => selected.has(g.id));
    if (!parents.length) return;
    const next: Genome[] = parents.map(p => p); // elites live on unchanged (same shape)
    while (next.length < POP) {
      const a = parents[Math.floor(Math.random() * parents.length)]!;
      const b = parents[Math.floor(Math.random() * parents.length)]!;
      const childParams = mutate(parents.length > 1 ? crossover(a.params, b.params) : a.params, 0.7);
      next.push(makeGenome(childParams)); // child = freshly randomized shape
    }
    setPopulation(next);
    setSelected(new Set());
    setGen(g => g + 1);
  }

  function reroll() {
    // Re-draw a fresh random shape for every card EXCEPT selected ones (same
    // genomes). A genome that keeps looking good across rerolls is the keeper —
    // that's exactly how it'll behave in production (random per market).
    setPopulation(prev => prev.map(g => (selected.has(g.id) ? g : { ...g, data: generateSparkline(g.params) })));
  }

  function reset() {
    setPopulation(seedPopulation(DEFAULTS));
    setSelected(new Set());
    setGen(0);
  }

  const selGenomes = population.filter(g => selected.has(g.id));

  return (
    <div style={{ minHeight: '100vh', background: '#000', color: '#eee', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Sparkline breeder</h1>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 16, maxWidth: 760 }}>
        Pure random generation — every card is one unique sparkline. Pick the cards you like, then <b>Breed</b>:
        your picks survive unchanged (★ elites), the rest become crossover + slight mutation of them, each freshly
        randomized. Use <b>Reroll</b> to re-draw the unselected cards from their same genomes (a genome that keeps
        looking good is the keeper — production is random per market). Copy the winning genome below into{' '}
        <code>generateFallbackSparkline()</code>.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#aaa', fontFamily: 'monospace' }}>Gen {gen}</span>
        <button onClick={breed} disabled={selected.size === 0} style={selected.size ? btnPrimary : btnDisabled}>
          ▶ Breed ({selected.size} selected)
        </button>
        <button onClick={reroll} style={btnGhost}>Reroll (keeps selected)</button>
        <button onClick={reset} style={btnGhost}>Reset to defaults</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, max-content)', gap: 14 }}>
        {population.map(g => (
          <Card key={g.id} genome={g} selected={selected.has(g.id)} onClick={() => toggle(g.id)} />
        ))}
      </div>

      {/* Winning genome readout */}
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 14, color: '#aaa', marginBottom: 8 }}>
          Selected genome{selGenomes.length > 1 ? 's' : ''} — copy into CanvasGrid.tsx
        </h2>
        {selGenomes.length === 0 && <p style={{ fontSize: 12, color: '#666' }}>Select a card to see its numbers.</p>}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {selGenomes.map(g => (
            <pre key={g.id} style={{ padding: 12, background: '#0d0d0d', border: `1px solid ${COLOR_POSITIVE}55`, borderRadius: 8, fontSize: 11, color: '#9fe' }}>
{JSON.stringify(g.params, null, 2)}
            </pre>
          ))}
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: COLOR_POSITIVE, color: '#003', border: 'none', borderRadius: 6,
  padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const btnDisabled: React.CSSProperties = { ...btnPrimary, background: '#1c1c1c', color: '#555', cursor: 'not-allowed' };
const btnGhost: React.CSSProperties = {
  background: '#1a1a1a', color: '#ccc', border: '1px solid #333', borderRadius: 6,
  padding: '8px 14px', fontSize: 12, cursor: 'pointer',
};
