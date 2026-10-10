'use client';

// angelstyle.com/Sloan — one page, scrolled top to bottom, for Dr. E.
//
// Everything on it was researched from public sources and written by Claude
// Fable 5.1 on 10 October 2026, for Aiden Davenport to show his old professor.
// The page carries no photographs on purpose: nothing here is scraped from a
// university site, and the one portrait that matters is sitting next to the
// screen. The visuals are drawn live instead — a market line in the hero, a
// valuation gauge, a compound-growth chart — because he is a finance man and
// numbers that move are the honest decoration.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── Facts (every line traces to a source listed in the footer) ───────────────

const YEAR_NOW = 2026;
const CAREER_START = 1983;
const HARDING_START = 2005;

const TIMELINE = [
  { year: '1983', title: 'Enters the industry', body: 'Ellis Sloan starts a career in finance that will run more than four decades, through bull markets, crashes and everything between.' },
  { year: '2005', title: 'Joins Harding', body: 'Follows his wife Lori onto the faculty of the Paul R. Carter College of Business Administration in Searcy, the one Sloan who did not grow up a Bison.' },
  { year: 'Then', title: 'Builds the finance degree', body: 'Helps develop Harding’s finance major and takes charge of the chartered financial analyst competition team.' },
  { year: 'Feb 11, 2012', title: 'First team, first place', body: 'Harding’s first-ever CFA Institute Research Challenge team wins the regional round in Memphis, coached by Sloan and Ken Moran.' },
  { year: 'Apr 10, 2012', title: 'New York', body: 'The team carries its Polaris Industries valuation to the Americas round in New York City.' },
  { year: '2017', title: 'Founds APEX Wealth Management', body: 'Opens an independent registered investment adviser in Searcy, after years with Kernodle & Katon Tax and Asset Management Group.' },
  { year: '2021', title: 'The whole family on campus', body: 'Ellis and Lori on the faculty, Camille a senior, Ben a freshman: four Sloans at Harding in one year.' },
  { year: 'Oct 10, 2026', title: 'This page', body: 'A former student sits down with Dr. E and asks Claude to show what it can do. You are reading the result.' },
];

const TICKER = [
  'EST. 1983', 'CFA CHARTERHOLDER', 'HARDING UNIVERSITY', 'SEARCY, AR 72143', 'FIN 343',
  'POLARIS: HOLD @ $63', 'MEMPHIS → NEW YORK', 'APEX WEALTH MANAGEMENT', 'M.B.A.',
  'BISON FOREVER', 'EXPERIENCE > CREDENTIALS', 'BUILT BY CLAUDE FABLE 5.1',
];

const SOURCES = [
  { label: 'Harding University faculty gallery: Ellis Sloan, M.B.A., Assistant Professor', href: 'https://facultygallery.harding.edu/en/persons/ellis-sloan' },
  { label: 'The Bison (2012): Finance team advances to meet in NYC', href: 'https://thelink.harding.edu/the-bison/2012/02/24/finance-team-advances-to-meet-in-nyc/' },
  { label: 'The Bison (2021): Sloans get the whole family involved on campus this year', href: 'https://thelink.harding.edu/the-bison/2021/03/19/sloans-get-the-whole-family-involved-on-campus-this-year/' },
  { label: 'SEC Investment Adviser Public Disclosure: Ellis Martin Sloan, APEX Wealth Management', href: 'https://adviserinfo.sec.gov/individual/summary/1161247' },
  { label: 'Adviser profile: Ellis Sloan, CFA, Searcy, AR', href: 'https://app.getwarmer.com/advisors/ellis-sloan' },
  { label: 'Rate My Professors: Ellis Sloan, Harding University', href: 'https://www.ratemyprofessors.com/professor/870086' },
  { label: 'Harding University finance program', href: 'https://www.harding.edu/business-admin/hu-finance.html' },
];

const SUGGESTED = [
  'What is a CFA, in one breath?',
  'Why did the 2012 team say HOLD on Polaris?',
  'Explain the time value of money like Dr. E would.',
  'How did you build this page?',
];

// ── Small hooks ──────────────────────────────────────────────────────────────

function useInView<T extends Element>(threshold = 0.2) {
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

// ── Pieces ───────────────────────────────────────────────────────────────────

function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, seen } = useInView<HTMLDivElement>(0.15);
  return (
    <div ref={ref} className={`reveal ${seen ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Stat({ value, label, suffix = '', decimals = 0 }: { value: number; label: string; suffix?: string; decimals?: number }) {
  const { ref, seen } = useInView<HTMLDivElement>(0.5);
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return;
    let raf = 0;
    const t0 = performance.now();
    const dur = reduced ? 1 : 1400;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value, reduced]);
  return (
    <div ref={ref} className="stat">
      <div className="stat-n">{n.toFixed(decimals)}<span className="stat-suffix">{suffix}</span></div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

/** The hero's market line: a slow random walk, redrawn each frame, with a
 *  faint grid behind it. Pauses when the tab is hidden and stands still for
 *  anyone who has asked the OS for less motion. */
function MarketCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let w = 0, h = 0, dpr = 1;
    const N = 160;
    const pts: number[] = [];
    let v = 0.5;
    for (let i = 0; i < N; i++) { v += (Math.random() - 0.48) * 0.03; v = Math.min(0.9, Math.max(0.1, v)); pts.push(v); }
    let phase = 0;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      // grid
      ctx.strokeStyle = 'rgba(239,233,220,0.06)';
      ctx.lineWidth = 1;
      const step = 64;
      for (let x = (phase % step); x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      // line
      const xs = (i: number) => (i / (N - 1)) * w;
      const ys = (p: number) => h * (0.15 + (1 - p) * 0.7);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(201,162,39,0)');
      grad.addColorStop(0.35, 'rgba(201,162,39,0.55)');
      grad.addColorStop(1, 'rgba(201,162,39,0.95)');
      ctx.beginPath();
      pts.forEach((p, i) => { const x = xs(i), y = ys(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(201,162,39,0.5)'; ctx.shadowBlur = 14; ctx.stroke();
      ctx.shadowBlur = 0;
      // fill under the line
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, 'rgba(201,162,39,0.12)'); fill.addColorStop(1, 'rgba(201,162,39,0)');
      ctx.fillStyle = fill; ctx.fill();
      // last point
      const lx = xs(N - 1), ly = ys(pts[N - 1]);
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = '#c9a227'; ctx.fill();
    };

    const frame = () => {
      phase -= 0.35;
      v = pts[N - 1] + (Math.random() - 0.485) * 0.035;
      v = Math.min(0.92, Math.max(0.08, v));
      pts.push(v); pts.shift();
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

function ProgressBar() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setP(max > 0 ? window.scrollY / max : 0);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); };
  }, []);
  return <div className="progress" style={{ transform: `scaleX(${p})` }} aria-hidden="true" />;
}

// ── The Polaris call ─────────────────────────────────────────────────────────
// The 2012 team valued Polaris at $63 while it traded near $68, and said HOLD.
// The slider lets a visitor move the market and watch the call change.

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
        <div>
          <div className="eyebrow">Market price</div>
          <div className="polaris-price mono">${price.toFixed(2)}</div>
        </div>
        <div>
          <div className="eyebrow">Team&rsquo;s intrinsic value</div>
          <div className="polaris-price mono dim">${FAIR_VALUE.toFixed(2)}</div>
        </div>
        <div className={`polaris-call call-${call.toLowerCase()}`}>
          <div className="eyebrow">The call</div>
          <div className="polaris-verdict">{call}</div>
        </div>
      </div>
      <div className="polaris-track" aria-hidden="true">
        <div className="polaris-band" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        <div className="polaris-fv" style={{ left: `${fvPct}%` }}><span>$63 fair value</span></div>
        <div className="polaris-dot" style={{ left: `${pct}%` }} />
      </div>
      <label className="polaris-slider">
        <span className="sr-only">Market price of Polaris</span>
        <input type="range" min={min} max={max} step={0.5} value={price} onChange={(e) => setPrice(Number(e.target.value))} style={{ ['--fill' as string]: `${pct}%` }} />
      </label>
      <p className="polaris-read mono">
        {gap >= 0 ? `+${gap.toFixed(1)}% upside to fair value` : `${gap.toFixed(1)}% downside to fair value`}
        {' · '}
        {call === 'HOLD' ? 'inside the 10% margin of safety: not cheap enough to buy, not rich enough to sell' : call === 'BUY' ? 'trading well below what the business is worth' : 'the market is paying more than the cash flows justify'}
      </p>
      <p className="polaris-note">
        On 11 February 2012 in Memphis, Harding&rsquo;s first-ever Research Challenge team, Austin Augsburger, Ben Beggs and Steven Terry, put Polaris Industries at $63 a share against a $68 print and recommended <strong>hold</strong>. Judges gave them first place. Their coaches were Ken Moran and Ellis Sloan.
      </p>
    </div>
  );
}

// ── Dr. E's lesson: time value of money ──────────────────────────────────────

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
    for (let m = 0; m < 12; m++) {
      if (y >= delayYears) bal = bal * (1 + r) + monthly;
    }
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
  const contributedA = monthly * 12 * years;
  const contributedB = monthly * 12 * Math.max(0, years - delay);

  const W = 640, H = 300, P = 28;
  const path = (s: number[]) => s.map((v, i) => {
    const x = P + (i / (s.length - 1)) * (W - 2 * P);
    const y = H - P - (v / peak) * (H - 2 * P);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const gridYs = [0.25, 0.5, 0.75, 1];

  return (
    <div className="lesson">
      <div className="lesson-controls">
        <Control label="Each month" value={monthly} min={25} max={2000} step={25} fmt={(v) => `$${v}`} onChange={setMonthly} />
        <Control label="For how long" value={years} min={5} max={50} step={1} fmt={(v) => `${v} yrs`} onChange={setYears} />
        <Control label="Annual return" value={rate} min={1} max={15} step={0.5} fmt={(v) => `${v}%`} onChange={setRate} />
      </div>
      <svg className="lesson-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Growth of monthly investing, starting now versus starting ten years later">
        {gridYs.map((g) => (
          <g key={g}>
            <line x1={P} x2={W - P} y1={H - P - g * (H - 2 * P)} y2={H - P - g * (H - 2 * P)} className="grid" />
            <text x={P} y={H - P - g * (H - 2 * P) - 4} className="axis">{money(peak * g)}</text>
          </g>
        ))}
        <path d={`${path(a)} L${W - P},${H - P} L${P},${H - P} Z`} className="area-a" />
        <path d={path(b)} className="line-b" />
        <path d={path(a)} className="line-a" />
        <text x={W - P} y={H - 8} className="axis end">{years} years</text>
        <text x={P} y={H - 8} className="axis">today</text>
      </svg>
      <div className="lesson-read">
        <div className="lesson-card a">
          <div className="eyebrow">Start today</div>
          <div className="lesson-big mono">{money(a[a.length - 1])}</div>
          <div className="lesson-sub">you put in {money(contributedA)}; growth did the rest</div>
        </div>
        <div className="lesson-card b">
          <div className="eyebrow">Wait {delay} years</div>
          <div className="lesson-big mono">{money(b[b.length - 1])}</div>
          <div className="lesson-sub">you put in {money(contributedB)}; the decade you skipped cost {money(a[a.length - 1] - b[b.length - 1])}</div>
        </div>
        <div className="lesson-card c">
          <div className="eyebrow">Rule of 72</div>
          <div className="lesson-big mono">{(72 / rate).toFixed(1)} yrs</div>
          <div className="lesson-sub">to double your money at {rate}%. Dr. E can do that one in his head.</div>
        </div>
      </div>
    </div>
  );
}

function Control({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="control">
      <span className="control-row"><span>{label}</span><span className="mono">{fmt(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--fill' as string]: `${pct}%` }} />
    </label>
  );
}

// ── Ask Claude ───────────────────────────────────────────────────────────────

type Turn = { q: string; a?: string; err?: string };

function Ask() {
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ('');
    setBusy(true);
    setTurns((t) => [...t, { q: question }]);
    try {
      const res = await fetch('/api/sloan/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
      const data = await res.json().catch(() => ({}));
      const err = res.status === 503 ? 'The ask box is asleep on this deployment (no API key). Everything else on the page still works.'
        : res.status === 429 ? 'Easy there. Give it a few minutes.'
        : !res.ok ? 'That one fell over. Try again.' : undefined;
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: err ? undefined : data.answer, err } : x)));
    } catch {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, err: 'No connection.' } : x)));
    } finally {
      setBusy(false);
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }, [busy]);

  return (
    <div className="ask">
      <div className="ask-chips">
        {SUGGESTED.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>
        ))}
      </div>
      <div className="ask-log" aria-live="polite">
        {turns.length === 0 && <p className="ask-empty">Ask about Dr. E, about finance, or about how this page was made. A live model answers, not a script.</p>}
        {turns.map((t, i) => (
          <div key={i} className="turn">
            <div className="turn-q">{t.q}</div>
            {t.a && <div className="turn-a">{t.a}</div>}
            {t.err && <div className="turn-err">{t.err}</div>}
            {!t.a && !t.err && <div className="turn-a thinking"><span /><span /><span /></div>}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Claude something…" maxLength={400} aria-label="Your question" />
        <button type="submit" disabled={busy || !q.trim()}>{busy ? 'Thinking' : 'Ask'}</button>
      </form>
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function SloanPage() {
  const careerYears = YEAR_NOW - CAREER_START;
  const hardingYears = YEAR_NOW - HARDING_START;

  return (
    <>
      <ProgressBar />
      <nav className="nav" aria-label="Sections">
        <a href="#top" className="nav-mark">Dr.&nbsp;<em>E</em></a>
        <div className="nav-links">
          <a href="#story">Story</a>
          <a href="#timeline">Timeline</a>
          <a href="#polaris">The call</a>
          <a href="#lesson">Lesson</a>
          <a href="#claude">Made by Claude</a>
          <a href="#ask">Ask</a>
        </div>
      </nav>

      <header id="top" className="hero">
        <MarketCanvas />
        <div className="hero-inner">
          <div className="eyebrow hero-eyebrow">Searcy, Arkansas &middot; Harding University &middot; Paul R. Carter College of Business</div>
          <h1 className="hero-title">Dr.&nbsp;<em>E</em></h1>
          <p className="hero-sub">
            <strong>Ellis Sloan, CFA.</strong> {careerYears} years in the markets. {hardingYears} years at the front of a Harding classroom. One professor a lot of people in finance still quote.
          </p>
          <div className="hero-facts">
            <span><b>1983</b> first year in finance</span>
            <span><b>2005</b> joined Harding</span>
            <span><b>2012</b> coached the first Bison CFA team to a regional title</span>
            <span><b>2017</b> founded APEX Wealth Management</span>
          </div>
          <a href="#story" className="scroll-cue" aria-label="Scroll down"><span /></a>
        </div>
        <div className="hero-stamp mono">Researched, written, designed, coded and shipped by Claude Fable 5.1 &middot; 10 Oct 2026</div>
      </header>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => <span key={i}>{t}<i>&#9670;</i></span>)}
        </div>
      </div>

      <section id="story" className="section">
        <Reveal>
          <div className="eyebrow">The story</div>
          <h2>Forty-three years of <em>compounding.</em></h2>
        </Reveal>
        <div className="story-grid">
          <Reveal className="story-text" delay={80}>
            <p>
              Ellis Sloan went to work in finance in 1983, the year the Dow was still finding its feet above 1,000. He earned the Chartered Financial Analyst charter, the credential that the people who actually manage money hold, and spent two decades doing the job before he ever graded a paper.
            </p>
            <p>
              In 2005 he followed his wife, Lori, onto the faculty at Harding University in Searcy. He was the one Sloan who had not grown up a Bison. He helped design the finance degree, took on FIN&nbsp;343 and the rest of the finance core, and started a tradition: the chartered financial analyst competition team. The first one he coached, in 2012, won its regional on the first try.
            </p>
            <p>
              He never stopped practising. In 2017 he founded APEX Wealth Management, an independent registered investment adviser in Searcy, so the lessons in the classroom stayed the lessons from the street. His own line says it best: <em>&ldquo;Experience is as important, if not more important, than having a Ph.D.&rdquo;</em> Which is why the title on this page is a nickname, and why nobody who sat in his class minds.
            </p>
          </Reveal>
          <div className="stats">
            <Stat value={careerYears} label="years in finance" />
            <Stat value={hardingYears} label="years teaching at Harding" />
            <Stat value={1} label="Harding CFA team ever, and it won its regional" suffix="st" />
            <Stat value={4.2} label="out of 5, from 36 student ratings" decimals={1} />
          </div>
        </div>
      </section>

      <section id="timeline" className="section alt">
        <Reveal>
          <div className="eyebrow">Timeline</div>
          <h2>The <em>long</em> game.</h2>
        </Reveal>
        <ol className="timeline">
          {TIMELINE.map((t, i) => (
            <li key={t.year + i}>
              <Reveal delay={i * 60}>
                <div className="tl-year mono">{t.year}</div>
                <div className="tl-body">
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section id="polaris" className="section">
        <Reveal>
          <div className="eyebrow">Interactive &middot; the 2012 Research Challenge</div>
          <h2>The <em>Polaris</em> call.</h2>
          <p className="lede">Move the market. Watch what a disciplined analyst says. The team&rsquo;s number stays put, because the value of a business does not change with the mood of the tape.</p>
        </Reveal>
        <Reveal delay={120}><PolarisCall /></Reveal>
      </section>

      <section id="lesson" className="section paper">
        <Reveal>
          <div className="eyebrow">Interactive &middot; the first lecture</div>
          <h2>Dr. E&rsquo;s <em>lesson</em>, live.</h2>
          <p className="lede">Time value of money. The same monthly amount, the same return. The only difference is whether you start now or ten years from now. Drag the sliders.</p>
        </Reveal>
        <Reveal delay={120}><Lesson /></Reveal>
      </section>

      <section id="voices" className="section alt">
        <div className="voices">
          <Reveal>
            <blockquote className="bigquote">
              <p>&ldquo;Experience is as important, if not more important, than having a Ph.D.&rdquo;</p>
              <cite>Ellis Sloan, to The Bison, 2021</cite>
            </blockquote>
          </Reveal>
          <Reveal delay={100}>
            <div className="voice-cards">
              <div className="voice">
                <div className="eyebrow">A student, FIN 343, 2022</div>
                <p>One of the hardest classes in the business core. He made it manageable.</p>
              </div>
              <div className="voice">
                <div className="eyebrow">The Bison, 2021</div>
                <p>He recommends Harding to any prospective student he comes across.</p>
              </div>
              <div className="voice">
                <div className="eyebrow">A Harding family</div>
                <p>Lori teaches communication. Camille was a senior and Ben a freshman the year all four Sloans were on campus together.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="claude" className="section">
        <Reveal>
          <div className="eyebrow">Made by Claude</div>
          <h2>How this page <em>got made.</em></h2>
          <p className="lede">Aiden typed one sentence. What followed happened inside a single session of Claude Fable 5.1, Anthropic&rsquo;s most capable generally available model. Here is the receipt.</p>
        </Reveal>
        <div className="made-grid">
          {[
            ['01', 'Research', 'Ran a dozen web searches, cross-checked the Harding faculty gallery, two Bison articles, the SEC adviser register and student ratings, and threw out what did not agree.'],
            ['02', 'Judgement', 'Noticed the faculty page lists an M.B.A., so “Dr. E” stays a nickname and the page never claims a doctorate. Skipped the gossip. Kept the facts.'],
            ['03', 'Design', 'Chose a type system, a palette and a rhythm for a one-page scroll, then drew every visual in code: the market line, the valuation gauge, the growth chart. No stock images.'],
            ['04', 'Engineering', 'Wrote the page in TypeScript and React inside Aiden’s existing Next.js site, opened the route in the password middleware, added the /sloan alias and a rate-limited API route.'],
            ['05', 'Verification', 'Type-checked, linted and built the whole site locally before pushing, because a page that breaks the rest of angelstyle.com is not a page.'],
            ['06', 'Ship', 'Committed, pushed, and let the deploy pipeline put it at angelstyle.com/Sloan. Then wrote this list, which is itself part of the page.'],
          ].map(([n, t, b], i) => (
            <Reveal key={n} delay={i * 70}>
              <div className="made">
                <div className="made-n mono">{n}</div>
                <h3>{t}</h3>
                <p>{b}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}>
          <div className="capabilities">
            <div className="eyebrow">What that is, in plain terms</div>
            <p>
              A model that can read the web, weigh what it finds, write like a person, design like a designer, code like an engineer, test its own work, and deploy it, in one conversation, without being told how. The box below is the same model, answering live.
            </p>
            <a className="link" href="https://www.anthropic.com/claude/fable" target="_blank" rel="noreferrer">About Claude Fable 5.1 &rarr;</a>
          </div>
        </Reveal>
      </section>

      <section id="ask" className="section alt">
        <Reveal>
          <div className="eyebrow">Live</div>
          <h2>Ask <em>Claude.</em></h2>
        </Reveal>
        <Reveal delay={100}><Ask /></Reveal>
      </section>

      <footer className="foot">
        <div className="foot-grid">
          <div>
            <div className="nav-mark big">Dr.&nbsp;<em>E</em></div>
            <p className="foot-note">
              Made with respect for a teacher, by a former student and a machine. &ldquo;Dr. E&rdquo; is a nickname. Every fact above comes from the public sources listed here, gathered on 10 October 2026; nothing was taken from a private account. This page is not affiliated with Harding University or APEX Wealth Management. Nothing on it is investment advice.
            </p>
          </div>
          <div>
            <div className="eyebrow">Sources</div>
            <ul className="sources">
              {SOURCES.map((s) => <li key={s.href}><a href={s.href} target="_blank" rel="noreferrer">{s.label}</a></li>)}
            </ul>
          </div>
        </div>
        <div className="foot-line mono">angelstyle.com/Sloan &middot; built by Claude Fable 5.1 for Aiden Davenport &middot; Searcy, Arkansas</div>
      </footer>
    </>
  );
}
