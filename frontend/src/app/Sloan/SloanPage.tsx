'use client';

// angelstyle.com/Sloan — "Hey Dr. E, I'm Claude."
//
// A stack of phone-sized cards, scrolled with a thumb. Claude talks in the
// first person, because Aiden asked it to introduce itself to his old finance
// professor. Everything is drawn in code: the market line behind the hello, a
// valuation gauge, a compound-growth chart, confetti. The phone's own tricks
// are used where Safari allows them: the gyroscope tilts a card, the speech
// engine says hello out loud, the share sheet passes the page on.
//
// Every fact traces to a public source listed at the bottom. "Dr. E" is a
// nickname and the page says so.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const YEAR_NOW = 2026;
const CAREER_START = 1983;
const HARDING_START = 2005;

const SOURCES = [
  { label: 'Harding faculty gallery', href: 'https://facultygallery.harding.edu/en/persons/ellis-sloan' },
  { label: 'The Bison, 2012: finance team advances to NYC', href: 'https://thelink.harding.edu/the-bison/2012/02/24/finance-team-advances-to-meet-in-nyc/' },
  { label: 'The Bison, 2021: the Sloans on campus', href: 'https://thelink.harding.edu/the-bison/2021/03/19/sloans-get-the-whole-family-involved-on-campus-this-year/' },
  { label: 'SEC adviser record, APEX Wealth Management', href: 'https://adviserinfo.sec.gov/individual/summary/1161247' },
  { label: 'Rate My Professors', href: 'https://www.ratemyprofessors.com/professor/870086' },
];

const SUGGESTED = [
  'Who are you, in one sentence?',
  'Why HOLD on Polaris?',
  'Rule of 72, but make it funny.',
  'What did it take to build this?',
];

// ── Hooks ────────────────────────────────────────────────────────────────────

function useInView<T extends Element>(threshold = 0.3) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, seen };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

/** Types a string out, one character at a time, once its card is on screen. */
function useTypewriter(text: string, go: boolean, speed = 42) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!go) return;
    let i = 0;
    const id = setInterval(() => {
      i = reduced ? text.length : i + 1;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, reduced ? 1 : speed);
    return () => clearInterval(id);
  }, [go, text, speed, reduced]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Card({ id, children, className = '' }: { id: string; children: React.ReactNode; className?: string }) {
  const { ref, seen } = useInView<HTMLElement>(0.25);
  return (
    <section id={id} ref={ref} className={`card ${seen ? 'in' : ''} ${className}`}>
      {children}
    </section>
  );
}

function Bubble({ children, delay = 0, me = true }: { children: React.ReactNode; delay?: number; me?: boolean }) {
  return <div className={`bubble ${me ? 'me' : 'them'}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

function Count({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const { ref, seen } = useInView<HTMLSpanElement>(0.6);
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return;
    let raf = 0;
    const t0 = performance.now();
    const dur = reduced ? 1 : 1300;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value, reduced]);
  return <span ref={ref} className="count">{n.toFixed(decimals)}{suffix}</span>;
}

/** The market line behind the hello: a slow random walk in gold. */
function MarketCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0, w = 0, h = 0;
    const N = 110;
    const pts: number[] = [];
    let v = 0.5;
    for (let i = 0; i < N; i++) { v += (Math.random() - 0.48) * 0.04; v = Math.min(0.9, Math.max(0.1, v)); pts.push(v); }
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const xs = (i: number) => (i / (N - 1)) * w;
      const ys = (p: number) => h * (0.2 + (1 - p) * 0.6);
      ctx.beginPath();
      pts.forEach((p, i) => { const x = xs(i), y = ys(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(201,162,39,0)'); grad.addColorStop(1, 'rgba(201,162,39,0.9)');
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(201,162,39,0.6)'; ctx.shadowBlur = 16; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, 'rgba(201,162,39,0.14)'); fill.addColorStop(1, 'rgba(201,162,39,0)');
      ctx.fillStyle = fill; ctx.fill();
      ctx.beginPath(); ctx.arc(xs(N - 1), ys(pts[N - 1]), 4, 0, Math.PI * 2); ctx.fillStyle = '#c9a227'; ctx.fill();
    };
    const frame = () => {
      let nv = pts[N - 1] + (Math.random() - 0.485) * 0.04;
      nv = Math.min(0.92, Math.max(0.08, nv));
      pts.push(nv); pts.shift();
      draw();
      raf = requestAnimationFrame(frame);
    };
    draw();
    if (!reduced) raf = requestAnimationFrame(frame);
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden && !reduced) raf = requestAnimationFrame(frame); };
    document.addEventListener('visibilitychange', vis);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis); };
  }, [reduced]);
  return <canvas ref={ref} className="hero-canvas" aria-hidden="true" />;
}

/** Gold confetti over everything, for one and a half seconds. */
function useConfetti() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const fire = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.style.display = 'block';
    const colors = ['#c9a227', '#efe9dc', '#e2c45a', '#ffffff', '#8a6d12'];
    const ps = Array.from({ length: 160 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * 60, y: h * 0.6,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 16 - 6,
      r: Math.random() * 5 + 3, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const el = (t - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      ps.forEach((p) => {
        p.vy += 0.45; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.globalAlpha = Math.max(0, 1 - el / 1.8);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      });
      if (el < 1.9) raf = requestAnimationFrame(tick); else { ctx.clearRect(0, 0, w, h); canvas.style.display = 'none'; }
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }, []);
  return { ref, fire };
}

// ── The hello ────────────────────────────────────────────────────────────────

function Hello() {
  const { ref, seen } = useInView<HTMLDivElement>(0.3);
  const line = useTypewriter('Hey Dr. E.', seen, 70);
  const line2 = useTypewriter('I’m Claude.', line.done, 60);
  return (
    <section id="hello" className="card hero in">
      <MarketCanvas />
      <div className="hero-inner" ref={ref}>
        <div className="eyebrow">Searcy, Arkansas &middot; {new Date().getFullYear()}</div>
        <h1 className="hello-title">
          <span>{line.shown}{!line.done && <i className="caret" />}</span>
          <span className="gold">{line2.shown}{line.done && !line2.done && <i className="caret" />}</span>
        </h1>
        <p className={`hero-sub ${line2.done ? 'show' : ''}`}>
          Aiden asked me to introduce myself. So I read up on you, wrote this, drew the pictures, and put it on his phone. Scroll. I&rsquo;ll keep it short. You taught him, so I know you grade.
        </p>
        <div className={`hero-cue ${line2.done ? 'show' : ''}`}><span /></div>
      </div>
    </section>
  );
}

// ── The Polaris call ─────────────────────────────────────────────────────────

const FAIR_VALUE = 63;
const BAND = 0.10;

function PolarisCall() {
  const [price, setPrice] = useState(68);
  const ratio = price / FAIR_VALUE;
  const call = ratio < 1 - BAND ? 'BUY' : ratio > 1 + BAND ? 'SELL' : 'HOLD';
  const gap = ((FAIR_VALUE - price) / price) * 100;
  const min = 40, max = 90;
  const pct = ((price - min) / (max - min)) * 100;
  const fvPct = ((FAIR_VALUE - min) / (max - min)) * 100;
  const lo = ((FAIR_VALUE * (1 - BAND) - min) / (max - min)) * 100;
  const hi = ((FAIR_VALUE * (1 + BAND) - min) / (max - min)) * 100;
  return (
    <div className="polaris">
      <div className="polaris-top">
        <div><div className="eyebrow">Market</div><div className="polaris-price mono">${price.toFixed(0)}</div></div>
        <div><div className="eyebrow">Your team said</div><div className="polaris-price mono dim">${FAIR_VALUE}</div></div>
        <div className={`polaris-call call-${call.toLowerCase()}`}><div className="eyebrow">Call</div><div className="polaris-verdict">{call}</div></div>
      </div>
      <div className="polaris-track" aria-hidden="true">
        <div className="polaris-band" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        <div className="polaris-fv" style={{ left: `${fvPct}%` }} />
        <div className="polaris-dot" style={{ left: `${pct}%` }} />
      </div>
      <input className="slider" type="range" min={min} max={max} step={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} style={{ ['--fill' as string]: `${pct}%` }} aria-label="Market price of Polaris" />
      <p className="polaris-read mono">
        {gap >= 0 ? `+${gap.toFixed(1)}%` : `${gap.toFixed(1)}%`} to fair value &middot; {call === 'HOLD' ? 'inside the 10% band' : call === 'BUY' ? 'cheap. pounce.' : 'rich. take the money.'}
      </p>
    </div>
  );
}

// ── The lesson ───────────────────────────────────────────────────────────────

function money(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n).toLocaleString('en-US')}`;
}
function series(monthly: number, years: number, annual: number, delayYears: number) {
  const r = annual / 100 / 12;
  const out: number[] = [];
  let bal = 0;
  for (let y = 0; y <= years; y++) {
    out.push(bal);
    if (y === years) break;
    for (let m = 0; m < 12; m++) if (y >= delayYears) bal = bal * (1 + r) + monthly;
  }
  return out;
}

function Lesson() {
  const [monthly, setMonthly] = useState(200);
  const [years, setYears] = useState(40);
  const [rate, setRate] = useState(8);
  const delay = 10;
  const a = useMemo(() => series(monthly, years, rate, 0), [monthly, years, rate]);
  const b = useMemo(() => series(monthly, years, rate, delay), [monthly, years, rate]);
  const peak = Math.max(a[a.length - 1], 1);
  const W = 340, H = 190, P = 10;
  const path = (s: number[]) => s.map((v, i) => `${i === 0 ? 'M' : 'L'}${(P + (i / (s.length - 1)) * (W - 2 * P)).toFixed(1)},${(H - P - (v / peak) * (H - 2 * P)).toFixed(1)}`).join(' ');
  return (
    <div className="lesson">
      <svg className="lesson-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Growth of monthly investing, starting now versus ten years later">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={P} x2={W - P} y1={H - P - g * (H - 2 * P)} y2={H - P - g * (H - 2 * P)} className="grid" />)}
        <path d={`${path(a)} L${W - P},${H - P} L${P},${H - P} Z`} className="area-a" />
        <path d={path(b)} className="line-b" />
        <path d={path(a)} className="line-a" />
      </svg>
      <div className="lesson-read">
        <div className="lesson-card a"><div className="eyebrow">Start today</div><div className="lesson-big mono">{money(a[a.length - 1])}</div></div>
        <div className="lesson-card b"><div className="eyebrow">Wait {delay} yrs</div><div className="lesson-big mono">{money(b[b.length - 1])}</div></div>
      </div>
      <p className="lesson-cost">The decade you waited cost <b className="mono">{money(a[a.length - 1] - b[b.length - 1])}</b>. Rule of 72 says money doubles every <b className="mono">{(72 / rate).toFixed(1)}</b> years at {rate}%. You do that in your head. I do it in a microsecond. We&rsquo;re basically colleagues.</p>
      <div className="controls">
        <Control label="Each month" value={monthly} min={25} max={2000} step={25} fmt={(v) => `$${v}`} onChange={setMonthly} />
        <Control label="Years" value={years} min={5} max={50} step={1} fmt={(v) => `${v}`} onChange={setYears} />
        <Control label="Return" value={rate} min={1} max={15} step={0.5} fmt={(v) => `${v}%`} onChange={setRate} />
      </div>
    </div>
  );
}

function Control({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="control">
      <span className="control-row"><span>{label}</span><span className="mono">{fmt(value)}</span></span>
      <input className="slider" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--fill' as string]: `${pct}%` }} />
    </label>
  );
}

// ── Phone tricks ─────────────────────────────────────────────────────────────

type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

function TiltCard() {
  const [on, setOn] = useState<'off' | 'on' | 'denied'>('off');
  const [rot, setRot] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (on !== 'on') return;
    const handler = (e: DeviceOrientationEvent) => {
      const g = e.gamma ?? 0, b = e.beta ?? 45;
      setRot({ y: Math.max(-18, Math.min(18, g * 0.6)), x: Math.max(-18, Math.min(18, (45 - b) * 0.5)) });
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [on]);
  const ask = async () => {
    const D = DeviceOrientationEvent as DOE;
    try {
      if (typeof D.requestPermission === 'function') {
        const r = await D.requestPermission();
        setOn(r === 'granted' ? 'on' : 'denied');
      } else setOn('on');
    } catch { setOn('denied'); }
  };
  return (
    <div className="tilt-wrap">
      <div className="tilt" style={{ transform: `perspective(700px) rotateX(${rot.x}deg) rotateY(${rot.y}deg)` }}>
        <div className="tilt-shine" style={{ backgroundPosition: `${50 + rot.y * 2}% ${50 + rot.x * 2}%` }} />
        <div className="eyebrow">Chartered Financial Analyst</div>
        <div className="tilt-name">Ellis Sloan, <span className="gold">CFA</span></div>
        <div className="tilt-row mono"><span>SINCE 1983</span><span>HARDING &middot; 2005</span></div>
        <div className="tilt-row mono"><span>APEX WEALTH MGMT</span><span>SEARCY, AR</span></div>
      </div>
      {on === 'off' && <button type="button" className="btn" onClick={ask}>Tilt your phone</button>}
      {on === 'on' && <p className="tiny">That&rsquo;s your gyroscope. I asked nicely.</p>}
      {on === 'denied' && <p className="tiny">Safari said no. Fair. Imagine it tilting.</p>}
    </div>
  );
}

function Speak() {
  const [state, setState] = useState<'idle' | 'talking' | 'no'>('idle');
  const say = () => {
    if (!('speechSynthesis' in window)) { setState('no'); return; }
    const u = new SpeechSynthesisUtterance('Hey Dr. E. I’m Claude. Aiden says you taught him everything he knows about money. I checked his math. You did a good job.');
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((x) => /Samantha|Daniel|Karen|Moira/.test(x.name)) || voices.find((x) => x.lang.startsWith('en'));
    if (v) u.voice = v;
    u.rate = 0.98;
    u.onend = () => setState('idle');
    u.onerror = () => setState('no');
    setState('talking');
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };
  return (
    <div className="speak">
      <button type="button" className="btn" onClick={say} disabled={state === 'talking'}>
        {state === 'talking' ? 'Talking…' : 'Hear me say it'}
      </button>
      {state === 'no' && <p className="tiny">Your phone kept its mouth shut. Read it in my voice, then: warm, a little smug.</p>}
    </div>
  );
}

function ShareButton() {
  const [msg, setMsg] = useState('');
  const share = async () => {
    const data = { title: 'Hey Dr. E, I’m Claude', text: 'Claude built a page for Dr. E.', url: 'https://angelstyle.com/Sloan' };
    try {
      if (navigator.share) { await navigator.share(data); setMsg('Sent.'); }
      else { await navigator.clipboard.writeText(data.url); setMsg('Link copied.'); }
    } catch { /* user closed the sheet */ }
  };
  return (
    <div className="speak">
      <button type="button" className="btn ghost" onClick={share}>Share this page</button>
      {msg && <p className="tiny">{msg}</p>}
    </div>
  );
}

function ImpressedButton() {
  const { ref, fire } = useConfetti();
  const [n, setN] = useState(0);
  const labels = ['I\u2019m impressed, Claude', 'Again.', 'Okay, you can stop now.', 'Dr. E. Please.', 'Fine. One more.'];
  return (
    <>
      <canvas ref={ref} className="confetti" aria-hidden="true" />
      <button type="button" className="btn gold" onClick={() => { fire(); setN((x) => x + 1); }}>{labels[Math.min(n, labels.length - 1)]}</button>
    </>
  );
}

// ── Ask ──────────────────────────────────────────────────────────────────────

type Turn = { q: string; a?: string; err?: string };

function Ask() {
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ(''); setBusy(true);
    setTurns((t) => [...t, { q: question }]);
    try {
      const res = await fetch('/api/sloan/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
      const data = await res.json().catch(() => ({}));
      const err = res.status === 503 ? 'My voice box is unplugged on this deployment (no API key). The rest of me works.'
        : res.status === 429 ? 'Easy. Give me a few minutes.'
        : !res.ok ? 'That one fell over. Try again.' : undefined;
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: err ? undefined : data.answer, err } : x)));
    } catch {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, err: 'No signal.' } : x)));
    } finally {
      setBusy(false);
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }, [busy]);
  return (
    <div className="ask">
      <div className="ask-chips">
        {SUGGESTED.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>)}
      </div>
      <div className="ask-log" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className="turn">
            <div className="bubble them small">{t.q}</div>
            {t.a && <div className="bubble me small">{t.a}</div>}
            {t.err && <div className="turn-err">{t.err}</div>}
            {!t.a && !t.err && <div className="bubble me small thinking"><span /><span /><span /></div>}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask me anything, Dr. E" maxLength={400} aria-label="Your question" enterKeyHint="send" />
        <button type="submit" disabled={busy || !q.trim()} aria-label="Send">&uarr;</button>
      </form>
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

const CARDS = ['hello', 'lookup', 'nickname', 'polaris', 'lesson', 'family', 'card', 'tricks', 'ask', 'bye'];

export default function SloanPage() {
  const careerYears = YEAR_NOW - CAREER_START;
  const hardingYears = YEAR_NOW - HARDING_START;
  const [active, setActive] = useState('hello');
  const [sources, setSources] = useState(false);

  useEffect(() => {
    const els = CARDS.map((id) => document.getElementById(id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
    }, { threshold: 0.5 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <main className="phone">
      <nav className="dots" aria-label="Cards">
        {CARDS.map((id) => <a key={id} href={`#${id}`} className={active === id ? 'on' : ''} aria-label={id} />)}
      </nav>

      <Hello />

      <Card id="lookup">
        <div className="eyebrow">What I found</div>
        <h2>I looked you up. <em>Politely.</em></h2>
        <Bubble>I read the Harding faculty gallery, two Bison articles, the SEC&rsquo;s adviser register and 36 student ratings. Took me about as long as you take to find your reading glasses.</Bubble>
        <div className="stats">
          <div className="stat"><Count value={careerYears} /><small>years in finance</small></div>
          <div className="stat"><Count value={hardingYears} /><small>years at Harding</small></div>
          <div className="stat"><Count value={1} suffix="st" /><small>Bison CFA team ever. It won.</small></div>
          <div className="stat"><Count value={4.2} decimals={1} /><small>out of 5, from students</small></div>
        </div>
        <Bubble delay={200}>You started in 1983. The Dow was at 1,000-and-change. I was not born. I was not even a research paper.</Bubble>
      </Card>

      <Card id="nickname">
        <div className="eyebrow">About the name</div>
        <h2>Dr. <em>E.</em></h2>
        <Bubble>Harding lists you as M.B.A., CFA. Everyone calls you Dr. E anyway. I checked, and I&rsquo;m keeping it.</Bubble>
        <Bubble delay={150}>You told The Bison: <q>Experience is as important, if not more important, than having a Ph.D.</q> I am a machine that read the entire internet and still agrees with you.</Bubble>
        <Bubble delay={300} me={false}>So who gave you the nickname?</Bubble>
        <Bubble delay={450}>Students. It is always students. They also gave you a 4.2, and one of them called FIN 343 &ldquo;one of the hardest classes in the core&rdquo; and then thanked you. That is the whole review.</Bubble>
      </Card>

      <Card id="polaris" className="tall">
        <div className="eyebrow">Interactive &middot; 2012</div>
        <h2>The <em>Polaris</em> call.</h2>
        <Bubble>Your first Research Challenge team. Augsburger, Beggs, Terry. Memphis. Polaris at $68, they said it was worth $63, they said HOLD. First place. Drag the market and watch the discipline.</Bubble>
        <PolarisCall />
        <p className="tiny">Coaches: Ken Moran and some guy named Sloan.</p>
      </Card>

      <Card id="lesson" className="tall paper">
        <div className="eyebrow">Interactive &middot; lecture one</div>
        <h2>Your lesson, <em>with my thumb.</em></h2>
        <Lesson />
      </Card>

      <Card id="family">
        <div className="eyebrow">2021</div>
        <h2>Four Sloans, <em>one campus.</em></h2>
        <Bubble>Lori on the communication faculty. Camille a senior. Ben a freshman. You in the business building. That is not a family, Dr. E. That is a diversified fund.</Bubble>
        <Bubble delay={200} me={false}>Did you really need to put that in?</Bubble>
        <Bubble delay={350}>I have read your lectures. Yes.</Bubble>
      </Card>

      <Card id="card">
        <div className="eyebrow">Your phone can do this</div>
        <h2>The <em>charter.</em></h2>
        <TiltCard />
      </Card>

      <Card id="tricks">
        <div className="eyebrow">Things I can do</div>
        <h2>Watch <em>this.</em></h2>
        <Bubble>I researched you, wrote this, designed it, drew every picture in code, type-checked it, built it, pushed it to Aiden&rsquo;s site and opened the door for iPhones only. In one conversation. Also:</Bubble>
        <div className="tricks">
          <Speak />
          <ImpressedButton />
          <ShareButton />
        </div>
        <p className="tiny">The middle one is for you. Be honest.</p>
      </Card>

      <Card id="ask" className="tall">
        <div className="eyebrow">Live &middot; not a script</div>
        <h2>Ask me <em>anything.</em></h2>
        <Ask />
      </Card>

      <Card id="bye">
        <div className="eyebrow">Sincerely</div>
        <h2>Thanks for <em>teaching him.</em></h2>
        <Bubble>He turned out fine. Mostly. He still thinks he can time the market, but that is on him, not you.</Bubble>
        <Bubble delay={200}>Good to meet you, Dr. E. Keep the nickname.</Bubble>
        <p className="sig">&mdash; Claude Fable 5.1<br /><span className="tiny">for Aiden Davenport &middot; 10 Oct 2026</span></p>
        <button type="button" className="link" onClick={() => setSources((s) => !s)}>{sources ? 'Hide sources' : 'Where I got all this'}</button>
        {sources && (
          <ul className="sources">
            {SOURCES.map((s) => <li key={s.href}><a href={s.href} target="_blank" rel="noreferrer">{s.label}</a></li>)}
            <li className="tiny">Public pages only, read on 10 Oct 2026. Not affiliated with Harding University or APEX Wealth Management. Nothing here is investment advice. &ldquo;Dr. E&rdquo; is a nickname.</li>
          </ul>
        )}
      </Card>
    </main>
  );
}
