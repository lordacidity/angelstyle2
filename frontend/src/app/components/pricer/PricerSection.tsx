'use client';

// Pricer (Studio > Pricer) — the Pauv AI Pricer's page, rebuilt as a Studio section.
//
// Type a name (plus an optional hint) and six steps run on the server: a bio,
// then the social / news / industry analysts in parallel, then the judge. The
// page is driven entirely by the server-sent-event stream from
// /api/pricer/price (info, step, done, error — see src/lib/pricer/types.ts):
// each step card fills in as its result lands. Stop closes the stream, which
// the server sees and aborts the API calls. The section stays mounted across
// tab switches (StudioShell), so a run keeps going while you look elsewhere.
//
// The pricing itself is src/lib/pricer/pipeline.js, unchanged from the
// standalone; this file only renders what it emits.

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DownloadIcon } from '@/lib/icons';
import { PricerPhotos } from './PricerPhotos';
import {
  isAnalystError,
  type AnalystData, type AnalystKey, type BioData, type Confidence, type DoneEvent, type FinalData,
  type InfoEvent, type PipelineErrorEvent, type PricerConfig, type PricerRun, type PricerStep, type StepEvent,
} from '@/lib/pricer/types';

type Status = 'ready' | 'waiting' | 'running' | 'done' | 'error';
interface StepState { status: Status; label?: string; error?: string }
type Steps = Record<PricerStep, StepState>;

const STEPS: PricerStep[] = ['bio', 'social', 'news', 'industry', 'final'];
const ANALYSTS: { key: AnalystKey; label: string }[] = [
  { key: 'social', label: 'Social media' },
  { key: 'news', label: 'Recent news' },
  { key: 'industry', label: 'Industry peers' },
];
const LABELS: Record<Status, string> = { ready: 'Ready', waiting: 'Waiting', running: 'Working…', done: 'Done', error: 'Failed' };
const EVIDENCE_HEADERS: Record<AnalystKey, [string, string, string]> = {
  social: ['Account', 'Percentile band', 'Engagement'],
  news: ['Date — Outlet', 'Story', 'Sentiment'],
  industry: ['Comparable', 'Master list price', 'Relation'],
};

const idleSteps = (): Steps => ({
  bio: { status: 'waiting' }, social: { status: 'waiting' }, news: { status: 'waiting' }, industry: { status: 'waiting' }, final: { status: 'waiting' },
});
const money = (n: unknown) => (n == null || !Number.isFinite(Number(n))) ? '—' : '$' + Number(n).toFixed(2);
const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; }
};
const paragraphs = (t?: string) => String(t || '').split(/\n\s*\n|\n/).map(p => p.trim()).filter(Boolean);

// ── Small pieces ─────────────────────────────────────────────────────────────

type Tone = 'muted' | 'warn' | 'high' | 'medium' | 'low' | 'none';
const TONE: Record<Tone, string> = {
  muted: 'border-zinc-700 text-zinc-400',
  warn: 'border-red-500/70 text-red-400',
  high: 'border-emerald-500/70 text-emerald-400',
  medium: 'border-zinc-300 text-zinc-100',
  low: 'border-red-500/70 text-red-400',
  none: 'border-red-500 bg-red-500 text-white',
};
function Chip({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  );
}
const confChip = (c?: Confidence | string) => (c ? <Chip tone={c as Tone}>confidence: {c}</Chip> : null);

function Paras({ text, className = '' }: { text?: string; className?: string }) {
  return (
    <div className={`text-[13.5px] leading-relaxed text-zinc-200 ${className}`}>
      {paragraphs(text).map((p, i) => <p key={i} className="mb-2.5 last:mb-0">{p}</p>)}
    </div>
  );
}

// Which model answered, and whether it actually searched.
function ModelChip({ d, step, cfg }: { d: { model?: string }; step?: AnalystKey; cfg: PricerConfig | null }) {
  const expected = step === 'social' ? cfg?.models.social : cfg?.models.fast;
  if (!d.model || !expected || String(d.model).startsWith(expected)) return null;
  return <Chip tone="warn">answered by {d.model} — {expected} was unavailable</Chip>;
}
function FeedChip({ d }: { d: AnalystData }) {
  if (d.feed) {
    const f = d.feed;
    return (
      <Chip>
        Google News · {f.in_window}{f.capped ? '+' : ''} stor{f.in_window === 1 ? 'y' : 'ies'} in the window
        {f.days ? ` · ${f.days} day${f.days === 1 ? '' : 's'}` : ''}
        {f.obituaries_dropped ? ` · ${f.obituaries_dropped} death notice${f.obituaries_dropped === 1 ? '' : 's'} dropped` : ''}
      </Chip>
    );
  }
  if (d.source === 'web') return <Chip tone="warn">news feed unavailable — the model searched instead</Chip>;
  return null;
}
function SearchChip({ d, capped }: { d: { searched?: boolean; attempts?: number }; capped?: boolean }) {
  if (d.searched === false) return <Chip tone="warn">did not search{capped ? ' · confidence capped at low' : ''}</Chip>;
  if ((d.attempts ?? 0) > 1) return <Chip>searched on the second ask</Chip>;
  return null;
}

function Sources({ d }: { d: { sources?: { title: string; uri: string }[]; queries?: string[]; searched?: boolean; model?: string; feed?: unknown } }) {
  const n = d.sources?.length || 0;
  const searched = d.queries?.length ? ` · ${d.feed ? 'query' : 'searched'}: ${d.queries.join(' · ')}` : '';
  if (!n && !searched) {
    return (
      <div className={`mt-2 text-xs ${d.searched === false ? 'text-red-400' : 'text-zinc-500'}`}>
        {d.searched === false ? 'answered from memory, no web search' : 'no web search'} · {d.model || ''}
      </div>
    );
  }
  return (
    <details className="mt-2.5 border-t border-zinc-800 pt-2">
      <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-zinc-500 hover:text-zinc-200">
        Sources ({n}){searched}
      </summary>
      <ul className="mt-1.5 list-disc pl-5">
        {(d.sources || []).map((s, i) => (
          <li key={i} className="my-0.5 text-[13px]">
            <a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-white">{s.title}</a>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-xs text-zinc-500">{d.model || ''}</div>
    </details>
  );
}

// ── Step bodies ──────────────────────────────────────────────────────────────

function BioBody({ d, cfg }: { d: BioData; cfg: PricerConfig | null }) {
  return (
    <>
      <div className="mb-2.5 flex flex-wrap gap-2">
        <Chip>{d.industry || 'unclassified'}{d.subindustry ? ` / ${d.subindustry}` : ''}</Chip>
        <SearchChip d={d} />
        <ModelChip d={d} cfg={cfg} />
        {!d.identified && <Chip tone="warn">Not confidently identified — check the name or add a hint</Chip>}
        {!d.industry_known && <Chip tone="warn">Industry not in master list — peers step used the whole list</Chip>}
      </div>
      <div className="text-sm text-zinc-100"><strong>{d.canonical_name}</strong>{d.one_line ? ` — ${d.one_line}` : ''}</div>
      <Paras text={d.bio} className="mt-2.5" />
      <Sources d={d} />
    </>
  );
}

function EvidenceTable({ step, rows }: { step: AnalystKey; rows: AnalystData['evidence'] }) {
  if (!rows?.length) return null;
  return (
    <details open className="mt-2.5 border-t border-zinc-800 pt-2">
      <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-zinc-500 hover:text-zinc-200">Evidence ({rows.length})</summary>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full border-collapse text-[13px]">
          <thead>
            <tr>{EVIDENCE_HEADERS[step].map(h => <th key={h} className="border-b border-zinc-800 px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-zinc-500">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={i}>
                <td className="border-b border-zinc-900 px-2 py-1.5 align-top text-zinc-100">{e.label}</td>
                <td className="border-b border-zinc-900 px-2 py-1.5 align-top text-zinc-200">{e.value}</td>
                <td className="border-b border-zinc-900 px-2 py-1.5 align-top text-zinc-400">{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AnalystBody({ step, d, cfg }: { step: AnalystKey; d: AnalystData; cfg: PricerConfig | null }) {
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-3">
        <span className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums text-white">{money(d.price)}</span>
        <span className="flex flex-wrap gap-2">
          {confChip(d.confidence)}
          {d.tier && <Chip>{d.tier}</Chip>}
          {step === 'news' && <FeedChip d={d} />}
          <SearchChip d={d} capped={step === 'social'} />
          <ModelChip d={d} step={step} cfg={cfg} />
        </span>
      </div>
      {step === 'social' && d.formula && <div className="-mt-1 mb-2.5 text-xs text-zinc-500">computed: {d.formula}</div>}
      <Paras text={d.rationale} />
      <EvidenceTable step={step} rows={d.evidence} />
      <Sources d={d} />
    </>
  );
}

function FinalBody({ d, run, cfg, savedTo }: { d: FinalData; run: PricerRun; cfg: PricerConfig | null; savedTo: string }) {
  const [copied, setCopied] = useState(false);
  const copyRun = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-3">
        <span className="text-[56px] font-extrabold leading-none tracking-tight tabular-nums text-emerald-400">{money(d.price)}</span>
        {d.price_credits != null && (
          <span className="text-lg tabular-nums text-zinc-500">= {Number(d.price_credits).toLocaleString('en-US', { maximumFractionDigits: 2 })} credits</span>
        )}
        <span className="flex flex-wrap gap-2">
          {confChip(d.confidence)}
          {d.tier && <Chip>{d.tier}</Chip>}
          {d.one_band_rule_applied && <Chip tone="warn">one-band rule applied</Chip>}
          {d.online_celebrity && <Chip tone="warn">online celebrity −{d.discount_pct}%</Chip>}
        </span>
      </div>
      {d.online_celebrity && (
        <div className="-mt-1 mb-2.5 text-xs text-zinc-500">
          <s className="text-red-400">{money(d.base_price)}</s> → {money(d.price)} · streamer/gamer/online celebrity, {d.discount_pct}% off
          {d.online_celebrity_note ? ` · ${d.online_celebrity_note}` : ''}
        </div>
      )}
      <div className="my-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {ANALYSTS.map(({ key, label }) => {
          const r = run.analysts[key];
          const ok = !!r && !isAnalystError(r);
          const w = d.weights?.[key];
          const anchor = (d.anchors || []).includes(key);
          const hasW = Number.isFinite(w);
          return (
            <div key={key} className={`rounded-md border px-3 py-2.5 ${anchor ? 'border-emerald-500/70' : 'border-zinc-800'}`}>
              <div className="flex items-center justify-between gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                <span>{label}{anchor ? ' · anchor' : ''}</span>
                {ok && confChip((r as AnalystData).confidence)}
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-white">{ok ? money((r as AnalystData).price) : '—'}</div>
              <div className="text-xs text-zinc-500">{ok ? '' : 'failed · '}{hasW ? `weight ${Math.round(w)}%` : ''}</div>
              {hasW && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-zinc-900">
                  <i className={`block h-full ${anchor ? 'bg-emerald-400' : 'bg-white'}`} style={{ width: `${Math.max(0, Math.min(100, w))}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Paras text={d.rationale} />
      <div className="mt-2 text-xs text-zinc-500">
        {d.model || ''}{cfg?.creditsPerUsd ? ` · ${cfg.creditsPerUsd} credits per $1` : ' · dollars only (set PAUV_CREDITS_PER_USD to show credits)'}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={copyRun}
          className="h-8 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-400 hover:text-white"
        >
          {copied ? 'Copied' : 'Copy run JSON'}
        </button>
        {savedTo && <span className="text-xs text-zinc-500">{savedTo}</span>}
      </div>
    </>
  );
}

// ── The step card ────────────────────────────────────────────────────────────

function StepCard({ n, title, sub, state, final, children }: {
  n: number; title: string; sub?: string; state: StepState; final?: boolean; children?: ReactNode;
}) {
  const s = state.status;
  const border =
    s === 'waiting' ? 'border-zinc-900 opacity-50'
    : s === 'running' ? 'border-zinc-300'
    : s === 'error' ? 'border-red-500'
    : final && s === 'done' ? 'border-emerald-500'
    : 'border-zinc-700';
  const num =
    s === 'running' ? 'border-white bg-white text-black'
    : s === 'done' ? 'border-emerald-400 bg-emerald-400 text-black'
    : s === 'error' ? 'border-red-500 bg-red-500 text-white'
    : 'border-zinc-700 text-white';
  const status =
    s === 'running' ? 'text-white'
    : s === 'done' ? 'text-emerald-400'
    : s === 'error' ? 'text-red-400'
    : 'text-zinc-500';
  return (
    <section className={`rounded-lg border bg-zinc-950 px-5 py-4 transition-colors ${border}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded border text-[13px] font-bold tabular-nums ${num}`}>{n}</span>
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-white">
          {title}
          {sub && <span className="ml-2 text-xs font-normal text-zinc-500">{sub}</span>}
        </h2>
        <span className={`flex shrink-0 items-center gap-2 text-[11px] uppercase tracking-wider ${status}`}>
          {s === 'running' && <span className="h-2.5 w-2.5 animate-pulse bg-white" />}
          {state.label ?? LABELS[s]}
        </span>
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </section>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

interface Banner { kind: 'warn' | 'err'; lines: ReactNode[] }

export function PricerSection({ active }: { active: boolean }) {
  const [cfg, setCfg] = useState<PricerConfig | null>(null);
  const [name, setName] = useState('');
  const [hint, setHint] = useState('');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [steps, setSteps] = useState<Steps>(idleSteps);
  const [run, setRun] = useState<PricerRun | null>(null);
  const [savedTo, setSavedTo] = useState('');

  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0Ref = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Header chips: master-list size, the models, the news window.
  useEffect(() => {
    let on = true;
    fetch('/api/pricer/config')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j as PricerConfig; })
      .then(c => { if (on) setCfg(c); })
      .catch(e => { if (on) setBanner({ kind: 'err', lines: [<>Could not load the master list: {e instanceof Error ? e.message : String(e)}</>] }); });
    return () => { on = false; };
  }, []);

  useEffect(() => { if (active && !running) inputRef.current?.focus(); }, [active, running]);

  // Close the stream: on Stop, on done, on a lost connection, and on unmount.
  // The server sees the close and aborts the run's API calls.
  const finish = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRunning(false);
    setSteps(prev => {
      const next = { ...prev };
      for (const s of STEPS) if (next[s].status === 'running') next[s] = { status: 'error', label: 'Stopped' };
      return next;
    });
  }, []);
  useEffect(() => () => { esRef.current?.close(); if (timerRef.current) clearInterval(timerRef.current); }, []);

  const onStep = useCallback((d: StepEvent) => {
    if (d.status === 'running') {
      setSteps(p => ({ ...p, [d.step]: { status: 'running', label: d.note } }));
      return;
    }
    if (d.status === 'error') {
      setSteps(p => ({ ...p, [d.step]: { status: 'error', label: 'Failed', error: d.error } }));
      if (d.step !== 'final') {
        const key = d.step as AnalystKey;
        setRun(r => (r ? { ...r, analysts: { ...r.analysts, [key]: { error: d.error } } } : r));
      }
      return;
    }
    setSteps(p => ({ ...p, [d.step]: { status: 'done', label: 'Done' } }));
    setRun(r => {
      if (!r) return r;
      if (d.step === 'bio') return { ...r, bio: d.data };
      if (d.step === 'final') return { ...r, final: d.data };
      return { ...r, analysts: { ...r.analysts, [d.step]: d.data } };
    });
  }, []);

  function start(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const h = hint.trim();
    if (!n || running) return;
    esRef.current?.close();

    setRun({ input: h ? { name: n, hint: h } : { name: n }, analysts: {} });
    setSteps(idleSteps());
    setBanner(null);
    setSavedTo('');
    setRunning(true);
    t0Ref.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0Ref.current) / 1000)), 1000);

    const params = new URLSearchParams({ name: n });
    if (h) params.set('hint', h);
    const es = new EventSource(`/api/pricer/price?${params.toString()}`);
    esRef.current = es;

    es.addEventListener('info', ev => {
      const d = JSON.parse((ev as MessageEvent).data) as InfoEvent;
      const lines: ReactNode[] = [];
      if (d.existing) {
        lines.push(
          <>
            <strong>{d.existing.name}</strong> is already in the master list at <strong>{money(d.existing.listed_price)}</strong>
            {d.existing.price !== d.existing.listed_price ? ` (read as ${money(d.existing.price)} after the draw-down)` : ''}
            {' '}({d.existing.industry}{d.existing.subindustry ? ` / ${d.existing.subindustry}` : ''}). The AIs are not told this.
          </>,
        );
      }
      if (d.priced_before) {
        lines.push(
          <>
            <strong>{d.priced_before.canonical_name}</strong> was priced before, on {fmtDate(d.priced_before.priced_at)} at{' '}
            <strong>{money(d.priced_before.final_price)}</strong>
            {d.priced_before.times > 1 ? ` (${d.priced_before.times} times)` : ''}. This run starts from scratch; nothing is reused.
          </>,
        );
      }
      if (lines.length) setBanner({ kind: 'warn', lines });
    });
    es.addEventListener('step', ev => onStep(JSON.parse((ev as MessageEvent).data) as StepEvent));
    es.addEventListener('done', ev => {
      const d = JSON.parse((ev as MessageEvent).data) as DoneEvent;
      setRun(d.run);
      setSavedTo(d.logged ? 'logged to the pricing log' : 'could not write the pricing log');
      finish();
    });
    es.addEventListener('error', ev => {
      if (esRef.current !== es) return;   // already finished; the browser is just noticing the close
      const data = (ev as MessageEvent).data as string | undefined;
      if (data) {
        const d = JSON.parse(data) as PipelineErrorEvent;
        setBanner({ kind: 'err', lines: [<><strong>Pipeline failed:</strong> {d.message}</>] });
      } else if (es.readyState !== EventSource.OPEN) {
        setBanner({ kind: 'err', lines: ['Lost the connection to the server.'] });
      } else {
        return;
      }
      finish();
    });
  }

  const nameState: StepState = running ? { status: 'running', label: `Pricing ${run?.input.name ?? ''}` } : { status: 'ready' };
  const analystBody = (key: AnalystKey) => {
    const r = run?.analysts[key];
    if (steps[key].status === 'error') return <div className="text-sm text-red-400">{steps[key].error || (isAnalystError(r) ? r.error : 'Failed')}</div>;
    if (r && !isAnalystError(r)) return <AnalystBody step={key} d={r} cfg={cfg} />;
    return null;
  };

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="shrink-0 border-b border-zinc-900 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Pricer</h1>
            <p className="text-xs text-zinc-500">Type a name and six steps price them against the master list: a bio, three analysts in parallel, a judge. A free-to-use photo of them is found on the left.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {cfg && <Chip>{cfg.models.fast} · {cfg.models.social} (social) · {cfg.models.judge} (judge)</Chip>}
            {cfg && <Chip>{cfg.count.toLocaleString()} people in master list{cfg.creditsPerUsd ? ` · ${cfg.creditsPerUsd} credits/$` : ''}</Chip>}
            <a
              href="/api/pricer/log"
              title="Download every completed pricing as a CSV"
              className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
            >
              <DownloadIcon size={13} />
              Pricing log
            </a>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Free-to-use photos of whoever is being priced, cropped square and downloaded under their name. */}
        <PricerPhotos person={run?.input.name ?? ''} />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4">
          <StepCard n={1} title="Name" state={nameState}>
            <form onSubmit={start} autoComplete="off" className="grid gap-3">
              <label className="grid gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                Name
                <input
                  ref={inputRef}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  placeholder="e.g. Tate McRae"
                  className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-[15px] normal-case tracking-normal text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500"
                />
              </label>
              <label className="grid gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                Hint (optional) — who they are; it also narrows the news search
                <input
                  value={hint}
                  onChange={e => setHint(e.target.value)}
                  placeholder="e.g. Cluely founder · or · NBA guard, Boston Celtics"
                  className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-[15px] normal-case tracking-normal text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="submit"
                  disabled={running || !name.trim()}
                  className="h-9 rounded-md bg-emerald-500 px-4 text-xs font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Price this person
                </button>
                {running && (
                  <button
                    type="button"
                    onClick={finish}
                    className="h-9 rounded-md border border-red-500/70 px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500 hover:text-white"
                  >
                    Stop
                  </button>
                )}
                {(running || run) && <span className="text-xs tabular-nums text-zinc-500">{elapsed}s</span>}
              </div>
            </form>
            {banner && (
              <div className={`mt-3 rounded-md border border-l-4 px-3.5 py-2.5 text-sm ${
                banner.kind === 'err' ? 'border-red-500 bg-red-950/40 text-zinc-100' : 'border-zinc-700 border-l-red-500 text-zinc-200'
              }`}>
                {banner.lines.map((l, i) => <p key={i} className="mt-1.5 first:mt-0">{l}</p>)}
              </div>
            )}
          </StepCard>

          <StepCard n={2} title="Bio" sub="one-page factual report · Google-grounded" state={steps.bio}>
            {steps.bio.status === 'error'
              ? <div className="text-sm text-red-400">{steps.bio.error}</div>
              : run?.bio ? <BioBody d={run.bio} cfg={cfg} /> : null}
          </StepCard>

          <StepCard
            n={3}
            title="Price from social media"
            sub={`${cfg?.models.social ?? '…'} with web search · bands + engagement · price computed from the bands`}
            state={steps.social}
          >
            {analystBody('social')}
          </StepCard>

          <StepCard
            n={4}
            title="Price from recent news"
            sub={`Google News, past ${cfg?.newsWindowDays ?? 90} days, positive and negative · little or no news counts against them`}
            state={steps.news}
          >
            {analystBody('news')}
          </StepCard>

          <StepCard n={5} title="Price from industry peers" sub="vs. master list, same industry and subindustry · no web" state={steps.industry}>
            {analystBody('industry')}
          </StepCard>

          <StepCard n={6} title="Final price" sub="judge weighs the three analysts by confidence" state={steps.final} final>
            {steps.final.status === 'error'
              ? <div className="text-sm text-red-400">{steps.final.error}</div>
              : run?.final ? <FinalBody d={run.final} run={run} cfg={cfg} savedTo={savedTo} /> : null}
          </StepCard>
        </div>
        </div>
      </div>
    </div>
  );
}
