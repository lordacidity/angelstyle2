'use client';

// Single-market picker card for the Charts Image canvas. Extracted from
// CanvasGrid so the Carousel section's chart page can use the same card
// without importing the whole media grid. Used by:
//   - CanvasGrid (media → Charts Image mode, keyed by entry id)
//   - CarouselStudio (carousel chart-background page, same state shape)

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CAROUSEL_PREVIEW_W } from './CarouselCanvas';
import type { ChartsMarket } from './ChartsCanvas';
import { MAX_CHART_STRENGTH } from './ChartsImageCanvas';
import type { ChartsImageSubMode } from './ChartsImageCanvas';
import type { PreloadedAudio } from './ChartsInputCard';
import { AudioPicker } from './AudioPicker';
import type { VideoEntry } from '../types';
import { CloseIcon } from '@/lib/icons';

const CARD_W = CAROUSEL_PREVIEW_W;

export function ChartsImageInputCard({
  market,
  overrideName,
  allMarkets,
  marketsLoading,
  onEnsureMarkets,
  onUpdateMarket,
  onUpdateOverrideName,
  anyLoading,
  trendsLoaded,
  trendsError,
  onStart,
  onRemove,
  onOpenPhotoPicker,
  overrideIndustry,
  strength,
  noise,
  onUpdateOverrideIndustry,
  onUpdateStrength,
  onUpdateNoise,
  subMode,
  preloadedAudios,
  audioTrack,
  onSelectAudioTrack,
  onAddAudio,
  onDeleteAudio,
  onRenameAudio,
}: {
  entry: VideoEntry;
  market: ChartsMarket | null;
  overrideName: string;
  allMarkets: ChartsMarket[];
  marketsLoading: boolean;
  onEnsureMarkets: () => void;
  onUpdateMarket: (market: ChartsMarket | null) => void;
  onUpdateOverrideName: (name: string) => void;
  anyLoading: boolean;
  trendsLoaded: boolean;
  trendsError: string | null;
  onStart: () => void;
  onRemove: () => void;
  onOpenPhotoPicker: (query: string) => void;
  overrideIndustry: string;
  strength: number;
  noise: number;
  onUpdateOverrideIndustry: (v: string) => void;
  onUpdateStrength: (v: number) => void;
  onUpdateNoise: (v: number) => void;
  subMode: ChartsImageSubMode;
  preloadedAudios: PreloadedAudio[];
  audioTrack: { label: string; url: string; durationMs: number } | null;
  onSelectAudioTrack: (track: { label: string; url: string; durationMs: number }) => void;
  onAddAudio: (track: { label: string; url: string; durationMs: number }) => void;
  onDeleteAudio: (idx: number) => void;
  onRenameAudio: (idx: number, label: string) => void;
}) {
  const [query,   setQuery]   = useState('');
  const [open,    setOpen]    = useState(false);
  const [rect,    setRect]    = useState<DOMRect | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const dropRef   = useRef<HTMLDivElement>(null);

  const filtered = allMarkets
    .filter(m => {
      const q = query.trim().toLowerCase();
      return !q || m.name.toLowerCase().includes(q) || (m.industry ?? '').toLowerCase().includes(q);
    })
    .slice(0, 50);

  const handleOpen = () => {
    onEnsureMarkets();
    const r = anchorRef.current?.getBoundingClientRect() ?? null;
    setRect(r);
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const update = () => setRect(anchorRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!dropRef.current?.contains(t) && !anchorRef.current?.contains(t)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="flex flex-col gap-2" style={{ width: CARD_W }}>
      <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
        <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Market</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600">Select · edit name · Start</span>
            <button
              type="button"
              onClick={onRemove}
              className="text-zinc-700 hover:text-red-400 transition-colors"
              title="Remove"
            >
              <CloseIcon size={11} />
            </button>
          </div>
        </div>

        <div className="p-2 flex flex-col gap-2">
          {/* Market picker */}
          {market ? (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <button
                type="button"
                onClick={() => onOpenPhotoPicker(market.name)}
                className="shrink-0 rounded-full ring-2 ring-transparent hover:ring-white transition-all"
                title="Change photo"
              >
                {market.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={market.photo_url} alt={market.name} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300">
                    {market.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </button>
              <input
                value={overrideName}
                onChange={e => onUpdateOverrideName(e.target.value)}
                placeholder={market.name}
                className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
              />
              {trendsLoaded && (
                <span className="shrink-0 text-[10px] font-semibold text-emerald-400 tracking-wider">LIVE</span>
              )}
              <button
                type="button"
                onClick={() => onUpdateMarket(null)}
                className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          ) : (
            <>
              <button
                ref={anchorRef}
                type="button"
                onClick={handleOpen}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-zinc-500 transition-colors text-left"
              >
                <span className="text-sm text-zinc-500">Search market…</span>
              </button>
              {open && rect && typeof document !== 'undefined' && createPortal(
                <div
                  ref={dropRef}
                  className="fixed z-[1000] rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden"
                  style={{ left: rect.left, top: rect.bottom + 4, width: rect.width }}
                >
                  <div className="p-2 border-b border-zinc-800">
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Name, ticker or industry…"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {marketsLoading && !allMarkets.length ? (
                      <p className="text-xs text-zinc-600 text-center py-4">Loading…</p>
                    ) : filtered.length === 0 ? (
                      <p className="text-xs text-zinc-600 text-center py-4">No results.</p>
                    ) : (
                      filtered.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onMouseDown={ev => ev.preventDefault()}
                          onClick={() => { onUpdateMarket(m); setOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-zinc-800 transition-colors text-left"
                        >
                          {m.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.photo_url} alt={m.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center shrink-0 text-[10px] font-bold text-zinc-300">
                              {m.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="flex-1 min-w-0 text-sm text-zinc-200 truncate">{m.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>,
                document.body,
              )}
            </>
          )}

          {/* Industry override + sentiment strength slider. The slider value IS the
              signed change % shown on the card: 0 (center, default) = flat neutral,
              right = green up move, left = red down move. The raw $ derives from it. */}
          {market && (
            <div className="flex flex-col gap-1.5">
              <input
                value={overrideIndustry}
                onChange={e => onUpdateOverrideIndustry(e.target.value)}
                placeholder={market.industry ?? 'Industry…'}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
                <span className="text-[10px] text-zinc-500 select-none shrink-0">Move</span>
                <input
                  type="range"
                  min={-MAX_CHART_STRENGTH}
                  max={MAX_CHART_STRENGTH}
                  step={0.5}
                  value={strength}
                  onChange={e => onUpdateStrength(parseFloat(e.target.value))}
                  onDoubleClick={() => onUpdateStrength(0)}
                  title="Drag right for an up move, left for a down move. Double-click to reset to flat."
                  className="flex-1 min-w-0 h-1 cursor-pointer"
                  style={{ accentColor: strength === 0 ? '#71717a' : strength > 0 ? '#0CDF9D' : '#FF4B4B' }}
                />
                <span
                  className={`text-[11px] font-semibold tabular-nums w-16 text-right shrink-0 select-none ${
                    strength === 0 ? 'text-zinc-500' : strength > 0 ? 'text-[#0CDF9D]' : 'text-[#FF4B4B]'
                  }`}
                >
                  {strength === 0 ? 'Flat' : `${strength > 0 ? '▲' : '▼'} ${Math.abs(strength).toFixed(1)}%`}
                </span>
              </div>
              {/* Noise — 0–100 slider for how much synthetic volatility to add to
                  the line. 0 (default) = clean; 100 = way past the old presets. */}
              <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
                <span className="text-[10px] text-zinc-500 select-none shrink-0">Noise</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={noise}
                  onChange={e => onUpdateNoise(parseFloat(e.target.value))}
                  onDoubleClick={() => onUpdateNoise(0)}
                  title="How much synthetic volatility to add to the line. Double-click to reset."
                  className="flex-1 min-w-0 h-1 cursor-pointer"
                  style={{ accentColor: noise === 0 ? '#71717a' : '#e4e4e7' }}
                />
                <span
                  className={`text-[11px] font-semibold tabular-nums w-16 text-right shrink-0 select-none ${
                    noise === 0 ? 'text-zinc-500' : 'text-zinc-200'
                  }`}
                >
                  {noise === 0 ? 'Off' : noise}
                </span>
              </div>
            </div>
          )}

          {/* Start button */}
          {market && (
            <div className="px-0 pb-0">
              <button
                type="button"
                onClick={onStart}
                disabled={anyLoading || trendsLoaded}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-semibold bg-white/10 border border-white/20 text-white hover:bg-white/20 disabled:opacity-40 transition-colors"
              >
                {anyLoading && (
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                )}
                {anyLoading ? 'Loading…' : trendsLoaded ? 'Loaded' : 'Start'}
              </button>
              {trendsError && (
                <p className="mt-1.5 text-[11px] text-red-400 text-center leading-snug">{trendsError}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Audio track picker — only relevant in Video sub-mode (muxed into the MP4). */}
      {market && subMode === 'video' && (
        <AudioPicker
          preloadedAudios={preloadedAudios}
          audioTrack={audioTrack}
          onSelectAudioTrack={onSelectAudioTrack}
          onDeleteAudio={onDeleteAudio}
          onAddAudio={onAddAudio}
          onRenameAudio={onRenameAudio}
        />
      )}
    </div>
  );
}
