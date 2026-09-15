'use client';

// X Photo — search anyone on Pauv, pick them, and get a downloadable PNG for
// posting on X. Four generators share the one picker:
//   · Price strip  — long thin ticker card (avatar · name · ticker / price /
//                    lifetime change · lifetime chart). Drawing in ./render.ts.
//   · Newly listed — 3:2 announcement card (photo · NEW LISTING · name ·
//                    starting price · call to action). ./renderListed.ts.
//   · Price change — 3:2 call-out of a big move (photo · UP/DOWN · name ·
//                    lifetime change · chart · was/now). ./renderChange.ts.
//   · Movers       — 3:2 card with three hand-picked people (face · name ·
//                    industry · sparkline · change · price). ./renderMovers.ts.
// The 3:2 cards share a frame (./card.ts) and can be drawn light or dark.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DownloadIcon, SpinnerIcon } from '@/lib/icons';
import {
  drawXPhoto, deriveChangePct, displayChangePct, formatUsd, formatPct,
  XPHOTO_EXPORT_W, XPHOTO_EXPORT_H, XPHOTO_EXPORT_SCALES,
  type XPhotoExportScale, type XPhotoPoint,
} from './render';
import { CARD_W, CARD_H, CARD_EXPORT_SCALES, formatCardDate, type CardExportScale } from './card';
import { drawListedCard } from './renderListed';
import { drawChangeCard } from './renderChange';
import { drawMoversCard, MOVERS_MAX } from './renderMovers';
import type { CardTheme } from './shared';

interface Talent {
  id: string;
  ticker: string;
  name: string;
  photo_url: string | null;
  industry: string | null;
  /** profiles.created_at — when they went live on Pauv. */
  listedAt: string | null;
  price: { usd: number | null; startUsd: number | null; lifetimeChangePct: number | null; holders: number | null };
}

type Generator = 'strip' | 'listed' | 'change' | 'movers';

const GENERATORS: { id: Generator; label: string; blurb: string }[] = [
  { id: 'strip', label: 'Price strip', blurb: 'Search anyone on Pauv, pick them, download a long thin price strip for X.' },
  { id: 'listed', label: 'Newly listed', blurb: 'Announce a fresh listing — photo, name, starting price, call to action. Newest listings first.' },
  { id: 'change', label: 'Price change', blurb: 'Call out a big move — photo, UP or DOWN, how far they have moved, and their Pauv chart.' },
  { id: 'movers', label: 'Movers', blurb: 'Three people you choose, faces first — name, industry, sparkline, change and price.' },
];

const THEMES: { id: CardTheme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const DEFAULT_CTA = 'Forecast up or down';
const MAX_RESULTS = 40;
const FONT_LINK_ID = 'gfont-xphoto';
// No scheme on purpose — the copied text is the bare "pauv.com/profile/<ticker>".
const PROFILE_URL_BASE = 'pauv.com/profile/';
const COPIED_TOAST_MS = 2500;

/** Per-person assets the cards draw: a CORS-clean photo and lifetime history. */
interface TalentAssets { photo: HTMLImageElement | null; series: XPhotoPoint[]; loading: boolean }

function profileUrl(t: { ticker: string }): string {
  return PROFILE_URL_BASE + t.ticker.toLowerCase();
}

// Listing time as epoch ms; 0 when unknown so a sort still has a number.
function listedMs(t: Talent): number {
  const ms = t.listedAt ? new Date(t.listedAt).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// The canvases draw with "Inter" / "JetBrains Mono" by family name; next/font
// registers the app's copies under hashed names, so pull the real faces from
// Google Fonts and wait for them before the first draw.
function loadFonts(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }
  return Promise.all([
    document.fonts.load('400 22px "Inter"'),
    document.fonts.load('500 30px "Inter"'),
    document.fonts.load('600 42px "Inter"'),
    document.fonts.load('700 30px "Inter"'),
    document.fonts.load('400 22px "JetBrains Mono"'),
    document.fonts.load('500 104px "JetBrains Mono"'),
  ]).then(() => undefined, () => undefined);
}

function safeFile(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'x-photo';
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Photos go through the image proxy so the canvas stays exportable.
function loadPhoto(t: Talent): Promise<HTMLImageElement | null> {
  if (!t.photo_url) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `/api/charts/image-proxy?url=${encodeURIComponent(t.photo_url!)}`;
  });
}

// Lifetime Pauv history, one slug per request (batch-history's row cap is
// shared across the slugs in a call).
async function loadHistory(t: Talent): Promise<XPhotoPoint[]> {
  try {
    const r = await fetch(`/api/markets/batch-history?slugs=${encodeURIComponent(t.ticker)}&window=all`);
    const data: Record<string, Array<{ price: number; timestamp: string }>> = await r.json();
    return (data?.[t.ticker] ?? [])
      .map(p => ({ value: p.price, timestamp: new Date(p.timestamp).getTime() }))
      .filter(p => Number.isFinite(p.value) && Number.isFinite(p.timestamp));
  } catch {
    return [];
  }
}

// The roster's lifetimeChangePct compares latest_price_cents against a p0 that
// is stored in dollars, so every value comes back ≈ +9900%. Undo the unit
// mismatch here. The cards prefer the real first→last of the history series
// and only fall back to this when there is no history.
function rosterLifetimePct(t: Talent): number | null {
  const raw = t.price.lifetimeChangePct;
  if (raw == null || !Number.isFinite(raw)) return null;
  // Rounded to a millionth of a percent: an unchanged price comes back as
  // 9899.999999999998, which unrounded reads as a tiny loss (a red, falling strip).
  return Math.round(((raw + 100) / 100 - 100) * 1e6) / 1e6;
}

// Real first→last of the lifetime history, so a figure agrees with the line
// drawn under it; the roster's figure only stands in when there is no history.
function lifetimePct(t: Talent, series: XPhotoPoint[]): number | null {
  return series.length >= 2 ? deriveChangePct(series) : rosterLifetimePct(t);
}

function nowUsdOf(t: Talent, series: XPhotoPoint[]): number | null {
  return t.price.usd ?? (series.length ? series[series.length - 1].value : null);
}

// Rank: name/ticker prefix matches first, then anything containing the query.
function scoreTalent(t: Talent, q: string): number {
  const name = t.name.toLowerCase();
  const ticker = t.ticker.toLowerCase();
  if (name.startsWith(q) || ticker.startsWith(q)) return 0;
  if (name.split(/\s+/).some(w => w.startsWith(q))) return 1;
  if (name.includes(q) || ticker.includes(q)) return 2;
  if ((t.industry ?? '').toLowerCase().includes(q)) return 3;
  return -1;
}

// Small labelled pill group — the footer's Size / Theme controls.
function Segmented<T extends string | number>({ label, options, value, onChange }: {
  label: string; options: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span>{label}</span>
      <div className="flex rounded-md border border-zinc-800 overflow-hidden">
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`px-2 h-6 text-[10px] tabular-nums transition-colors ${
              value === o.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function XPhotoSection() {
  const [talents, setTalents] = useState<Talent[]>([]);
  const [talentsLoading, setTalentsLoading] = useState(false);
  const [talentsError, setTalentsError] = useState<string | null>(null);

  const [generator, setGenerator] = useState<Generator>('strip');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Single-subject generators pick one person; Movers collects up to three.
  const [selected, setSelected] = useState<Talent | null>(null);
  const [movers, setMovers] = useState<Talent[]>([]);
  // Photo + history per ticker, loaded once per pick and kept for the session.
  const [assets, setAssets] = useState<Record<string, TalentAssets>>({});
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [stripScale, setStripScale] = useState<XPhotoExportScale>(4);
  const [cardScale, setCardScale] = useState<CardExportScale>(2);
  const [cardTheme, setCardTheme] = useState<CardTheme>('dark');
  const [cta, setCta] = useState(DEFAULT_CTA);
  const [fontsReady, setFontsReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Transient "Copied …" / "Couldn't copy" notice next to the Download button.
  const [copyNotice, setCopyNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Tickers whose assets are loading or loaded — a ref so the effect below
  // never double-fetches across renders.
  const assetsRequested = useRef(new Set<string>());

  const isMovers = generator === 'movers';
  const isListed = generator === 'listed';
  const isCard = generator !== 'strip';

  const loadTalents = useCallback(async () => {
    setTalentsLoading(true);
    setTalentsError(null);
    try {
      const r = await fetch('/api/ai/talents');
      const data = await r.json();
      if (!r.ok || !Array.isArray(data)) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setTalents(data as Talent[]);
    } catch (err) {
      setTalentsError(err instanceof Error ? err.message : String(err));
    } finally {
      setTalentsLoading(false);
    }
  }, []);

  useEffect(() => { void loadTalents(); }, [loadTalents]);
  useEffect(() => { let on = true; loadFonts().then(() => { if (on) setFontsReady(true); }); return () => { on = false; }; }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Same-origin wordmark for the cards' Pauv logo.
  useEffect(() => {
    let on = true;
    const img = new Image();
    img.onload = () => { if (on) setLogo(img); };
    img.onerror = () => { if (on) setLogo(null); };
    img.src = '/pauvlogo.png';
    return () => { on = false; };
  }, []);

  // Fetch photo + history for anyone the cards need, once per ticker.
  const ensureAssets = useCallback((t: Talent) => {
    if (assetsRequested.current.has(t.ticker)) return;
    assetsRequested.current.add(t.ticker);
    setAssets(a => ({ ...a, [t.ticker]: { photo: null, series: [], loading: true } }));
    void loadPhoto(t).then(photo => setAssets(a => ({ ...a, [t.ticker]: { ...(a[t.ticker] ?? { series: [], loading: true }), photo } })));
    void loadHistory(t).then(series => setAssets(a => ({ ...a, [t.ticker]: { ...(a[t.ticker] ?? { photo: null }), series, loading: false } })));
  }, []);

  const choose = useCallback((t: Talent) => {
    ensureAssets(t);
    setQuery('');
    setHighlight(0);
    if (generator === 'movers') {
      // Keep the picker open until the third slot is filled.
      setMovers(prev => {
        if (prev.some(m => m.id === t.id)) return prev;
        if (prev.length >= MOVERS_MAX) return prev;
        const next = [...prev, t];
        if (next.length >= MOVERS_MAX) { setOpen(false); inputRef.current?.blur(); }
        return next;
      });
      return;
    }
    setSelected(t);
    setOpen(false);
    inputRef.current?.blur();
  }, [generator, ensureAssets]);

  const removeMover = useCallback((t: Talent) => {
    setMovers(prev => prev.filter(m => m.id !== t.id));
  }, []);

  // Deep links: /x-photo?g=<generator> opens it; ?t=<ticker>[,<ticker>…]
  // preselects once the roster is in (Movers takes up to three).
  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get('g');
    if (g === 'listed' || g === 'change' || g === 'movers') setGenerator(g);
  }, []);
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !talents.length) return;
    deepLinked.current = true;
    const wants = (new URLSearchParams(window.location.search).get('t') ?? '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const hits = wants.map(w => talents.find(t => t.ticker.toLowerCase() === w)).filter((t): t is Talent => !!t);
    if (!hits.length) return;
    if (new URLSearchParams(window.location.search).get('g') === 'movers') {
      hits.slice(0, MOVERS_MAX).forEach(ensureAssets);
      setMovers(hits.slice(0, MOVERS_MAX));
    } else {
      ensureAssets(hits[0]);
      setSelected(hits[0]);
    }
  }, [talents, ensureAssets]);

  // The listing generator exists to announce whoever just went live, so with
  // no query it lists the roster newest first (and breaks search ties the
  // same way); the others keep the roster's name order.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byName = (a: Talent, b: Talent) => a.name.localeCompare(b.name);
    const newestFirst = (a: Talent, b: Talent) => listedMs(b) - listedMs(a) || byName(a, b);
    const tieBreak = generator === 'listed' ? newestFirst : byName;
    if (!q) {
      const base = generator === 'listed' ? [...talents].sort(newestFirst) : talents;
      return base.slice(0, MAX_RESULTS);
    }
    return talents
      .map(t => ({ t, s: scoreTalent(t, q) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => a.s - b.s || tieBreak(a.t, b.t))
      .slice(0, MAX_RESULTS)
      .map(x => x.t);
  }, [talents, query, generator]);

  // Keep the highlighted row scrolled into view for keyboard navigation.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selectedAssets: TalentAssets = (selected && assets[selected.ticker]) || { photo: null, series: [], loading: false };
  const series = selectedAssets.series;
  const rawPct = selected ? lifetimePct(selected, series) : null;
  const nowUsd = selected ? nowUsdOf(selected, series) : null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (generator === 'movers') {
      if (!movers.length) return;
      drawMoversCard(ctx, {
        theme: cardTheme,
        logo,
        asOf: Date.now(),
        cta,
        movers: movers.map(t => {
          const a = assets[t.ticker] ?? { photo: null, series: [], loading: false };
          return {
            name: t.name,
            industry: t.industry,
            // Same floor the strip applies, so a quiet market still draws a living line.
            changePct: displayChangePct(lifetimePct(t, a.series), t.ticker),
            nowUsd: nowUsdOf(t, a.series),
            series: a.series,
            seedKey: t.ticker,
            photo: a.photo,
          };
        }),
      });
      return;
    }
    if (!selected) return;
    if (generator === 'listed') {
      drawListedCard(ctx, {
        theme: cardTheme,
        photo: selectedAssets.photo,
        logo,
        name: selected.name,
        startUsd: selected.price.startUsd ?? selected.price.usd,
        listedAt: listedMs(selected) || null,
        cta,
        profileUrl: profileUrl(selected),
      });
      return;
    }
    if (generator === 'change') {
      drawChangeCard(ctx, {
        theme: cardTheme,
        photo: selectedAssets.photo,
        logo,
        name: selected.name,
        changePct: displayChangePct(rawPct, selected.ticker),
        fromUsd: series.length >= 2 ? series[0].value : null,
        nowUsd,
        asOf: Date.now(),
        series,
        seedKey: selected.ticker,
        profileUrl: profileUrl(selected),
      });
      return;
    }
    drawXPhoto(ctx, {
      name: selected.name,
      ticker: selected.ticker,
      priceUsd: nowUsd,
      changePct: rawPct,
      series,
      avatar: selectedAssets.photo,
      logo,
    });
  }, [selected, selectedAssets.photo, series, movers, assets, logo, rawPct, nowUsd, generator, cardTheme, cta]);

  const exportW = isCard ? CARD_W * cardScale : XPHOTO_EXPORT_W * stripScale;
  const exportH = isCard ? CARD_H * cardScale : XPHOTO_EXPORT_H * stripScale;
  // The export size is a dep because changing the canvas size wipes its bitmap.
  useEffect(() => { if (fontsReady) draw(); }, [draw, fontsReady, exportW, exportH]);

  const copyProfileLink = useCallback(async (t: Talent) => {
    const url = profileUrl(t);
    const ok = await copyText(url);
    setCopyNotice(ok ? { ok, text: `Copied ${url}` } : { ok, text: "Couldn't copy profile link" });
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyNotice(null), COPIED_TOAST_MS);
  }, []);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const hasSubject = isMovers ? movers.length > 0 : !!selected;
  const moversLoading = movers.some(t => assets[t.ticker]?.loading ?? true);
  // The listing card has no chart, so it never waits on the history.
  const waiting = isMovers ? moversLoading : (!isListed && selectedAssets.loading);
  const canDownload = hasSubject && fontsReady && !waiting && !exporting;

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSubject || exporting) return;
    // Copy first, while the click's user activation still covers the clipboard.
    // Movers has no single profile to copy.
    if (selected && !isMovers) void copyProfileLink(selected);
    setExporting(true);
    draw();
    canvas.toBlob(blob => {
      setExporting(false);
      if (!blob) return;
      const theme = isCard && cardTheme === 'light' ? '-light' : '';
      const name = isMovers
        ? `movers-${movers.map(t => t.ticker.toLowerCase()).join('-')}${theme}.png`
        : `${safeFile(selected!.name)}-${selected!.ticker.toLowerCase()}-${
            generator === 'listed' ? 'new-listing' : generator === 'change' ? 'price-change' : 'x-photo'
          }${theme}.png`;
      triggerDownload(blob, name);
    }, 'image/png');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); setHighlight(0); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const t = results[highlight]; if (t) choose(t); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const firstTs = series.length ? series[0].timestamp : null;
  const blurb = GENERATORS.find(g => g.id === generator)?.blurb ?? '';
  const scaleOptions = isCard
    ? CARD_EXPORT_SCALES.map(k => ({ id: k, label: `${CARD_W * k}×${CARD_H * k}` }))
    : XPHOTO_EXPORT_SCALES.map(k => ({ id: k, label: `${XPHOTO_EXPORT_W * k}×${XPHOTO_EXPORT_H * k}` }));

  const historyNote = selectedAssets.loading
    ? 'Loading lifetime history…'
    : series.length > 1
      ? `Lifetime · ${series.length.toLocaleString()} points since ${firstTs ? formatCardDate(firstTs) : '—'}`
      : 'No price history yet — synthesized line';

  const placeholder = isMovers
    ? (movers.length >= MOVERS_MAX ? 'Three picked — remove one to swap' : `Pick ${MOVERS_MAX - movers.length} ${movers.length ? 'more' : 'people'} — name, ticker or industry…`)
    : isListed
      ? 'Newest listings first — or search a name, ticker or industry…'
      : 'Search anyone on Pauv — name, ticker or industry…';

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="shrink-0 border-b border-zinc-900 px-6 py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-5 min-w-0">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">X Photo</h1>
              <p className="text-xs text-zinc-500 truncate">{blurb}</p>
            </div>
            {/* Generator switch — every card shares the picker below. */}
            <div className="flex rounded-md border border-zinc-800 overflow-hidden shrink-0" role="tablist" aria-label="Generator">
              {GENERATORS.map(g => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={generator === g.id}
                  data-xphoto-generator={g.id}
                  onClick={() => setGenerator(g.id)}
                  className={`px-3 h-8 text-xs font-medium transition-colors ${
                    generator === g.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {copyNotice && (
              <span className={`text-[11px] tabular-nums ${copyNotice.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {copyNotice.text}
              </span>
            )}
            <button
              type="button"
              data-xphoto-download=""
              onClick={handleDownload}
              disabled={!canDownload}
              title={selected && !isMovers ? `Downloads the PNG and copies ${profileUrl(selected)}` : undefined}
              className="flex items-center gap-2 h-9 px-4 rounded-md text-xs font-semibold bg-emerald-500 text-black hover:bg-emerald-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {exporting ? <SpinnerIcon size={14} className="animate-spin" /> : <DownloadIcon size={14} />}
              Download PNG
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[1200px] flex flex-col gap-6">
          {/* Search */}
          <div ref={searchWrapRef} className="relative">
            <div className="flex items-center gap-2.5 px-3.5 h-11 rounded-lg bg-zinc-950 border border-zinc-800 focus-within:border-zinc-600 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 shrink-0">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
                onFocus={() => { setOpen(true); setHighlight(0); }}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              {talentsLoading && <SpinnerIcon size={14} className="animate-spin text-zinc-500 shrink-0" />}
              {!talentsLoading && talents.length > 0 && (
                <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">{talents.length.toLocaleString()} people</span>
              )}
            </div>

            {open && (
              <div className="absolute left-0 right-0 top-full mt-2 z-40 rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden">
                <div ref={listRef} className="max-h-[360px] overflow-y-auto">
                  {talentsError ? (
                    <div className="flex flex-col items-center gap-2 py-6">
                      <p className="text-xs text-red-400">{talentsError}</p>
                      <button type="button" onClick={loadTalents} className="text-xs text-zinc-300 underline underline-offset-2">Retry</button>
                    </div>
                  ) : talentsLoading && !talents.length ? (
                    <p className="text-xs text-zinc-600 text-center py-6">Loading Pauv roster…</p>
                  ) : results.length === 0 ? (
                    <p className="text-xs text-zinc-600 text-center py-6">No results.</p>
                  ) : (
                    results.map((t, i) => {
                      // Same floor the strip applies, so the list agrees with the card.
                      const pct = displayChangePct(rosterLifetimePct(t), t.ticker);
                      const listed = listedMs(t);
                      const picked = isMovers && movers.some(m => m.id === t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onMouseDown={ev => ev.preventDefault()}
                          onMouseEnter={() => setHighlight(i)}
                          onClick={() => choose(t)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === highlight ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'} ${picked ? 'opacity-40' : ''}`}
                        >
                          {t.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.photo_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 bg-zinc-800" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 text-[11px] font-bold text-zinc-400">
                              {t.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-zinc-100 truncate">{t.name}{picked ? ' · picked' : ''}</p>
                            {t.industry && <p className="text-[11px] text-zinc-500 truncate">{t.industry}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] font-mono text-zinc-400">{t.ticker.toUpperCase()}</p>
                            {isListed ? (
                              // What the listing card shows: when, and the starting price.
                              <p className="text-[11px] tabular-nums">
                                <span className="text-zinc-500">{listed ? `Listed ${formatCardDate(listed)}` : 'Listing date unknown'}</span>
                                <span className="ml-1.5 text-zinc-200">{t.price.startUsd != null ? formatUsd(t.price.startUsd) : '—'}</span>
                              </p>
                            ) : (
                              <p className="text-[11px] tabular-nums">
                                <span className="text-zinc-200">{t.price.usd != null ? formatUsd(t.price.usd) : '—'}</span>
                                <span className={`ml-1.5 ${pct > 0 ? 'text-[#0CDF9D]' : 'text-[#FF4B4B]'}`}>{formatPct(pct)}</span>
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Movers: the three slots, in card order. */}
          {isMovers && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-zinc-500">
              {movers.map((t, i) => (
                <span key={t.id} className="flex items-center gap-2 pl-1 pr-2 h-8 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-200">
                  {t.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.photo_url} alt="" className="w-6 h-6 rounded-full object-cover bg-zinc-800" />
                  ) : (
                    <span className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400">{t.name.charAt(0).toUpperCase()}</span>
                  )}
                  <span className="text-zinc-500 tabular-nums">{i + 1}</span>
                  <span>{t.name}</span>
                  {assets[t.ticker]?.loading && <SpinnerIcon size={11} className="animate-spin text-zinc-500" />}
                  <button
                    type="button"
                    onClick={() => removeMover(t)}
                    aria-label={`Remove ${t.name}`}
                    className="text-zinc-500 hover:text-zinc-200 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
              {movers.length < MOVERS_MAX && (
                <span>{movers.length ? `${MOVERS_MAX - movers.length} more to go` : 'Pick three people — they read left to right in this order.'}</span>
              )}
              {movers.length > 0 && (
                <button type="button" onClick={() => setMovers([])} className="ml-auto text-zinc-500 hover:text-zinc-200 transition-colors">Clear</button>
              )}
            </div>
          )}

          {/* Preview */}
          {hasSubject ? (
            <div className="flex flex-col gap-3">
              <div className={`rounded-xl bg-zinc-950 border border-zinc-900 p-4 ${isCard ? 'w-full max-w-[880px] mx-auto' : ''}`}>
                {/* Keyed on the generator so a switch remounts the canvas at its size. */}
                <canvas
                  key={generator}
                  ref={canvasRef}
                  data-xphoto-canvas=""
                  width={exportW}
                  height={exportH}
                  className="block w-full h-auto"
                  style={{ aspectRatio: `${exportW} / ${exportH}` }}
                />
              </div>
              <div className="flex items-center justify-between gap-4 text-[11px] text-zinc-500">
                <div className="flex items-center gap-3 min-w-0">
                  {isMovers ? (
                    <span className="tabular-nums">
                      {moversLoading ? 'Loading photos and histories…' : `${movers.length} of ${MOVERS_MAX} picked · lifetime change and price for each`}
                    </span>
                  ) : selected && (
                    <>
                      <span className="text-zinc-300 truncate">{selected.name}</span>
                      <span className="font-mono text-zinc-500">{selected.ticker.toUpperCase()}</span>
                      <button
                        type="button"
                        onClick={() => void copyProfileLink(selected)}
                        title="Copy profile link"
                        className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span className="font-mono">{profileUrl(selected)}</span>
                      </button>
                      {isListed ? (
                        // Market facts stay UNDER the card — the card is the part that leaves.
                        <span className="tabular-nums">
                          {listedMs(selected) ? `Listed ${formatCardDate(listedMs(selected))}` : 'Listing date unknown'}
                          {' · '}
                          {(selected.price.startUsd ?? selected.price.usd) != null ? `Starting ${formatUsd((selected.price.startUsd ?? selected.price.usd)!)}` : 'No starting price'}
                          {' · '}
                          {selected.price.holders ?? 0} holders
                        </span>
                      ) : (
                        <span className="tabular-nums">{historyNote}</span>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {(isListed || isMovers) && (
                    <label className="flex items-center gap-1.5">
                      <span>CTA</span>
                      <input
                        value={cta}
                        onChange={e => setCta(e.target.value)}
                        placeholder="Blank to leave it off"
                        className="h-6 w-[200px] rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
                        spellCheck={false}
                      />
                    </label>
                  )}
                  {isCard && (
                    <Segmented label="Theme" options={THEMES} value={cardTheme} onChange={setCardTheme} />
                  )}
                  {isCard ? (
                    <Segmented label="Size" options={scaleOptions as { id: CardExportScale; label: string }[]} value={cardScale} onChange={setCardScale} />
                  ) : (
                    <Segmented label="Size" options={scaleOptions as { id: XPhotoExportScale; label: string }[]} value={stripScale} onChange={setStripScale} />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-20 rounded-xl border border-dashed border-zinc-800">
              <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                {isListed ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                    <rect x="2" y="4" width="20" height="16" rx="3" />
                    <path d="M2 20V4" />
                    <circle cx="7.5" cy="10" r="2.2" />
                    <path d="M4.5 17c.6-1.8 1.7-2.6 3-2.6s2.4.8 3 2.6" />
                    <path d="M14 9h5M14 13h5M14 17h3" />
                  </svg>
                ) : generator === 'change' ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                    <rect x="2" y="4" width="20" height="16" rx="3" />
                    <path d="M5 15l4-4 3 3 5-6" />
                    <path d="M14 8h3v3" />
                  </svg>
                ) : isMovers ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                    <rect x="2" y="4" width="20" height="16" rx="3" />
                    <circle cx="7" cy="10" r="2" />
                    <circle cx="12" cy="10" r="2" />
                    <circle cx="17" cy="10" r="2" />
                    <path d="M5 16h4M10 16h4M15 16h4" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                    <rect x="2" y="6" width="20" height="12" rx="4" />
                    <circle cx="7" cy="12" r="2.2" />
                    <path d="M11.5 12.5l2-1.5 1.5 2 2.5-3 2 2.5" />
                  </svg>
                )}
              </div>
              <p className="text-sm font-medium text-zinc-400">
                {isListed
                  ? 'Pick someone to announce their listing'
                  : generator === 'change'
                    ? 'Pick someone to call out their move'
                    : isMovers
                      ? 'Pick three movers'
                      : 'Pick someone to build their strip'}
              </p>
              <p className="text-xs text-zinc-600">
                {isListed
                  ? 'Photo · NEW LISTING · name · starting price · call to action — 3:2, light or dark.'
                  : generator === 'change'
                    ? 'Photo · UP or DOWN · name · how far they have moved · their Pauv chart — 3:2, light or dark.'
                    : isMovers
                      ? 'Three faces · names · industries · sparklines · change and price — 3:2, light or dark.'
                      : 'Avatar · name · ticker · price · lifetime chart — ready to download.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
