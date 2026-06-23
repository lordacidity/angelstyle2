'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { VideoEntry } from '../types';
import { CAROUSEL_PREVIEW_W } from './CarouselCanvas';
import type { ChartsMarket } from './ChartsCanvas';
import { emojiSrcForChar, splitEmojiTokens } from '@/lib/emoji';
import { EmojiPicker } from './EmojiPicker';
import { AudioPicker, type PreloadedAudio } from './AudioPicker';
import { CloseIcon } from '@/lib/icons';

const CARD_W = CAROUSEL_PREVIEW_W;

// ── MarketSlot ────────────────────────────────────────────────────────────────

function MarketSlot({
  label,
  market,
  allMarkets,
  loading,
  onOpen,
  onSelect,
  onClear,
  overrideName,
  onUpdateOverrideName,
  trendsLoaded,
  onOpenPhotoPicker,
}: {
  label: string;
  market: ChartsMarket | null;
  allMarkets: ChartsMarket[];
  loading: boolean;
  onOpen: () => void;
  onSelect: (m: ChartsMarket) => void;
  onClear: () => void;
  overrideName: string;
  onUpdateOverrideName: (name: string) => void;
  trendsLoaded: boolean;
  onOpenPhotoPicker: (query: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open,  setOpen]  = useState(false);
  const [rect,  setRect]  = useState<DOMRect | null>(null);
  const anchorRef         = useRef<HTMLButtonElement>(null);
  const inputRef          = useRef<HTMLInputElement>(null);
  const dropRef           = useRef<HTMLDivElement>(null);
  const nameInputRef      = useRef<HTMLInputElement>(null);

  const filtered = allMarkets
    .filter(m => {
      const q = query.trim().toLowerCase();
      return !q || m.name.toLowerCase().includes(q) || (m.industry ?? '').toLowerCase().includes(q);
    })
    .slice(0, 50);

  const handleOpen = useCallback(() => {
    onOpen();
    const r = anchorRef.current?.getBoundingClientRect() ?? null;
    setRect(r);
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onOpen]);

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

  // ── Selected state ─────────────────────────────────────────────────────────
  if (market) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800">

        {/* Row 1: label + avatar + name input + status + clear */}
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider shrink-0 w-10">{label}</span>

          {/* Avatar — click to open photo picker */}
          <button
            type="button"
            title="Change photo"
            onClick={() => onOpenPhotoPicker(overrideName || market.name)}
            className="relative shrink-0 group focus:outline-none"
          >
            {market.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={market.photo_url} alt={market.name}
                className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300">
                {market.name.charAt(0).toUpperCase()}
              </div>
            )}
            {/* Camera overlay on hover */}
            <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
          </button>

          {/* Editable name */}
          <input
            ref={nameInputRef}
            value={overrideName}
            onChange={e => onUpdateOverrideName(e.target.value)}
            placeholder={market.name}
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
          />

          {/* Loaded badge */}
          {trendsLoaded && (
            <span className="shrink-0 text-[10px] font-semibold text-emerald-400 tracking-wider">LIVE</span>
          )}

          {/* Clear */}
          <button onClick={onClear} className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors">
            <CloseIcon size={12} />
          </button>
        </div>

        {/* Row 2: loaded hint only */}
        {trendsLoaded && (
          <div className="pl-[60px]">
            <span className="text-[10px] text-zinc-600">Google Trends · 2004 – present</span>
          </div>
        )}
      </div>
    );
  }

  // ── Empty state (search trigger) ───────────────────────────────────────────
  return (
    <>
      <button
        ref={anchorRef}
        onClick={handleOpen}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-zinc-500 transition-colors text-left"
      >
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider shrink-0 w-10">{label}</span>
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
            {loading && !allMarkets.length ? (
              <p className="text-xs text-zinc-600 text-center py-4">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4">No results.</p>
            ) : (
              filtered.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={ev => ev.preventDefault()}
                  onClick={() => { onSelect(m); setOpen(false); }}
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
  );
}

// ── Audio tracks ──────────────────────────────────────────────────────────────

// Type lives with the shared AudioPicker; re-exported here for existing importers.
export type { PreloadedAudio };

// ── ChartsInputCard ───────────────────────────────────────────────────────────

interface ChartsInputCardProps {
  entry: VideoEntry;
  onUpdateField: (field: 'caption' | 'context', value: string) => void;
  markets: [ChartsMarket | null, ChartsMarket | null];
  onUpdateMarket: (index: 0 | 1, market: ChartsMarket | null) => void;
  allMarkets: ChartsMarket[];
  marketsLoading: boolean;
  onEnsureMarkets: () => void;
  overrideNames: [string, string];
  onUpdateOverrideName: (idx: 0 | 1, name: string) => void;
  anyLoading: boolean;
  trendsLoaded: [boolean, boolean];
  trendsError: string | null;
  onStart: () => void;
  onOpenPhotoPicker: (idx: 0 | 1, query: string) => void;
  onSuggestPairs?: () => void;
  preloadedAudios: PreloadedAudio[];
  audioTrack: { label: string; url: string; durationMs: number } | null;
  onSelectAudioTrack: (track: { label: string; url: string; durationMs: number }) => void;
  onClearAudioTrack: () => void;
  onDeleteAudio: (idx: number) => void;
  onAddAudio: (track: { label: string; url: string; durationMs: number }) => void;
  onRenameAudio: (idx: number, label: string) => void;
}

export function ChartsInputCard({
  entry,
  onUpdateField,
  markets,
  onUpdateMarket,
  allMarkets,
  marketsLoading,
  onEnsureMarkets,
  overrideNames,
  onUpdateOverrideName,
  anyLoading,
  trendsLoaded,
  trendsError,
  onStart,
  onOpenPhotoPicker,
  onSuggestPairs,
  preloadedAudios,
  audioTrack,
  onSelectAudioTrack,
  onClearAudioTrack,
  onDeleteAudio,
  onAddAudio,
  onRenameAudio,
}: ChartsInputCardProps) {
  const captionRef        = useRef<HTMLTextAreaElement>(null);
  const captionOverlayRef = useRef<HTMLDivElement>(null);
  const [emojiTrigger, setEmojiTrigger] = useState<{ start: number; query: string } | null>(null);

  function detectEmojiTrigger() {
    const ta = captionRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? 0;
    const value = ta.value;
    let i = caret - 1;
    while (i >= 0 && value[i] !== '@' && !/\s/.test(value[i])) i--;
    if (i < 0 || value[i] !== '@' || (i > 0 && !/\s/.test(value[i - 1]))) {
      setEmojiTrigger(null);
      return;
    }
    setEmojiTrigger({ start: i, query: value.slice(i + 1, caret) });
  }

  function insertEmoji(char: string) {
    const ta = captionRef.current;
    if (!ta || !emojiTrigger) return;
    const caret = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, emojiTrigger.start);
    const after  = ta.value.slice(caret);
    onUpdateField('caption', before + char + after);
    setEmojiTrigger(null);
    const pos = before.length + char.length;
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos, pos); });
  }

  return (
    <div className="flex flex-col gap-2" style={{ width: CARD_W }}>
      {/* Caption + Context */}
      <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
        <div className="px-3 py-2 border-b border-zinc-800 relative">
          <div className="relative">
            <div
              ref={captionOverlayRef}
              aria-hidden
              className="absolute inset-0 z-0 pointer-events-none overflow-hidden text-sm text-white leading-relaxed"
              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' }}
            >
              {entry.caption
                ? splitEmojiTokens(entry.caption).map((tok, i) => {
                    if (tok.type === 'text') return <span key={i}>{tok.value}</span>;
                    const src = emojiSrcForChar(tok.value);
                    return src
                      ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={src} alt={tok.value} draggable={false}
                          style={{ display: 'inline-block', width: '1.25em', height: '1.25em', verticalAlign: '-0.3em' }} />
                      )
                      : <span key={i}>{tok.value}</span>;
                  })
                : null}
            </div>
            <textarea
              ref={captionRef}
              value={entry.caption}
              onChange={e => { onUpdateField('caption', e.target.value); detectEmojiTrigger(); }}
              onKeyUp={detectEmojiTrigger}
              onClick={detectEmojiTrigger}
              onScroll={() => {
                if (captionOverlayRef.current && captionRef.current)
                  captionOverlayRef.current.scrollTop = captionRef.current.scrollTop;
              }}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault();
                if (e.key === 'Escape' && emojiTrigger) { e.preventDefault(); setEmojiTrigger(null); }
              }}
              placeholder="Caption…  (type @ for emoji)"
              rows={2}
              className="relative z-10 w-full p-0 border-0 bg-transparent text-sm text-transparent caret-white placeholder-zinc-600 outline-none resize-none leading-relaxed"
            />
          </div>
          {emojiTrigger && (
            <EmojiPicker
              anchorRef={captionRef}
              query={emojiTrigger.query}
              onQueryChange={q => setEmojiTrigger(t => (t ? { ...t, query: q } : t))}
              onPick={insertEmoji}
              onClose={() => setEmojiTrigger(null)}
            />
          )}
        </div>

        <div className="px-3 py-2">
          <textarea
            value={entry.context ?? ''}
            onChange={e => onUpdateField('context', e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault(); }}
            placeholder="Context…"
            rows={2}
            className="w-full bg-transparent text-[11px] text-zinc-400 placeholder-zinc-700 outline-none resize-none leading-relaxed"
          />
        </div>
      </div>

      {/* Market pickers */}
      <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
        <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Markets</span>
          {onSuggestPairs ? (
            <button
              type="button"
              onClick={onSuggestPairs}
              className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
              </svg>
              AI Suggest
            </button>
          ) : (
            <span className="text-[10px] text-zinc-600">Select both · edit name · Start</span>
          )}
        </div>
        <div className="flex flex-col gap-2 p-2">
          {([0, 1] as const).map(idx => (
            <MarketSlot
              key={idx}
              label={idx === 0 ? '1st' : '2nd'}
              market={markets[idx]}
              allMarkets={allMarkets}
              loading={marketsLoading}
              onOpen={onEnsureMarkets}
              onSelect={m => onUpdateMarket(idx, m)}
              onClear={() => onUpdateMarket(idx, null)}
              overrideName={overrideNames[idx]}
              onUpdateOverrideName={name => onUpdateOverrideName(idx, name)}
              trendsLoaded={trendsLoaded[idx]}
              onOpenPhotoPicker={query => onOpenPhotoPicker(idx, query)}
            />
          ))}
        </div>
        {/* Shared Start button — fetches both slots at once */}
        {(markets[0] || markets[1]) && (
          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={onStart}
              disabled={anyLoading || (!markets[0] && !markets[1])}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-semibold bg-white/10 border border-white/20 text-white hover:bg-white/20 disabled:opacity-40 transition-colors"
            >
              {anyLoading && (
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
              {anyLoading ? 'Loading…' : (trendsLoaded[0] || trendsLoaded[1]) ? 'Refresh' : 'Start'}
            </button>
            {trendsError && (
              <p className="mt-1.5 text-[11px] text-red-400 text-center leading-snug">{trendsError}</p>
            )}
          </div>
        )}
      </div>

      {/* Audio track picker */}
      <AudioPicker
        preloadedAudios={preloadedAudios}
        audioTrack={audioTrack}
        onSelectAudioTrack={onSelectAudioTrack}
        onDeleteAudio={onDeleteAudio}
        onAddAudio={onAddAudio}
        onRenameAudio={onRenameAudio}
      />
    </div>
  );
}
