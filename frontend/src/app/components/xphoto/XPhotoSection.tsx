'use client';

// X Photo — search anyone on Pauv, pick them, and get a long thin price strip
// (avatar · name · ticker / price / lifetime change · lifetime chart) as a
// downloadable PNG sized for posting on X. Drawing lives in ./render.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DownloadIcon, SpinnerIcon } from '@/lib/icons';
import {
  drawXPhoto, deriveChangePct, displayChangePct, formatUsd, formatPct,
  XPHOTO_EXPORT_W, XPHOTO_EXPORT_H, XPHOTO_EXPORT_SCALES,
  type XPhotoExportScale, type XPhotoPoint,
} from './render';

interface Talent {
  id: string;
  ticker: string;
  name: string;
  photo_url: string | null;
  industry: string | null;
  price: { usd: number | null; lifetimeChangePct: number | null };
}

const MAX_RESULTS = 40;
const FONT_LINK_ID = 'gfont-Inter-xphoto';

// The canvas draws with "Inter" by family name; next/font registers it under a
// hashed name, so pull the real face from Google Fonts and wait for it.
function loadInter(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=swap';
    document.head.appendChild(link);
  }
  return Promise.all([
    document.fonts.load('500 30px "Inter"'),
    document.fonts.load('600 42px "Inter"'),
    document.fonts.load('700 30px "Inter"'),
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

// The roster's lifetimeChangePct compares latest_price_cents against a p0 that
// is stored in dollars, so every value comes back ≈ +9900%. Undo the unit
// mismatch here. The strip itself prefers the real first→last of the history
// series and only falls back to this when there is no history.
function rosterLifetimePct(t: Talent): number | null {
  const raw = t.price.lifetimeChangePct;
  if (raw == null || !Number.isFinite(raw)) return null;
  return (raw + 100) / 100 - 100;
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

export function XPhotoSection() {
  const [talents, setTalents] = useState<Talent[]>([]);
  const [talentsLoading, setTalentsLoading] = useState(false);
  const [talentsError, setTalentsError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const [selected, setSelected] = useState<Talent | null>(null);
  const [series, setSeries] = useState<XPhotoPoint[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);
  // The PNG itself has rounded corners (see-through outside the card) unless
  // the user asks for black behind them.
  const [transparent, setTransparent] = useState(true);
  const [exportScale, setExportScale] = useState<XPhotoExportScale>(4);
  const [fontsReady, setFontsReady] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Bumped on every selection so a slow history/avatar fetch for a previous
  // pick can't overwrite the current one.
  const selectionSeq = useRef(0);

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
  useEffect(() => { let on = true; loadInter().then(() => { if (on) setFontsReady(true); }); return () => { on = false; }; }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Deep link: /x-photo?t=<ticker> preselects that person once the roster is in.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !talents.length) return;
    const want = new URLSearchParams(window.location.search).get('t')?.trim().toLowerCase();
    if (!want) { deepLinked.current = true; return; }
    const hit = talents.find(t => t.ticker.toLowerCase() === want);
    deepLinked.current = true;
    if (hit) choose(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talents]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return talents.slice(0, MAX_RESULTS);
    return talents
      .map(t => ({ t, s: scoreTalent(t, q) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.t.name.localeCompare(b.t.name))
      .slice(0, MAX_RESULTS)
      .map(x => x.t);
  }, [talents, query]);

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

  const choose = useCallback((t: Talent) => {
    const seq = ++selectionSeq.current;
    setSelected(t);
    setOpen(false);
    setQuery('');
    setSeries([]);
    setAvatar(null);
    inputRef.current?.blur();

    setSeriesLoading(true);
    fetch(`/api/markets/batch-history?slugs=${encodeURIComponent(t.ticker)}&window=all`)
      .then(r => r.json())
      .then((data: Record<string, Array<{ price: number; timestamp: string }>>) => {
        if (seq !== selectionSeq.current) return;
        const pts = (data?.[t.ticker] ?? [])
          .map(p => ({ value: p.price, timestamp: new Date(p.timestamp).getTime() }))
          .filter(p => Number.isFinite(p.value) && Number.isFinite(p.timestamp));
        setSeries(pts);
      })
      .catch(() => { if (seq === selectionSeq.current) setSeries([]); })
      .finally(() => { if (seq === selectionSeq.current) setSeriesLoading(false); });

    if (t.photo_url) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { if (seq === selectionSeq.current) setAvatar(img); };
      img.onerror = () => { if (seq === selectionSeq.current) setAvatar(null); };
      img.src = `/api/charts/image-proxy?url=${encodeURIComponent(t.photo_url)}`;
    }
  }, []);

  const changePct = selected
    ? (series.length >= 2 ? deriveChangePct(series) : rosterLifetimePct(selected))
    : null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !selected) return;
    drawXPhoto(ctx, {
      name: selected.name,
      ticker: selected.ticker,
      priceUsd: selected.price.usd ?? (series.length ? series[series.length - 1].value : null),
      changePct,
      series,
      avatar,
      transparent,
    });
  }, [selected, series, avatar, transparent, changePct]);

  // exportScale is a dep because changing the canvas size wipes its bitmap.
  useEffect(() => { if (fontsReady) draw(); }, [draw, fontsReady, exportScale]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas || !selected || exporting) return;
    setExporting(true);
    draw();
    canvas.toBlob(blob => {
      setExporting(false);
      if (!blob) return;
      triggerDownload(blob, `${safeFile(selected.name)}-${selected.ticker.toLowerCase()}-x-photo.png`);
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
  const canDownload = !!selected && fontsReady && !seriesLoading && !exporting;

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="shrink-0 border-b border-zinc-900 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">X Photo</h1>
            <p className="text-xs text-zinc-500">Search anyone on Pauv, pick them, download a long thin price strip for X.</p>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload}
            className="flex items-center gap-2 h-9 px-4 rounded-md text-xs font-semibold bg-emerald-500 text-black hover:bg-emerald-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {exporting ? <SpinnerIcon size={14} className="animate-spin" /> : <DownloadIcon size={14} />}
            Download PNG
          </button>
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
                placeholder="Search anyone on Pauv — name, ticker or industry…"
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
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onMouseDown={ev => ev.preventDefault()}
                          onMouseEnter={() => setHighlight(i)}
                          onClick={() => choose(t)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === highlight ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
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
                            <p className="text-sm text-zinc-100 truncate">{t.name}</p>
                            {t.industry && <p className="text-[11px] text-zinc-500 truncate">{t.industry}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] font-mono text-zinc-400">{t.ticker.toUpperCase()}</p>
                            <p className="text-[11px] tabular-nums">
                              <span className="text-zinc-200">{t.price.usd != null ? formatUsd(t.price.usd) : '—'}</span>
                              <span className={`ml-1.5 ${pct > 0 ? 'text-[#0CDF9D]' : 'text-[#FF4B4B]'}`}>{formatPct(pct)}</span>
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Preview */}
          {selected ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl bg-zinc-950 border border-zinc-900 p-4">
                <canvas
                  ref={canvasRef}
                  data-xphoto-canvas=""
                  width={XPHOTO_EXPORT_W * exportScale}
                  height={XPHOTO_EXPORT_H * exportScale}
                  className="block w-full h-auto"
                  style={{ aspectRatio: `${XPHOTO_EXPORT_W} / ${XPHOTO_EXPORT_H}` }}
                />
              </div>
              <div className="flex items-center justify-between gap-4 text-[11px] text-zinc-500">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-zinc-300 truncate">{selected.name}</span>
                  <span className="font-mono text-zinc-500">{selected.ticker.toUpperCase()}</span>
                  <span className="tabular-nums">
                    {seriesLoading
                      ? 'Loading lifetime history…'
                      : series.length > 1
                        ? `Lifetime · ${series.length.toLocaleString()} points since ${firstTs ? new Date(firstTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}`
                        : 'No price history yet — synthesized line'}
                  </span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span>Size</span>
                    <div className="flex rounded-md border border-zinc-800 overflow-hidden">
                      {XPHOTO_EXPORT_SCALES.map(k => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setExportScale(k)}
                          className={`px-2 h-6 text-[10px] tabular-nums transition-colors ${
                            exportScale === k ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {XPHOTO_EXPORT_W * k}×{XPHOTO_EXPORT_H * k}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!transparent}
                      onChange={e => setTransparent(!e.target.checked)}
                      className="accent-emerald-500"
                    />
                    <span>Black behind corners</span>
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-20 rounded-xl border border-dashed border-zinc-800">
              <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                  <rect x="2" y="6" width="20" height="12" rx="4" />
                  <circle cx="7" cy="12" r="2.2" />
                  <path d="M11.5 12.5l2-1.5 1.5 2 2.5-3 2 2.5" />
                </svg>
              </div>
              <p className="text-sm font-medium text-zinc-400">Pick someone to build their strip</p>
              <p className="text-xs text-zinc-600">Avatar · name · ticker · price · lifetime chart — ready to download.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
