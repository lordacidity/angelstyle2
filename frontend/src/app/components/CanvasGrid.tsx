'use client';

import type { MutableRefObject, Dispatch, SetStateAction, RefObject } from 'react';
import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { TikTokCanvas } from './TikTokCanvas';
import type { TikTokCanvasRef, MarketData, SparkPoint } from './TikTokCanvas';
import { ChartsCanvas } from './ChartsCanvas';
import type { ChartsCanvasRef, ChartsMarket } from './ChartsCanvas';
import { ChartsInputCard } from './ChartsInputCard';
import type { PreloadedAudio } from './ChartsInputCard';
import CarouselCanvas, { CAROUSEL_PREVIEW_W } from './CarouselCanvas';
import { CarouselSettingsPanel } from './CarouselSettingsPanel';
import { defaultCarouselSettings } from './carouselTypes';
import type { CarouselCanvasRef, CarouselSettings, CarouselBgLayerState } from './carouselTypes';
import { useCarouselTemplates } from '../hooks/useCarouselTemplates';
import type { VideoEntry, BrandProps, SlideType, VideoData, VideoMode } from '../types';
import type { RecordingState } from './TikTokCanvas/types';
import { VideoControlsBar } from './VideoControlsBar';
import { EditablePct } from './EditablePct';
import { bestVideoUrl } from '@/lib/utils';
import { EMOJIS, emojiSrc, emojiSrcForChar, splitEmojiTokens, preloadEmojiImages } from '@/lib/emoji';
import { BTN_ICON, BTN_TEXT } from '@/lib/ui-constants';
import {
  UploadIcon, ArrowRightIcon, SpinnerIcon,
  TrashIcon, CloseIcon, DownloadIcon, VideoIcon, LinkIcon, CropIcon,
} from '@/lib/icons';

const CARD_W = CAROUSEL_PREVIEW_W; // 410 — same width as canvas preview

interface Talent {
  id: string;
  ticker: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  location: string | null;
  price: {
    usd: number | null;
    lifetimeChangePct: number | null;
    holders: number | null;
    volumeLifetimeUsd: number | null;
    latestTickAt: string | null;
    frozen: boolean;
  };
}

interface CanvasGridProps {
  entries: VideoEntry[];
  canvasRefsMap: MutableRefObject<Map<string, TikTokCanvasRef>>;
  carouselRefsMap: MutableRefObject<Map<string, CarouselCanvasRef>>;
  brand: BrandProps;
  onAddRow: (carouselSlideType?: SlideType) => void;
  onRemoveRow: (id: string) => void;
  onClearAll: () => void;
  onDownloadAll: () => void;
  onHandleVideoError: (id: string) => void;
  onUpdateEntry: (id: string, field: 'url' | 'caption' | 'context', value: string) => void;
  onUpdateCarouselEntry: (id: string, field: 'imageSrc' | 'headline' | 'subheadline' | 'articleUrl', value: string) => void;
  onUpdateLocalVideo: (id: string, src: string, name: string) => void;
  onFetchVideo: (id: string) => Promise<VideoData | null>;
  onSetCarouselSubMode: (id: string, mode: 'image' | 'video') => void;
  userId: string | null;
  // Current post format + setter for the Media toolbar's format toggle
  // (Twitter / Caption / Carousel) — replaces the old template picker.
  format?: VideoMode;
  onSetFormat?: (mode: VideoMode) => void;
  settingsMap: Record<string, CarouselSettings>;
  setSettingsMap: Dispatch<SetStateAction<Record<string, CarouselSettings>>>;
  pendingAiSeed?: { imageSrc: string; headline: string; subheadline: string; subheadline2?: string; articleUrl?: string } | null;
  onAiSeedConsumed?: () => void;
  // Set to an entry id by the Board widget's send arrow — that entry is fetched
  // and advanced through the same "Next" pipeline (fetch → crop → caption/CTA).
  pendingBoardSend?: string | null;
  onBoardSendConsumed?: () => void;
  // Fired when an entry is exported, with the Phonedeck upload filename. The
  // Board flow records filename→row so a later Phonedeck push marks that row
  // Posted (export itself no longer marks anything).
  onEntryExported?: (entryId: string, fileName?: string) => void;
  // Optional — when provided, renders a back arrow in the toolbar that
  // returns the user to the AI Cards flow (headline + photo picker) for the
  // same person. Placeholder behaviour for now: re-enters the AI section.
  onBackToAi?: () => void;
}

// ── Carousel input card ───────────────────────────────────────────────────────

function CarouselInputCard({
  entry,
  onUpdateCarousel,
  onUpdateUrl,
  onUpdateLocalVideo,
  onFetch,
  onSetSubMode,
  onRemove,
}: {
  entry: VideoEntry;
  onUpdateCarousel: (field: 'imageSrc' | 'headline' | 'subheadline' | 'articleUrl', value: string) => void;
  onUpdateUrl: (url: string) => void;
  onUpdateLocalVideo: (src: string, name: string) => void;
  onFetch: () => void;
  onSetSubMode: (mode: 'image' | 'video') => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const subMode = entry.carouselSubMode ?? 'image';
  const hasLocalVideo = !!entry.localVideoSrc;

  function handleVideoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onUpdateLocalVideo(URL.createObjectURL(file), file.name);
    onUpdateUrl('');
    if (videoFileRef.current) videoFileRef.current.value = '';
  }

  function clearLocalVideo() {
    if (entry.localVideoSrc) URL.revokeObjectURL(entry.localVideoSrc);
    onUpdateLocalVideo('', '');
  }

  return (
    <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden" style={{ width: CARD_W }}>

      {/* Tab toggle row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
        {(['image', 'video'] as const).map(m => (
          <button key={m} onClick={() => onSetSubMode(m)}
            className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
              subMode === m ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >{m}</button>
        ))}
        <button onClick={onRemove} className="ml-auto flex items-center justify-center w-7 h-7 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors" title="Delete row">
          <TrashIcon size={13} />
        </button>
      </div>

      {/* Image / Video input row */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-zinc-800">
        {subMode === 'image' ? (
          <>
            {entry.imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.imageSrc} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
            ) : (
              <div className="flex items-center gap-2 flex-1 min-w-0 border border-zinc-700 rounded-md px-2.5 h-9 text-zinc-500">
                <ImagePlaceholderIcon />
                <span className="text-sm text-zinc-600">Upload image…</span>
              </div>
            )}
            <button onClick={() => fileRef.current?.click()} title="Upload image"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
              <UploadIcon stroke="black" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (entry.imageSrc?.startsWith('blob:')) URL.revokeObjectURL(entry.imageSrc);
                onUpdateCarousel('imageSrc', URL.createObjectURL(f));
              }}
            />
          </>
        ) : hasLocalVideo ? (
          <>
            <VideoIcon className="text-zinc-400 shrink-0" size={13} />
            <span className="text-sm text-zinc-300 truncate flex-1 min-w-0">{entry.localVideoName || 'Uploaded video'}</span>
            <button onClick={() => videoFileRef.current?.click()} title="Change video"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
              <UploadIcon stroke="black" />
            </button>
            <button onClick={clearLocalVideo} title="Remove video"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
              <CloseIcon size={13} stroke="black" />
            </button>
            <input ref={videoFileRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0 border border-zinc-700 rounded-md px-2.5 h-9">
              <LinkIcon size={13} className="text-zinc-500 shrink-0" />
              <input
                value={entry.url}
                onChange={e => onUpdateUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onFetch(); }}
                placeholder="Paste TikTok, Instagram or X URL…"
                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0"
              />
            </div>
            <button onClick={() => videoFileRef.current?.click()} title="Upload video file"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
              <UploadIcon stroke="black" />
            </button>
            <button
              onClick={onFetch}
              disabled={entry.loading || !entry.url.trim()}
              title="Fetch video"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {entry.loading
                ? <SpinnerIcon stroke="black" style={{ animation: 'spin 1s linear infinite' }} />
                : <ArrowRightIcon stroke="black" />}
            </button>
            <input ref={videoFileRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />
            {entry.error && <span className="text-[11px] text-red-400 ml-1">{entry.error}</span>}
          </>
        )}
      </div>

      {/* Source article — small + muted, sits above the headline so the user
          keeps track of the story this card was built from. Main slide only —
          supporting slides inherit the same article and don't need the field
          repeated. Always editable; clickable ↗ icon appears once a URL is in. */}
      {(entry.carouselSlideType ?? 'main') === 'main' && (
        <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center gap-2">
          <LinkIcon size={11} className="text-zinc-600 shrink-0" />
          <input
            type="text"
            value={entry.articleUrl ?? ''}
            onChange={e => onUpdateCarousel('articleUrl', e.target.value)}
            placeholder="Source article link (optional)…"
            className="flex-1 bg-transparent text-[11px] text-zinc-500 placeholder-zinc-700 outline-none min-w-0"
          />
          {entry.articleUrl && (
            <a
              href={entry.articleUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
              title="Open article in new tab"
              onClick={e => e.stopPropagation()}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          )}
        </div>
      )}

      {/* Headline */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <textarea value={entry.headline ?? ''} onChange={e => onUpdateCarousel('headline', e.target.value)}
          placeholder="Headline…" rows={2}
          className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none resize-none leading-relaxed"
        />
      </div>

      {/* Sub-headline */}
      <div className="px-3 py-2">
        <textarea value={entry.subheadline ?? ''} onChange={e => onUpdateCarousel('subheadline', e.target.value)}
          placeholder="Sub-headline (optional)…" rows={1}
          className="w-full bg-transparent text-sm text-zinc-400 placeholder-zinc-700 outline-none resize-none leading-relaxed"
        />
      </div>

    </div>
  );
}

// Small inline SVG used only inside this file — not exported
function ImagePlaceholderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
  );
}

// ── Emoji picker (Apple glyphs) ────────────────────────────────────────────────
// Opens under the caption box when the user types "@". Pinned emoji (😂 🔥) sort
// to the front; a search box at the top filters by name/keyword. Picking inserts
// the unicode char back into the caption (replacing the "@query").

function EmojiPicker({
  anchorRef,
  query,
  onQueryChange,
  onPick,
  onClose,
}: {
  anchorRef: RefObject<HTMLTextAreaElement | null>;
  query: string;
  onQueryChange: (q: string) => void;
  onPick: (char: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Track the caption box position so the portal can sit just under it. Recompute
  // on scroll/resize so it stays anchored.
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && anchorRef.current && !anchorRef.current.contains(t)) onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onClose, anchorRef]);

  if (!rect || typeof document === 'undefined') return null;

  const q = query.trim().toLowerCase();
  const results = EMOJIS
    .filter(e => !q || e.name.toLowerCase().includes(q) || e.keywords.some(k => k.includes(q)))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  // Rendered in a portal on document.body so no ancestor's `overflow-hidden`
  // clips it — it floats on top of everything.
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[1000] rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden"
      style={{ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 300) }}
    >
      <div className="p-2 border-b border-zinc-800">
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Search emoji…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
      </div>
      <div className="p-2 max-h-[220px] overflow-y-auto">
        {results.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-4">No emoji found.</p>
        ) : (
          <div className="grid grid-cols-8 gap-1">
            {results.map(e => (
              <button
                key={e.unified}
                type="button"
                title={e.name}
                onMouseDown={ev => ev.preventDefault()}
                onClick={() => onPick(e.char)}
                className="relative flex items-center justify-center rounded-md hover:bg-zinc-800 transition-colors"
                style={{ width: 34, height: 34 }}
              >
                {e.pinned && <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-amber-400" />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={emojiSrc(e.unified)} alt={e.name} width={24} height={24} draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Video input card ──────────────────────────────────────────────────────────

function VideoInputCard({
  entry,
  onUpdateField,
  onUpdateLocalVideo,
  onFetch,
}: {
  entry: VideoEntry;
  onUpdateField: (field: 'url' | 'caption' | 'context', value: string) => void;
  onUpdateLocalVideo: (src: string, name: string) => void;
  onFetch: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasLocal = !!entry.localVideoSrc;

  // ── Emoji picker (type "@" in the caption) ──────────────────────────────────
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const captionOverlayRef = useRef<HTMLDivElement>(null);
  // When set, the picker is open: `start` is the index of the triggering "@",
  // `query` is the text typed after it (used as the search term).
  const [emojiTrigger, setEmojiTrigger] = useState<{ start: number; query: string } | null>(null);

  useEffect(() => { preloadEmojiImages(); }, []);

  // Detect an active "@word" being typed right before the caret. The "@" must be
  // at the start of the caption or follow whitespace, so emails/handles inside a
  // word don't trigger it.
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
    const after = ta.value.slice(caret);
    onUpdateField('caption', before + char + after);
    setEmojiTrigger(null);
    const pos = before.length + char.length;
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos, pos); });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onUpdateLocalVideo(URL.createObjectURL(file), file.name);
    onUpdateField('url', '');
    if (fileRef.current) fileRef.current.value = '';
  }

  function clearLocalVideo() {
    if (entry.localVideoSrc) URL.revokeObjectURL(entry.localVideoSrc);
    onUpdateLocalVideo('', '');
  }

  return (
    <div className="flex flex-col gap-2" style={{ width: CARD_W }}>

      {/* Conjoined URL + caption card */}
      <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">

        {/* URL / file row */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-zinc-800">
          {hasLocal ? (
            <>
              <VideoIcon size={13} className="text-zinc-400 shrink-0" />
              <span className="text-sm text-zinc-300 truncate flex-1 min-w-0">{entry.localVideoName || 'Uploaded video'}</span>
              <button onClick={() => fileRef.current?.click()} title="Change video"
                className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
                <UploadIcon stroke="black" />
              </button>
              <button onClick={clearLocalVideo} title="Remove video"
                className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
                <CloseIcon size={13} stroke="black" />
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-1 min-w-0 border border-zinc-700 rounded-md px-2.5 h-9">
                <LinkIcon size={13} className="text-zinc-500 shrink-0" />
                <input
                  type="url"
                  value={entry.url}
                  onChange={e => onUpdateField('url', e.target.value)}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault();
                    if (e.key === 'Enter') onFetch();
                  }}
                  placeholder="Paste TikTok, Instagram or X URL…"
                  className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
                />
              </div>
              <button onClick={() => fileRef.current?.click()} title="Upload video file"
                className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
                <UploadIcon stroke="black" />
              </button>
              <button
                onClick={onFetch}
                disabled={entry.loading || !entry.url.trim() || (!!entry.data && !entry.videoFailed)}
                title="Fetch video"
                className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {entry.loading
                  ? <SpinnerIcon stroke="black" style={{ animation: 'spin 1s linear infinite' }} />
                  : <ArrowRightIcon stroke="black" />}
              </button>
            </>
          )}
        </div>

        <div className="px-3 py-2 border-b border-zinc-800 relative">
          {/* The textarea handles editing/caret/selection but renders OS (blob)
              emoji, so its text is made transparent and an aligned overlay behind
              it paints the same text with Apple emoji PNGs. */}
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
              onScroll={() => { if (captionOverlayRef.current && captionRef.current) captionOverlayRef.current.scrollTop = captionRef.current.scrollTop; }}
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

        {/* Optional context fed to the social-caption generator — background,
            vibe, the angle to take. Smaller + muted so it reads as a hint, not
            a primary input. Empty string is fine; the generator just uses URL
            title/caption when this is blank. */}
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

      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleFile} />

      {(entry.error && !hasLocal) && <span className="text-xs text-red-400 px-1">{entry.error}</span>}
    </div>
  );
}

// ── Carousel BG controls ──────────────────────────────────────────────────────

function CarouselBgControls({
  entry,
  bgState,
  settings,
  carouselRef,
  onRemoveRow,
  isCarouselVideo,
}: {
  entry: VideoEntry;
  bgState: CarouselBgLayerState;
  settings: CarouselSettings;
  carouselRef: CarouselCanvasRef | undefined;
  onRemoveRow: (id: string) => void;
  isCarouselVideo: boolean;
}) {
  const splitActive = settings.bgBlurEnabled && settings.bgBlurAmount === 0 && bgState.fgMaskReady;
  const blurActive  = settings.bgBlurEnabled && settings.bgBlurAmount > 0 && bgState.fgMaskReady;
  return (
    <div className="flex items-center gap-1.5 ml-8">
      <button onClick={() => carouselRef?.enterCropMode()} className={BTN_ICON} title="Crop">
        <CropIcon size={12} />
      </button>

      {!isCarouselVideo && (
        <>
          <button
            onClick={() => carouselRef?.toggleSplit()}
            disabled={bgState.isBgProcessing}
            title="Split layers"
            className={`${BTN_TEXT} ${
              splitActive  ? 'bg-white text-black border-white' :
              bgState.bgProcessError ? 'bg-red-900/50 text-red-400 border-red-800 hover:bg-red-900' :
              'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
            }`}
          >
            {bgState.isBgProcessing ? (
              <><SpinnerIcon size={9} style={{ animation: 'spin 1s linear infinite' }} />Processing…</>
            ) : bgState.bgProcessError ? 'Retry' : splitActive ? 'Split: On' : 'Split'}
          </button>

          {bgState.fgMaskReady && (
            <button
              onClick={() => carouselRef?.toggleBlur()}
              title="Blur background"
              className={`${BTN_TEXT} ${
                blurActive
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
              }`}
            >
              {blurActive ? 'Blur: On' : 'BG Blur'}
            </button>
          )}
        </>
      )}

      <button onClick={() => onRemoveRow(entry.id)} className={BTN_ICON} title="Delete row">
        <TrashIcon size={15} />
      </button>
    </div>
  );
}

// ── Ghost "add" card — memoized (static content, stable prop) ─────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

const GhostAddCard = memo(function GhostAddCard({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="relative flex flex-col items-center justify-center gap-3 rounded-lg bg-zinc-950 text-zinc-600 hover:text-zinc-400 transition-colors"
      style={{ width: CARD_W, minHeight: 140 }}
    >
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
        <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)"
          rx="7" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" />
      </svg>
      <div className="flex items-center justify-center w-9 h-9 rounded-full border border-dashed border-current">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
      <span className="text-sm font-medium">Add row</span>
    </button>
  );
});

const SLIDE_TYPE_LABELS: [SlideType, string][] = [
  ['main',        'Main'],
  ['supporting_1','Supporting 1'],
  ['supporting_2','Supporting 2'],
];

const CarouselAddRow = memo(function CarouselAddRow({ onAdd }: { onAdd: (type: SlideType) => void }) {
  return (
    <div className="flex gap-2" style={{ width: CARD_W }}>
      {SLIDE_TYPE_LABELS.map(([type, label]) => (
        <button
          key={type}
          onClick={() => onAdd(type)}
          className="relative flex flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-zinc-950 text-zinc-600 hover:text-zinc-400 transition-colors py-5"
        >
          <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
            <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)"
              rx="7" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" />
          </svg>
          <div className="flex items-center justify-center w-7 h-7 rounded-full border border-dashed border-current">
            <PlusIcon />
          </div>
          <span className="text-[11px] font-medium text-center leading-tight">{label}</span>
        </button>
      ))}
    </div>
  );
});

// ── CanvasGrid ────────────────────────────────────────────────────────────────

const CAROUSEL_SLIDE_TYPES: SlideType[] = ['main', 'supporting_1', 'supporting_2'];

export function CanvasGrid({
  entries, canvasRefsMap, carouselRefsMap, brand,
  onAddRow, onRemoveRow, onClearAll, onDownloadAll, onHandleVideoError,
  onUpdateEntry, onUpdateCarouselEntry, onUpdateLocalVideo,
  onFetchVideo, onSetCarouselSubMode, userId,
  format, onSetFormat,
  settingsMap, setSettingsMap,
  pendingAiSeed, onAiSeedConsumed, onBackToAi,
  pendingBoardSend, onBoardSendConsumed,
  onEntryExported,
}: CanvasGridProps) {
  const isCarousel = entries.length > 0 && entries[0].mode === 'carousel';

  const [selectedId,                setSelectedId]                = useState<string>(entries[0]?.id ?? '');
  const [scaleMap,                  setScaleMap]                  = useState<Record<string, number>>({});
  const [bgStateMap,                setBgStateMap]                = useState<Record<string, CarouselBgLayerState>>({});
  const [viewScale,                 setViewScale]                 = useState(0.9);

  // Horizontal-only position for the whole creator/generator column. The grip
  // handle slides it left/right (never resizes). Persisted so it stays put
  // across refreshes. Only the grip starts a drag, so canvas trimming and the
  // input fields are completely untouched.
  const [hOffset, setHOffset] = useState(0);
  const [hDragging, setHDragging] = useState(false);
  const hDragRef = useRef({ startX: 0, startOffset: 0 });
  const hHydratedRef = useRef(false);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('studio.creatorHOffset');
      if (v != null) { const n = parseFloat(v); if (Number.isFinite(n)) setHOffset(n); }
    } catch { /* ignore */ }
    hHydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!hHydratedRef.current) return;
    try { window.localStorage.setItem('studio.creatorHOffset', String(hOffset)); } catch { /* ignore */ }
  }, [hOffset]);
  const onCreatorGripDown = (e: React.MouseEvent) => {
    e.preventDefault();
    hDragRef.current = { startX: e.clientX, startOffset: hOffset };
    setHDragging(true);
  };
  useEffect(() => {
    if (!hDragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - hDragRef.current.startX;
      // Clamp so the column can't be dragged fully off-screen.
      const limit = Math.max(120, (window.innerWidth - 72) / 2);
      const next = Math.max(-limit, Math.min(limit, hDragRef.current.startOffset + dx));
      setHOffset(next);
    };
    const onUp = () => setHDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [hDragging]);
  const [recordingStateMap,         setRecordingStateMap]         = useState<Record<string, RecordingState>>({});
  const [carouselRecordingStateMap, setCarouselRecordingStateMap] = useState<Record<string, RecordingState>>({});
  const [canvasRefVersion,          setCanvasRefVersion]          = useState(0);
  const [carouselRefVersion,        setCarouselRefVersion]        = useState(0);
  const [videoZoomMap,              setVideoZoomMap]              = useState<Record<string, number>>({});
  // Per-entry vertical anchor of the block top, as a whole-number percent (default 15).
  const [blockTopPctMap,            setBlockTopPctMap]            = useState<Record<string, number>>({});
  // Per-entry social-caption state. Keyed by entry.id. Lives in CanvasGrid
  // (not VideoEntry) because it's purely UI/transient — no need to persist or
  // round-trip through hooks.
  const [socialCaptionMap, setSocialCaptionMap] = useState<Record<string, { text: string; loading: boolean; error: string | null; copied: boolean }>>({});

  const [marketMap,               setMarketMap]               = useState<Record<string, Talent | null>>({});
  // Optional SECOND CTA person per entry. When set, the CTA card cube-rotates
  // between the primary (marketMap) and this one every few seconds. Default is
  // a single CTA (this stays null/undefined).
  const [marketMap2,              setMarketMap2]              = useState<Record<string, Talent | null>>({});
  // CTA widget size per entry: 'large' (full row w/ industry + sparkline) or
  // 'small' (one-line: photo, name, price, change). Defaults to 'small'. Shared
  // by both rotating people — the cube needs both cards the same height.
  const [marketSizeMap,           setMarketSizeMap]           = useState<Record<string, 'large' | 'small' | 'bio'>>({});
  // Per-entry "down" toggle: when on, the change renders as a LOSS — red text,
  // a down arrow, and a declining sparkline — instead of the default bullish
  // green/up treatment. `marketDownMap2` is the same for the second person, so
  // each rotating person can independently show a gain or a loss.
  const [marketDownMap,           setMarketDownMap]           = useState<Record<string, boolean>>({});
  const [marketDownMap2,          setMarketDownMap2]          = useState<Record<string, boolean>>({});
  // Global toggle controlling whether the market widget is drawn on the
  // canvas (and exported). Persisted in localStorage so flipping it off
  // applies to every video — current, future, after Clear, after refresh —
  // until the user flips it back on.
  const [marketWidgetVisible, setMarketWidgetVisible] = useState(true);
  // Per-entry collapsed state for the Market + Post Caption cards. False/
  // undefined = expanded (showing full body). True = collapsed (header only).
  // Independent from marketWidgetVisible: the card's open/closed state and
  // whether the widget actually renders on the canvas are separate concerns.
  // Persisted in localStorage so refresh + Clear leave the user's fold
  // preference alone.
  const [marketCardCollapsedMap,  setMarketCardCollapsedMap]  = useState<Record<string, boolean>>({});
  const [postCaptionCollapsedMap, setPostCaptionCollapsedMap] = useState<Record<string, boolean>>({});
  // When ON, the generated caption is auto-copied to the clipboard as soon as it
  // finishes generating (no need to press Copy). Toggled from the Post caption
  // header; persisted like the fold preferences above. The ref lets the
  // generate callback read the latest value without being a dependency.
  const [autoCopyCaption, setAutoCopyCaption] = useState(false);
  const autoCopyCaptionRef = useRef(autoCopyCaption);
  autoCopyCaptionRef.current = autoCopyCaption;
  // Safe-zone guide (the red TikTok safe/unsafe-zone overlay) shown over a video
  // canvas, toggled per entry by the control beneath the canvas. Off by default.
  const [safeZoneMap, setSafeZoneMap] = useState<Record<string, boolean>>({});
  const persistedHydratedRef = useRef(false);
  useEffect(() => {
    try {
      const m = window.localStorage.getItem('studio.marketCardCollapsed');
      if (m) setMarketCardCollapsedMap(JSON.parse(m) as Record<string, boolean>);
      const p = window.localStorage.getItem('studio.postCaptionCollapsed');
      if (p) setPostCaptionCollapsedMap(JSON.parse(p) as Record<string, boolean>);
      const v = window.localStorage.getItem('studio.marketWidgetVisible');
      if (v === 'false') setMarketWidgetVisible(false);
      const ac = window.localStorage.getItem('studio.autoCopyCaption');
      if (ac === 'true') setAutoCopyCaption(true);
    } catch { /* malformed JSON or storage disabled — silent reset to default */ }
    persistedHydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!persistedHydratedRef.current) return;
    try { window.localStorage.setItem('studio.marketCardCollapsed', JSON.stringify(marketCardCollapsedMap)); } catch { /* ignore */ }
  }, [marketCardCollapsedMap]);
  useEffect(() => {
    if (!persistedHydratedRef.current) return;
    try { window.localStorage.setItem('studio.postCaptionCollapsed', JSON.stringify(postCaptionCollapsedMap)); } catch { /* ignore */ }
  }, [postCaptionCollapsedMap]);
  useEffect(() => {
    if (!persistedHydratedRef.current) return;
    try { window.localStorage.setItem('studio.autoCopyCaption', String(autoCopyCaption)); } catch { /* ignore */ }
  }, [autoCopyCaption]);
  useEffect(() => {
    if (!persistedHydratedRef.current) return;
    try { window.localStorage.setItem('studio.marketWidgetVisible', String(marketWidgetVisible)); } catch { /* ignore */ }
  }, [marketWidgetVisible]);

  // Per-entry user overrides for the selected market's display fields
  interface MarketOverride {
    name: string; industry: string; photo_url: string | null;
    priceUsd: string; lifetimeChangePct: string;
  }
  const [marketOverrideMap, setMarketOverrideMap] = useState<Record<string, MarketOverride>>({});
  // Display-field overrides for the SECOND CTA person (mirrors marketOverrideMap).
  const [marketOverrideMap2, setMarketOverrideMap2] = useState<Record<string, MarketOverride>>({});

  // Per-entry sparkline data (fetched when a market is selected)
  const [sparklineMap, setSparklineMap] = useState<Record<string, SparkPoint[]>>({});

  // Charts mode: two selected markets per entry
  const [chartsMarketsMap,        setChartsMarketsMap]        = useState<Record<string, [ChartsMarket | null, ChartsMarket | null]>>({});
  // Per-slot name override (pre-filled with market.name, user-editable before Start)
  const [chartsNameOverrideMap,   setChartsNameOverrideMap]   = useState<Record<string, [string, string]>>({});
  // Per-slot Google Trends fetch state
  const [chartsTrendsLoadingMap,  setChartsTrendsLoadingMap]  = useState<Record<string, [boolean, boolean]>>({});
  const [chartsTrendsLoadedMap,   setChartsTrendsLoadedMap]   = useState<Record<string, [boolean, boolean]>>({});
  const [chartsTrendsErrorMap,    setChartsTrendsErrorMap]    = useState<Record<string, string | null>>({});

  // Charts recording state
  const [chartsRecordingStateMap, setChartsRecordingStateMap] = useState<Record<string, { isRecording: boolean; recProgress: number; recStatus: string }>>({});

  // Charts audio track per entry
  const [chartsAudioMap,    setChartsAudioMap]    = useState<Record<string, { label: string; url: string; durationMs: number } | null>>({});
  // Shared library of available audio tracks (loaded once from disk)
  const [preloadedAudios,   setPreloadedAudios]   = useState<PreloadedAudio[]>([]);

  // AI-suggested pairs panel
  const [aiGroups,          setAiGroups]          = useState<Array<{ a: ChartsMarket; b: ChartsMarket; reason: string }>>([]);
  const [aiGroupsLoading,   setAiGroupsLoading]   = useState(false);
  const [aiGroupsError,     setAiGroupsError]     = useState<string | null>(null);
  const [showAiGroupsPanel, setShowAiGroupsPanel] = useState(false);
  const [aiGroupsEntryId,   setAiGroupsEntryId]   = useState<string | null>(null);
  const aiGroupsFetchedRef = useRef(false);

  // Deterministic pseudo-random sparkline (LCG seeded on ticker). MARKETING:
  // a wandering line that has genuine ups AND downs but trends upward and ends
  // higher than it started — a believable rising chart, not an extreme straight
  // climb. Drawn in natural order (the canvas no longer sorts it ascending).
  function generateFallbackSparkline(ticker: string): SparkPoint[] {
    let seed = ticker.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x1234) >>> 0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
    // "Volatile climb": a rising backbone (0→1 across the series) with mean-zero
    // jitter laid ON TOP — big enough to make real up/down pullbacks, plus the
    // occasional fat-tail swing. The jitter is TAPERED to ~0 at both ends (sin
    // window), so every chart opens near its low and closes at its high → always
    // reads clearly bullish, never wanders off. Crucially the backbone is the
    // climb and the jitter is absolute (not scaled by the noise span), so the
    // swing depth is a real, tunable fraction of the full height instead of
    // cancelling out under normalization. Seeded → unique per ticker.
    const N = 13 + Math.floor(rand() * 9);            // 13..21 points → varying step width
    const wiggle = 0.34 + rand() * 0.18;              // swing depth, fraction of full height
    const vals: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = N === 1 ? 0 : i / (N - 1);            // 0..1 rising backbone
      const taper = Math.sin(Math.PI * t);            // 0 at both ends, 1 mid → pins endpoints
      let j = (rand() - 0.5) * wiggle;                // mean-zero pullback noise
      if (rand() < 0.22) j += (rand() - 0.5) * wiggle * 1.8;  // occasional bigger swing
      vals.push(t + j * taper);
    }
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const range = Math.max(1e-6, hi - lo);
    return vals.map((x, i) => ({
      value: 0.1 + ((x - lo) / range) * 0.8,          // fill [0.1, 0.9]
      timestamp: i,
    }));
  }

  // Displayed change % for the CTA widget — a stable, ticker-seeded value in the
  // 5–15% range (always rendered green/up per the marketing treatment).
  function syntheticPctForTicker(ticker: string): number {
    let seed = ticker.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x5eed) >>> 0;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return 5 + (seed / 0xffffffff) * 10; // 5..15
  }

  const fetchChartsTrends = useCallback(async (
    entryId: string,
    idx: 0 | 1,
    market: ChartsMarket,
    term: string,           // may be the user-overridden name
  ) => {
    const setLoading = (v: boolean) =>
      setChartsTrendsLoadingMap(prev => {
        const cur = [...(prev[entryId] ?? [false, false])] as [boolean, boolean];
        cur[idx] = v;
        return { ...prev, [entryId]: cur };
      });
    setLoading(true);
    setChartsTrendsErrorMap(prev => ({ ...prev, [entryId]: null }));
    try {
      const r = await fetch(`/api/charts/trends?term=${encodeURIComponent(term)}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        const msg = r.status === 429 || body.error === 'rate_limited'
          ? 'Google Trends is rate-limiting — wait a moment and try again'
          : `Failed to load trends (${r.status})`;
        setChartsTrendsErrorMap(prev => ({ ...prev, [entryId]: msg }));
        return;
      }
      const points = await r.json() as Array<{ timestamp: number; value: number }>;
      if (!Array.isArray(points) || !points.length) return;
      setChartsMarketsMap(prev => {
        const cur  = prev[entryId] ?? [null, null];
        const slot = cur[idx];
        if (!slot || slot.id !== market.id) return prev; // stale
        const next: [ChartsMarket | null, ChartsMarket | null] = [cur[0], cur[1]];
        next[idx] = { ...slot, sparkline: points };
        return { ...prev, [entryId]: next };
      });
      setChartsTrendsLoadedMap(prev => {
        const cur = [...(prev[entryId] ?? [false, false])] as [boolean, boolean];
        cur[idx] = true;
        return { ...prev, [entryId]: cur };
      });
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  const openAiGroupsPanel = useCallback(async (entryId: string) => {
    setAiGroupsEntryId(entryId);
    setShowAiGroupsPanel(true);
    if (aiGroupsFetchedRef.current) return;
    aiGroupsFetchedRef.current = true;
    setAiGroupsLoading(true);
    setAiGroupsError(null);
    try {
      const res = await fetch('/api/ai/charts-groups');
      const data = await res.json() as { groups?: Array<{ a: ChartsMarket; b: ChartsMarket; reason: string }>; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setAiGroups(data.groups ?? []);
    } catch (err) {
      aiGroupsFetchedRef.current = false;
      setAiGroupsError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiGroupsLoading(false);
    }
  }, []);

  const fetchSparkline = useCallback(async (entryId: string, ticker: string) => {
    try {
      const r = await fetch(`/api/markets/batch-history?slugs=${encodeURIComponent(ticker)}&window=all`);
      const data = await r.json() as Record<string, Array<{ price: number; timestamp: string }>>;
      const pts = data[ticker];
      if (Array.isArray(pts) && pts.length > 0) {
        setSparklineMap(prev => ({
          ...prev,
          [entryId]: pts.map(p => ({ value: p.price, timestamp: new Date(p.timestamp).getTime() })),
        }));
      }
    } catch { /* non-fatal */ }
  }, []);

  // Load audio library from disk on mount
  useEffect(() => {
    fetch('/api/charts/list-audio')
      .then(r => r.json())
      .then((tracks: Array<{ url: string; label: string; durationMs: number }>) => {
        setPreloadedAudios(tracks.map(t => ({ status: 'ready' as const, ...t })));
      })
      .catch(() => {});
  }, []);

  const handleAddAudio = useCallback((track: { label: string; url: string; durationMs: number }) => {
    setPreloadedAudios(prev => [...prev, { status: 'ready' as const, ...track }]);
  }, []);

  const handleDeleteAudio = useCallback((idx: number) => {
    setPreloadedAudios(prev => {
      const audio = prev[idx];
      if (audio?.status === 'ready' && audio.url.includes('track-custom-')) {
        fetch(`/api/charts/delete-audio?url=${encodeURIComponent(audio.url)}`, { method: 'DELETE' }).catch(() => {});
        // Clear any entry that had this track selected
        setChartsAudioMap(cur => {
          const next = { ...cur };
          for (const id of Object.keys(next)) {
            if (next[id]?.url === audio.url) next[id] = null;
          }
          return next;
        });
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const handleRenameAudio = useCallback((idx: number, label: string) => {
    setPreloadedAudios(prev => prev.map((a, i) =>
      i === idx && a.status === 'ready' ? { ...a, label } : a,
    ));
    // Keep selected track label in sync
    setChartsAudioMap(cur => {
      const audio = preloadedAudios[idx];
      if (!audio || audio.status !== 'ready') return cur;
      const next = { ...cur };
      for (const id of Object.keys(next)) {
        if (next[id]?.url === audio.url) next[id] = { ...next[id]!, label };
      }
      return next;
    });
  }, [preloadedAudios]);

  // Photo picker popup state
  interface PickerPhoto { url: string; thumbnail: string; title?: string }
  const [photoPickerEntryId,  setPhotoPickerEntryId]  = useState<string | null>(null);
  const [photoPickerPhotos,   setPhotoPickerPhotos]   = useState<PickerPhoto[]>([]);
  const [photoPickerLoading,  setPhotoPickerLoading]  = useState(false);
  const [photoPickerQuery,    setPhotoPickerQuery]    = useState('');
  const [photoPickerOffset,   setPhotoPickerOffset]   = useState(0);
  const [photoPickerMore,     setPhotoPickerMore]     = useState(false);

  const searchPickerPhotos = useCallback(async (query: string, offset: number, append: boolean) => {
    if (!query.trim()) return;
    setPhotoPickerLoading(true);
    setPhotoPickerQuery(query);
    try {
      const r = await fetch('/api/ai/photos/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, count: 9, offset }),
      });
      const fresh = await r.json() as PickerPhoto[];
      setPhotoPickerPhotos(prev => append ? [...prev, ...fresh] : fresh);
      setPhotoPickerOffset(offset + fresh.length);
    } finally { setPhotoPickerLoading(false); }
  }, []);

  const openPhotoPicker = useCallback((entryId: string, initialQuery: string) => {
    setPhotoPickerEntryId(entryId);
    setPhotoPickerPhotos([]);
    setPhotoPickerOffset(0);
    setPhotoPickerQuery(initialQuery);
    if (initialQuery.trim()) {
      setPhotoPickerLoading(true);
      fetch('/api/ai/photos/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: initialQuery, count: 9, offset: 0 }),
      }).then(r => r.json()).then((photos: PickerPhoto[]) => {
        setPhotoPickerPhotos(photos);
        setPhotoPickerOffset(photos.length);
      }).finally(() => setPhotoPickerLoading(false));
    }
  }, []);

  // Person picker popup state — lets the user manually override whoever the CTA
  // auto-pick chose. The full Pauv roster is fetched once and cached, then
  // filtered client-side by name / ticker / industry.
  const [personPickerEntryId, setPersonPickerEntryId] = useState<string | null>(null);
  // Which CTA slot the picker is choosing for: 1 = primary person, 2 = the
  // optional second (rotating) person.
  const [personPickerSlot,    setPersonPickerSlot]    = useState<1 | 2>(1);
  const [personPickerQuery,   setPersonPickerQuery]   = useState('');
  const [allTalents,          setAllTalents]          = useState<Talent[] | null>(null);
  const [talentsLoading,      setTalentsLoading]      = useState(false);
  const [talentsError,        setTalentsError]        = useState<string | null>(null);

  // Fetch the roster once and cache it. Kept out of any setState updater (side
  // effects in updaters fire twice under Strict Mode) and surfaces failures so
  // the picker can show an error + Retry instead of an empty list with no clue.
  const loadTalents = useCallback(() => {
    setTalentsError(null);
    setTalentsLoading(true);
    fetch('/api/ai/talents')
      .then(async r => {
        const data: Talent[] | { error?: string } = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(data)) {
          throw new Error((data as { error?: string })?.error || `Roster request failed (${r.status})`);
        }
        setAllTalents(data);
      })
      .catch((e: unknown) => setTalentsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setTalentsLoading(false));
  }, []);

  const openPersonPicker = useCallback((entryId: string, slot: 1 | 2 = 1) => {
    setPersonPickerEntryId(entryId);
    setPersonPickerSlot(slot);
    setPersonPickerQuery('');
    // Refetch when we have no cached roster (first open, or a prior failure).
    if (!allTalents && !talentsLoading) loadTalents();
  }, [allTalents, talentsLoading, loadTalents]);

  // Remove the second (rotating) CTA person for an entry — back to a single CTA.
  const removeSecondPerson = useCallback((entryId: string) => {
    setMarketMap2(prev => { const next = { ...prev }; delete next[entryId]; return next; });
    setMarketOverrideMap2(prev => { const next = { ...prev }; delete next[entryId]; return next; });
    setMarketDownMap2(prev => { const next = { ...prev }; delete next[entryId]; return next; });
  }, []);

  // Drop a chosen talent into the Market widget for an entry — mirrors exactly
  // what the auto-pick does so a manual override behaves identically. Then, if a
  // caption has already been generated, rewrite its closing CTA paragraph to name
  // the newly-chosen talent (the auto-pick does this on generate; a manual swap
  // must do it too, or the caption keeps naming the old person).
  const applyTalent = useCallback((entryId: string, t: Talent) => {
    // Second (rotating) person: just drop it into slot 2 + seed its overrides.
    // No caption rewrite — the post caption's CTA paragraph names the PRIMARY
    // person, which slot 2 doesn't change.
    if (personPickerSlot === 2) {
      setMarketMap2(prev => ({ ...prev, [entryId]: t }));
      setMarketOverrideMap2(prev => ({
        ...prev,
        [entryId]: {
          name: t.name, industry: t.industry ?? '',
          photo_url: t.photo_url,
          priceUsd: t.price.usd?.toFixed(2) ?? '',
          lifetimeChangePct: syntheticPctForTicker(t.ticker).toFixed(1),
        },
      }));
      setPersonPickerEntryId(null);
      return;
    }
    setMarketMap(prev => ({ ...prev, [entryId]: t }));
    setSparklineMap(prev => ({ ...prev, [entryId]: prev[entryId] ?? generateFallbackSparkline(t.ticker) }));
    fetchSparkline(entryId, t.ticker);
    setMarketOverrideMap(prev => ({
      ...prev,
      [entryId]: {
        name: t.name, industry: t.industry ?? '',
        photo_url: t.photo_url,
        priceUsd: t.price.usd?.toFixed(2) ?? '',
        lifetimeChangePct: syntheticPctForTicker(t.ticker).toFixed(1),
      },
    }));
    setPersonPickerEntryId(null);

    // Re-sync the caption's CTA paragraph to the new person (best-effort).
    const existing = socialCaptionMap[entryId]?.text;
    if (existing?.trim()) {
      setSocialCaptionMap(prev => (prev[entryId] ? { ...prev, [entryId]: { ...prev[entryId]!, loading: true, error: null } } : prev));
      fetch('/api/ai/rewrite-cta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generatedCaption: existing,
          talentName:       t.name,
          talentIndustry:   t.industry ?? undefined,
          brand: { displayName: brand.displayName || 'Pauv', handle: brand.handle || '@Pauv' },
        }),
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('rewrite failed')))
        .then((data: { ctaParagraph?: string; error?: string }) => {
          if (data.error || !data.ctaParagraph) return;
          const paras = existing.split(/\n\s*\n/);
          if (paras.length > 0) {
            paras[paras.length - 1] = data.ctaParagraph;
            const next = paras.join('\n\n');
            setSocialCaptionMap(prev => (prev[entryId] ? { ...prev, [entryId]: { ...prev[entryId]!, text: next, copied: false } } : prev));
          }
        })
        .catch(() => { /* best-effort — leave the caption as-is on failure */ })
        .finally(() => setSocialCaptionMap(prev => (prev[entryId] ? { ...prev, [entryId]: { ...prev[entryId]!, loading: false } } : prev)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSparkline, socialCaptionMap, brand.displayName, brand.handle, personPickerSlot]);

  // "Clear" (top-right) — wipe every per-entry working state and reset the rows
  // to a single fresh entry, dropping the user back to the empty insert form
  // (link + caption + context). The parent resets `entries`; we clear the
  // transient maps CanvasGrid owns so nothing from the old run lingers.
  const handleClearAll = useCallback(() => {
    setScaleMap({});
    setBgStateMap({});
    setRecordingStateMap({});
    setCarouselRecordingStateMap({});
    setVideoZoomMap({});
    setBlockTopPctMap({});
    setSocialCaptionMap({});
    setMarketMap({});
    setMarketMap2({});
    setMarketSizeMap({});
    setMarketDownMap({});
    setMarketDownMap2({});
    setMarketOverrideMap({});
    setMarketOverrideMap2({});
    setSparklineMap({});
    // NOTE: marketCardCollapsedMap, postCaptionCollapsedMap, AND
    // marketWidgetVisible intentionally NOT reset — those are UI / global
    // preferences, not per-content state. Clear shouldn't override the
    // user's fold or widget-visibility choices.
    setSelectedId('1');
    onClearAll();
  }, [onClearAll]);

  // Merge a selected talent with its (optional) user overrides into a MarketData.
  // Shared by the primary CTA and the second rotating one. MARKETING: always use
  // the synthetic ticker-seeded sparkline + % so every market shows a healthy
  // upward green curve — real API data is unreliable (single points / flat lines)
  // and undercuts the buy signal.
  function buildMarketData(
    sel: Talent, ov: MarketOverride | undefined,
    size: 'large' | 'small' | 'bio', down: boolean,
  ): MarketData {
    const spark = generateFallbackSparkline(sel.ticker);
    const syntheticPct = syntheticPctForTicker(sel.ticker);
    if (!ov) {
      return {
        ...(sel as unknown as MarketData),
        sparkline: spark,
        size,
        down,
        price: { ...sel.price, lifetimeChangePct: syntheticPct },
      };
    }
    const priceNum = ov.priceUsd !== '' ? parseFloat(ov.priceUsd) : null;
    const pctNum   = ov.lifetimeChangePct !== '' ? parseFloat(ov.lifetimeChangePct) : null;
    return {
      name:        ov.name  || sel.name,
      ticker:      sel.ticker,
      photo_url:   ov.photo_url,
      industry:    ov.industry || null,
      subcategory: sel.subcategory,
      sparkline: spark,
      size,
      down,
      price: {
        usd:              !isNaN(priceNum ?? NaN) ? priceNum : sel.price.usd,
        lifetimeChangePct: !isNaN(pctNum ?? NaN) ? pctNum  : syntheticPct,
      },
    };
  }

  // Build a MarketData object merging the selected talent with any user overrides
  const getMarketData = useCallback((entryId: string): MarketData | null => {
    // Respect the global visibility toggle — hiding the widget keeps the
    // selected talent + overrides intact for an easy re-enable.
    if (!marketWidgetVisible) return null;
    const sizePref = marketSizeMap[entryId] ?? 'small';
    // Bio CTA needs no talent — it's just the "pauv.com to trade" line under the
    // video — so return a minimal record (no name / price / sparkline).
    //
    // ctaCategory derives from the display name first, not the brand.category
    // toggle: each machine's brand kit ("Pauv Athletes" / "Pauv Artists" / etc.)
    // should drive the wording the bio renders. The toggle is the fallback for
    // display names that don't mention either word (e.g. just "Pauv").
    const bioCategory: 'artists' | 'athletes' =
      /athletes/i.test(brand.displayName) ? 'athletes' :
      /artists/i.test(brand.displayName)  ? 'artists'  :
      brand.category;
    if (sizePref === 'bio') {
      return { name: '', ticker: '', photo_url: null, industry: null, subcategory: null, sparkline: null, size: 'bio', ctaCategory: bioCategory, price: { usd: null, lifetimeChangePct: null } };
    }
    const sel = marketMap[entryId];
    if (!sel) return null;
    const size = sizePref;
    const down = marketDownMap[entryId] ?? false;
    return buildMarketData(sel, marketOverrideMap[entryId], size, down);
  }, [marketMap, marketOverrideMap, sparklineMap, marketSizeMap, marketDownMap, marketWidgetVisible, brand.category, brand.displayName]);

  // The OPTIONAL second CTA person — non-null only when the user has added a
  // second person (and the primary exists, and size isn't 'bio', which has no
  // person card to rotate). Drives the cube rotation in TikTokCanvas.
  const getMarketDataAlt = useCallback((entryId: string): MarketData | null => {
    if (!marketWidgetVisible) return null;
    const sizePref = marketSizeMap[entryId] ?? 'small';
    if (sizePref === 'bio') return null;            // bio has no card to rotate
    if (!marketMap[entryId]) return null;           // need a primary to rotate from
    const sel2 = marketMap2[entryId];
    if (!sel2) return null;
    const down = marketDownMap2[entryId] ?? false;
    return buildMarketData(sel2, marketOverrideMap2[entryId], sizePref, down);
  }, [marketMap, marketMap2, marketOverrideMap2, marketSizeMap, marketDownMap2, marketWidgetVisible]);


  const generateSocialCaption = useCallback(async (entry: VideoEntry): Promise<string | undefined> => {
    setSocialCaptionMap(prev => ({
      ...prev,
      [entry.id]: { text: prev[entry.id]?.text ?? '', loading: true, error: null, copied: false },
    }));
    try {
      // Industry the caption should pull trending news from — derived from the
      // brand the same way the bio CTA category is (displayName wins, else the
      // brand's own category). Maps to the AI-Prompts athlete/artist tagging.
      const promptCategory: 'athlete' | 'artist' =
        /athletes/i.test(brand.displayName) ? 'athlete' :
        /artists/i.test(brand.displayName)  ? 'artist'  :
        brand.category === 'athletes'       ? 'athlete' : 'artist';
      const r = await fetch('/api/ai/social-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url:        entry.url || undefined,
          caption:    entry.caption || undefined,
          context:    entry.context || undefined,
          videoTitle: entry.data?.title || undefined,
          author:     entry.data?.author?.nickname || undefined,
          category:   promptCategory,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { caption?: string; error?: string };
      if (data.error || !data.caption) throw new Error(data.error ?? 'no caption returned');
      const generated = data.caption;

      // Show the caption right away, but keep the spinner up while DeepSeek
      // auto-picks the CTA talent (it reads this caption) and we sync the
      // Market widget + closing paragraph to whoever it chooses.
      setSocialCaptionMap(prev => ({
        ...prev,
        [entry.id]: { text: generated, loading: true, error: null, copied: false },
      }));

      const finalText = generated;
      try {
        const cr = await fetch('/api/ai/pick-cta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caption:          entry.caption || undefined,
            generatedCaption: generated,
            videoTitle:       entry.data?.title || undefined,
            author:           entry.data?.author?.nickname || undefined,
            context:          entry.context || undefined,
            brand: {
              displayName: brand.displayName || 'Pauv',
              handle:      brand.handle || '@Pauv',
            },
          }),
        });
        if (cr.ok) {
          const cta = await cr.json() as { talent?: Talent; talent2?: Talent | null; ctaParagraph?: string; matchType?: string; error?: string };
          if (cta.talent && !cta.error) {
            const t = cta.talent;
            // If the user hit Clear on this entry's market while we were
            // awaiting the AI's pick, respect that — don't silently re-apply.
            // `null` is the explicit "cleared" marker; `undefined` (never had a
            // market) is still fair game for auto-fill.
            let userCleared = false;
            setMarketMap(prev => {
              if (prev[entry.id] === null) { userCleared = true; return prev; }
              return { ...prev, [entry.id]: t };
            });
            if (userCleared) {
              // Skip sparkline + override writes too — pointless without a market.
              // CTA paragraph swap below still runs since that's purely the caption.
            } else {
              setSparklineMap(prev => ({ ...prev, [entry.id]: prev[entry.id] ?? generateFallbackSparkline(t.ticker) }));
              fetchSparkline(entry.id, t.ticker);
              setMarketOverrideMap(prev => ({
                ...prev,
                [entry.id]: {
                  name: t.name, industry: t.industry ?? '',
                  photo_url: t.photo_url,
                  priceUsd: t.price.usd?.toFixed(2) ?? '',
                  lifetimeChangePct: syntheticPctForTicker(t.ticker).toFixed(1),
                },
              }));
              // Second (rotating) person — the CTA always features two. Drop it
              // into slot 2 + seed its overrides exactly like a manual slot-2 pick.
              const t2 = cta.talent2;
              if (t2) {
                setMarketMap2(prev => ({ ...prev, [entry.id]: t2 }));
                setMarketOverrideMap2(prev => ({
                  ...prev,
                  [entry.id]: {
                    name: t2.name, industry: t2.industry ?? '',
                    photo_url: t2.photo_url,
                    priceUsd: t2.price.usd?.toFixed(2) ?? '',
                    lifetimeChangePct: syntheticPctForTicker(t2.ticker).toFixed(1),
                  },
                }));
              }
            }
            // NOTE: we intentionally do NOT swap in cta.ctaParagraph anymore —
            // the caption is now a pure industry/news write-up with no Pauv CTA.
            // pick-cta is still called only to auto-fill the Market widget talent.
          }
        }
      } catch { /* CTA pick is best-effort — keep the caption as written */ }

      setSocialCaptionMap(prev => ({
        ...prev,
        [entry.id]: { text: finalText, loading: false, error: null, copied: false },
      }));
      // Auto-copy: as soon as the caption is done generating, drop it on the
      // clipboard (when the toggle is on) and flash the Copied state.
      if (autoCopyCaptionRef.current && finalText) {
        try {
          await navigator.clipboard.writeText(finalText);
          setSocialCaptionMap(prev => (prev[entry.id] ? { ...prev, [entry.id]: { ...prev[entry.id]!, copied: true } } : prev));
          setTimeout(() => setSocialCaptionMap(prev => {
            const cur = prev[entry.id];
            return cur ? { ...prev, [entry.id]: { ...cur, copied: false } } : prev;
          }), 1800);
        } catch { /* clipboard blocked — the Copy button still works */ }
      }
      return finalText;
    } catch (e) {
      setSocialCaptionMap(prev => ({
        ...prev,
        [entry.id]: { text: prev[entry.id]?.text ?? '', loading: false, error: String(e), copied: false },
      }));
      return undefined;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSparkline, brand.displayName, brand.handle]);

  const generateChartsCaption = useCallback(async (entryId: string) => {
    const mks   = chartsMarketsMap[entryId] ?? [null, null];
    const names = chartsNameOverrideMap[entryId] ?? ['', ''];
    const name1 = names[0] || mks[0]?.name || '';
    const name2 = names[1] || mks[1]?.name || '';
    if (!name1 || !name2) return;
    setSocialCaptionMap(prev => ({
      ...prev,
      [entryId]: { text: prev[entryId]?.text ?? '', loading: true, error: null, copied: false },
    }));
    try {
      const r = await fetch('/api/ai/charts-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name1, name2 }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { caption?: string; error?: string };
      if (data.error || !data.caption) throw new Error(data.error ?? 'no caption returned');
      setSocialCaptionMap(prev => ({
        ...prev,
        [entryId]: { text: data.caption!, loading: false, error: null, copied: false },
      }));
    } catch (e) {
      setSocialCaptionMap(prev => ({
        ...prev,
        [entryId]: { text: prev[entryId]?.text ?? '', loading: false, error: String(e), copied: false },
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartsMarketsMap, chartsNameOverrideMap]);

  // "Next" in the media tab: fetch the video, then — for video posts — auto-run
  // the caption generator (which itself chains the CTA pick). One action instead
  // of three. If the fetch fails, the error is already surfaced on the entry.
  const handleFetchThenGenerate = useCallback(async (entry: VideoEntry) => {
    const data = await onFetchVideo(entry.id);
    if (!data) return;
    await generateSocialCaption({ ...entry, data });
  }, [onFetchVideo, generateSocialCaption]);

  // Board widget "send": StudioShell drops the chosen row into a single entry
  // and sets pendingBoardSend to its id. Treat it exactly like clicking the
  // media Next arrow on that row — fetch the video (revealing the crop editor)
  // and chain the caption + CTA. Run once, then clear so it can't re-fire.
  useEffect(() => {
    if (!pendingBoardSend) return;
    const entry = entries.find(e => e.id === pendingBoardSend);
    onBoardSendConsumed?.();
    if (entry && entry.mode !== 'carousel' && entry.url.trim()) {
      setSelectedId(entry.id);
      void handleFetchThenGenerate(entry);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBoardSend]);

  const copySocialCaption = useCallback(async (entryId: string) => {
    const text = socialCaptionMap[entryId]?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setSocialCaptionMap(prev => ({ ...prev, [entryId]: { ...prev[entryId]!, copied: true } }));
      setTimeout(() => {
        setSocialCaptionMap(prev => {
          const cur = prev[entryId];
          if (!cur) return prev;
          return { ...prev, [entryId]: { ...cur, copied: false } };
        });
      }, 1800);
    } catch {
      // ignore — user can select+copy manually as a fallback
    }
  }, [socialCaptionMap]);

  const { savedSlides } = useCarouselTemplates(isCarousel ? userId : null);
  const savedSlidesRef  = useRef(savedSlides);
  savedSlidesRef.current = savedSlides;

  const entrySlideTypeMap = useMemo(() => {
    const m = new Map<string, SlideType>();
    entries.forEach((e, i) => {
      m.set(e.id, e.carouselSlideType ?? CAROUSEL_SLIDE_TYPES[i % 3]);
    });
    return m;
  }, [entries]);

  // Holds subheadline2 that needs to be applied to a supporting_1 entry once it exists.
  const pendingSupporting1Ref = useRef<string | null>(null);

  // When savedSlides is ready AND there is a pending AI seed, apply the template settings
  // first, then set imageSrc/headline/subheadline on the entry.  This mirrors exactly what
  // happens in the manual flow: template loads → user uploads image.  The image-load effect
  // inside CarouselCanvas calls onSettingsChange({bgBlurEnabled:false}); by the time that
  // fires here, settingsMap[id] is already stamped with the saved template so updateSettings
  // uses it as the base instead of defaultCarouselSettings().
  useEffect(() => {
    if (!savedSlides || !pendingAiSeed) return;
    const entry = entries.find(e => e.mode === 'carousel');
    if (!entry) return;

    const slideType = entry.carouselSlideType ?? 'main';
    const saved = savedSlides[slideType];

    // Stamp the template settings into settingsMap first (same render batch)
    if (saved?.settings) {
      setSettingsMap(prev => ({ ...prev, [entry.id]: saved.settings }));
    }

    // Apply the AI content — CarouselCanvas will receive both in the same render
    onUpdateCarouselEntry(entry.id, 'imageSrc',    pendingAiSeed.imageSrc);
    onUpdateCarouselEntry(entry.id, 'headline',    pendingAiSeed.headline);
    onUpdateCarouselEntry(entry.id, 'subheadline', pendingAiSeed.subheadline);
    if (pendingAiSeed.articleUrl) {
      onUpdateCarouselEntry(entry.id, 'articleUrl', pendingAiSeed.articleUrl);
    }

    // For subheadline2 → supporting_1 slide: if the entry already exists update it,
    // otherwise store in ref and add the row; the effect below will apply it.
    if (pendingAiSeed.subheadline2) {
      const s1 = entries.find(e => e.mode === 'carousel' && (e.carouselSlideType ?? 'main') === 'supporting_1');
      if (s1) {
        onUpdateCarouselEntry(s1.id, 'subheadline', pendingAiSeed.subheadline2);
      } else {
        pendingSupporting1Ref.current = pendingAiSeed.subheadline2;
        onAddRow('supporting_1');
      }
    }

    onAiSeedConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSlides, pendingAiSeed]);

  // Second pass: once the supporting_1 entry is added, apply the stored subheadline2.
  useEffect(() => {
    if (!pendingSupporting1Ref.current) return;
    const s1 = entries.find(e => e.mode === 'carousel' && (e.carouselSlideType ?? 'main') === 'supporting_1');
    if (!s1) return;
    onUpdateCarouselEntry(s1.id, 'subheadline', pendingSupporting1Ref.current);
    pendingSupporting1Ref.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const scrollRef             = useRef<HTMLDivElement>(null);
  const cardRefs              = useRef<Record<string, HTMLDivElement | null>>({});
  const prevLengthRef         = useRef(entries.length);
  const canvasRefRegistered   = useRef(new Set<string>());
  const carouselRefRegistered = useRef(new Set<string>());
  const chartsRefsMap         = useRef(new Map<string, ChartsCanvasRef>());
  const chartsRefRegistered   = useRef(new Set<string>());
  const [chartsRefVersion,    setChartsRefVersion]    = useState(0);

  // Scroll selected card into view (vertical)
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const cardEl   = cardRefs.current[selectedId];
    if (!scrollEl || !cardEl) return;
    const containerRect = scrollEl.getBoundingClientRect();
    const cardRect      = cardEl.getBoundingClientRect();
    const scrollTop     = scrollEl.scrollTop
      + (cardRect.top - containerRect.top)
      - (containerRect.height - cardRect.height) / 2;
    scrollEl.scrollTo({ top: scrollTop, behavior: 'smooth' });
  }, [selectedId]);

  // When a new entry is added, select and scroll to it
  useEffect(() => {
    if (entries.length > prevLengthRef.current) {
      const newest = entries[entries.length - 1];
      if (newest) setTimeout(() => setSelectedId(newest.id), 30);
    }
    prevLengthRef.current = entries.length;
  }, [entries.length]);

  const getSettings = useCallback((id: string): CarouselSettings => {
    if (settingsMap[id]) return settingsMap[id];
    const slideType = entrySlideTypeMap.get(id) ?? 'main';
    const saved = savedSlides?.[slideType];
    return saved?.settings ?? defaultCarouselSettings();
  }, [settingsMap, entrySlideTypeMap, savedSlides]);

  const updateSettings = useCallback((id: string, partial: Partial<CarouselSettings>) => {
    setSettingsMap(prev => {
      const slideType = entrySlideTypeMap.get(id) ?? 'main';
      const saved = savedSlidesRef.current?.[slideType];
      const base  = prev[id] ?? saved?.settings ?? defaultCarouselSettings();
      return { ...prev, [id]: { ...base, ...partial } };
    });
  }, [entrySlideTypeMap, setSettingsMap]);

  const getVideoZoom = useCallback((id: string) => videoZoomMap[id] ?? 1, [videoZoomMap]);

  const applyVideoZoom = useCallback((id: string, s: number) => {
    const clamped = Math.max(0.5, Math.min(3, s));
    setVideoZoomMap(prev => ({ ...prev, [id]: clamped }));
    canvasRefsMap.current.get(id)?.setZoom(clamped);
  }, [canvasRefsMap]);

  const getTopPct = useCallback((id: string) => blockTopPctMap[id] ?? 15, [blockTopPctMap]);

  const applyTopPct = useCallback((id: string, pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    setBlockTopPctMap(prev => ({ ...prev, [id]: clamped }));
    canvasRefsMap.current.get(id)?.setBlockTopPct(clamped / 100);
  }, [canvasRefsMap]);

  const selectedEntry      = entries.find(e => e.id === selectedId) ?? entries[0];
  const isSelectedCarousel = selectedEntry?.mode === 'carousel';
  const isSelectedCharts   = selectedEntry?.mode === 'charts';

  const isSelectedVideo = !isSelectedCarousel && !isSelectedCharts && selectedEntry && (
    !!selectedEntry.localVideoSrc || (!!selectedEntry.data && !selectedEntry.loading)
  );
  const isSelectedChartsVideo = false; // Charts has no video
  const isCarouselVideoSelected = isSelectedCarousel && selectedEntry?.carouselSubMode === 'video' && (
    !!selectedEntry.localVideoSrc || (!!selectedEntry.data && !selectedEntry.loading)
  );
  const showVideoControls = isSelectedVideo || isCarouselVideoSelected;

  // canvasRefVersion / carouselRefVersion force re-derivation when refs populate
  const activeVideoRef = showVideoControls && canvasRefVersion >= 0 && carouselRefVersion >= 0
    ? (isSelectedVideo
        ? (canvasRefsMap.current.get(selectedEntry!.id) ?? null)
        : (carouselRefsMap.current.get(selectedEntry!.id) ?? null))
    : null;

  const activeRecordingState = showVideoControls
    ? (isSelectedVideo
        ? (recordingStateMap[selectedEntry!.id] ?? null)
        : (carouselRecordingStateMap[selectedEntry!.id] ?? null))
    : null;

  const activeVideoSrc = useMemo(() => {
    if (!showVideoControls) return null;
    return selectedEntry!.localVideoSrc
      ?? (selectedEntry!.data ? bestVideoUrl(selectedEntry!.data) : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showVideoControls,
    selectedEntry?.localVideoSrc,
    selectedEntry?.data?.play,
    selectedEntry?.data?.hdplay,
    selectedEntry?.data?.wmplay,
  ]);

  return (
    <div className="w-full flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-800 shrink-0 bg-zinc-950">
        {/* Back to AI Cards + view zoom */}
        <div className="flex items-center gap-2">
          {onBackToAi && (
            <button
              onClick={onBackToAi}
              title="Back to headline + photo"
              className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5"/>
                <polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
          )}
          <span className="text-[10px] text-zinc-600 select-none tabular-nums w-8 text-right">{Math.round(viewScale * 100)}%</span>
          <input
            type="range" min={40} max={150} step={10}
            value={Math.round(viewScale * 100)}
            onChange={e => setViewScale(parseInt(e.target.value) / 100)}
            className="w-20 h-1 accent-white cursor-pointer"
          />

          {/* Format toggle — replaces the old template picker. Applies to every
              row (and future rows inherit it). */}
          {onSetFormat && (
            <div className="flex items-center gap-0.5 ml-2 rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
              {([['twitter', 'Twitter'], ['caption', 'Caption'], ['charts', 'Charts'], ['carousel', 'Carousel']] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => onSetFormat(m)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    format === m ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-4">
          {isSelectedCarousel && selectedEntry && (
            <button onClick={() => carouselRefsMap.current.get(selectedEntry.id)?.startDownload()}
              className="flex items-center gap-1.5 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-black hover:bg-zinc-100 transition-colors">
              <DownloadIcon size={11} stroke="currentColor" />
              {selectedEntry.carouselSubMode === 'video' ? 'Export' : 'PNG'}
            </button>
          )}
          {isSelectedCharts && selectedEntry && (() => {
            const recState = chartsRecordingStateMap[selectedEntry.id];
            const isRec = recState?.isRecording ?? false;
            const pct   = recState?.recProgress ?? 0;
            return (
              <button
                onClick={() => chartsRefsMap.current.get(selectedEntry.id)?.startDownload()}
                disabled={isRec}
                className="relative flex items-center gap-1.5 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-black hover:bg-zinc-100 disabled:opacity-60 transition-colors overflow-hidden"
              >
                {isRec && (
                  <span
                    className="absolute inset-0 bg-zinc-300 origin-left transition-none"
                    style={{ transform: `scaleX(${pct})` }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  {isRec
                    ? <SpinnerIcon size={11} style={{ animation: 'spin 1s linear infinite' }} />
                    : <DownloadIcon size={11} stroke="currentColor" />
                  }
                  {isRec ? `${Math.round(pct * 100)}%` : 'Export'}
                </span>
              </button>
            );
          })()}
          {/* Download All moved into the export bar (bottom-right) — appears after Export is pressed. */}
          {/* Clear — reset everything back to the empty insert form. */}
          <button
            onClick={handleClearAll}
            title="Clear everything and start over"
            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-zinc-100 transition-colors shrink-0"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Clear
          </button>
        </div>
      </div>

      {/* ── Vertical scroll column ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth"
        style={{ paddingRight: isSelectedCarousel && selectedEntry ? 360 : 0 }}
      >
        {/* Horizontal-move wrapper — the grip slides the whole creator left/right. */}
        <div style={{ transform: `translateX(${hOffset}px)` }}>
          {/* Grip handle */}
          <div className="flex justify-center pt-1 select-none">
            <button
              onMouseDown={onCreatorGripDown}
              title="Drag left / right to move the creator"
              className={`flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/80 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors ${hDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 3 12 9 18" />
                <polyline points="15 6 21 12 15 18" />
              </svg>
            </button>
          </div>
          <div className="flex flex-col items-center gap-8 pt-2 pb-6 px-4" style={{ zoom: viewScale }}>

          {entries.map((entry, index) => {
            const isSelected      = entry.id === (selectedEntry?.id ?? '');
            const isEntryCarousel = entry.mode === 'carousel';
            const isEntryCharts   = entry.mode === 'charts';

            const isCarouselVideo   = isEntryCarousel && entry.carouselSubMode === 'video';
            const hasCarouselRender = isEntryCarousel && (
              (!isCarouselVideo && (!!entry.imageSrc || !!entry.headline || !!entry.subheadline)) ||
              (isCarouselVideo && (!!entry.localVideoSrc || (!!entry.data && !entry.loading)))
            );
            const hasVideoRender = !isEntryCarousel && !isEntryCharts && !entry.loading && (
              !!entry.localVideoSrc
              || (!!entry.data && !(entry.data.images && entry.data.images.length > 0))
            );
            const hasRender = hasCarouselRender || hasVideoRender || isEntryCharts;
            const scale     = scaleMap[entry.id] ?? 1;

            return (
              <div
                key={entry.id}
                ref={el => { cardRefs.current[entry.id] = el; }}
                className="flex flex-col gap-3"
                style={{ width: CARD_W }}
              >
                {/* Input card */}
                {isEntryCarousel ? (
                  <CarouselInputCard
                    entry={entry}
                    onUpdateCarousel={(field, value) => onUpdateCarouselEntry(entry.id, field, value)}
                    onUpdateUrl={url => onUpdateEntry(entry.id, 'url', url)}
                    onUpdateLocalVideo={(src, name) => onUpdateLocalVideo(entry.id, src, name)}
                    onFetch={() => onFetchVideo(entry.id)}
                    onSetSubMode={mode => onSetCarouselSubMode(entry.id, mode)}
                    onRemove={() => onRemoveRow(entry.id)}
                  />
                ) : isEntryCharts ? (
                  <ChartsInputCard
                    entry={entry}
                    onUpdateField={(field, value) => onUpdateEntry(entry.id, field as 'caption' | 'context', value)}
                    markets={chartsMarketsMap[entry.id] ?? [null, null]}
                    onUpdateMarket={(idx, market) => {
                      const curMks   = chartsMarketsMap[entry.id] ?? [null, null];
                      const curNames = chartsNameOverrideMap[entry.id] ?? ['', ''];
                      const nextMks: [ChartsMarket | null, ChartsMarket | null] = [curMks[0], curMks[1]];
                      nextMks[idx] = market;
                      const nextNames: [string, string] = [curNames[0], curNames[1]];
                      nextNames[idx] = market?.name ?? '';

                      setChartsMarketsMap(prev => {
                        const cur = prev[entry.id] ?? [null, null];
                        const next: [ChartsMarket | null, ChartsMarket | null] = [cur[0], cur[1]];
                        next[idx] = market;
                        return { ...prev, [entry.id]: next };
                      });
                      // Pre-fill override name; reset loaded state
                      setChartsNameOverrideMap(prev => {
                        const cur = [...(prev[entry.id] ?? ['', ''])] as [string, string];
                        cur[idx] = market?.name ?? '';
                        return { ...prev, [entry.id]: cur };
                      });
                      setChartsTrendsLoadedMap(prev => {
                        const cur = [...(prev[entry.id] ?? [false, false])] as [boolean, boolean];
                        cur[idx] = false;
                        return { ...prev, [entry.id]: cur };
                      });
                      // Always update caption when both markets are selected
                      if (nextMks[0] && nextMks[1]) {
                        const n0 = nextNames[0] || nextMks[0].name;
                        const n1 = nextNames[1] || nextMks[1].name;
                        onUpdateEntry(entry.id, 'caption', `${n0} and ${n1}'s Pauv over time:`);
                      }
                    }}
                    allMarkets={(allTalents ?? []).map(t => ({ id: t.id, name: t.name, ticker: t.ticker, photo_url: t.photo_url, industry: t.industry }))}
                    marketsLoading={talentsLoading}
                    onEnsureMarkets={() => {
                      if (!allTalents && !talentsLoading) {
                        setTalentsLoading(true);
                        fetch('/api/ai/talents')
                          .then(r => r.json())
                          .then((data: Talent[] | { error?: string }) => { if (Array.isArray(data)) setAllTalents(data); })
                          .catch(() => {})
                          .finally(() => setTalentsLoading(false));
                      }
                    }}
                    overrideNames={chartsNameOverrideMap[entry.id] ?? ['', '']}
                    onUpdateOverrideName={(idx, name) => setChartsNameOverrideMap(prev => {
                      const cur = [...(prev[entry.id] ?? ['', ''])] as [string, string];
                      cur[idx] = name;
                      return { ...prev, [entry.id]: cur };
                    })}
                    anyLoading={(chartsTrendsLoadingMap[entry.id] ?? [false, false]).some(Boolean)}
                    trendsLoaded={chartsTrendsLoadedMap[entry.id] ?? [false, false]}
                    trendsError={chartsTrendsErrorMap[entry.id] ?? null}
                    onStart={() => {
                      setChartsTrendsErrorMap(prev => ({ ...prev, [entry.id]: null }));
                      const mks   = chartsMarketsMap[entry.id] ?? [null, null];
                      const names = chartsNameOverrideMap[entry.id] ?? ['', ''];
                      // Clear existing sparklines so canvas waits for fresh data
                      setChartsMarketsMap(prev => {
                        const cur  = prev[entry.id] ?? [null, null];
                        const next: [ChartsMarket | null, ChartsMarket | null] = [cur[0], cur[1]];
                        if (next[0]) next[0] = { ...next[0], sparkline: undefined };
                        if (next[1]) next[1] = { ...next[1], sparkline: undefined };
                        return { ...prev, [entry.id]: next };
                      });
                      setChartsTrendsLoadedMap(prev => ({ ...prev, [entry.id]: [false, false] }));
                      // Fetch both concurrently
                      ([0, 1] as const).forEach(idx => {
                        const market = mks[idx];
                        if (!market) return;
                        const term = names[idx].trim() || market.name;
                        fetchChartsTrends(entry.id, idx, market, term);
                      });
                    }}
                    onOpenPhotoPicker={(idx, query) => openPhotoPicker(`charts:${entry.id}:${idx}`, query)}
                    onSuggestPairs={() => openAiGroupsPanel(entry.id)}
                    preloadedAudios={preloadedAudios}
                    audioTrack={chartsAudioMap[entry.id] ?? null}
                    onSelectAudioTrack={track => setChartsAudioMap(prev => ({ ...prev, [entry.id]: track }))}
                    onClearAudioTrack={() => setChartsAudioMap(prev => ({ ...prev, [entry.id]: null }))}
                    onAddAudio={handleAddAudio}
                    onDeleteAudio={handleDeleteAudio}
                    onRenameAudio={handleRenameAudio}
                  />
                ) : (
                  <VideoInputCard
                    entry={entry}
                    onUpdateField={(field, value) => onUpdateEntry(entry.id, field, value)}
                    onUpdateLocalVideo={(src, name) => onUpdateLocalVideo(entry.id, src, name)}
                    onFetch={() => handleFetchThenGenerate(entry)}
                  />
                )}

                {/* Canvas render + controls (only when ready) */}
                {hasRender && (
                  <div className="flex flex-col gap-4 mt-2">

                    {/* Carousel-specific controls row */}
                    {isEntryCarousel && (
                      <div className="flex items-center justify-between gap-4">
                        {/* Zoom */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-zinc-600 select-none shrink-0">Zoom</span>
                          <input
                            type="range" min={20} max={800} step={5}
                            value={Math.round(scale * 100)}
                            onChange={e => {
                              const n = parseInt(e.target.value) / 100;
                              carouselRefsMap.current.get(entry.id)?.setZoom(n);
                            }}
                            className="w-20 h-1 accent-white cursor-pointer"
                          />
                          <EditablePct
                            value={Math.round(scale * 100)}
                            min={20} max={800} step={5}
                            onCommit={pct => carouselRefsMap.current.get(entry.id)?.setZoom(pct / 100)}
                          />
                        </div>

                        {/* Crop / Split / BG Blur */}
                        <CarouselBgControls
                          entry={entry}
                          bgState={bgStateMap[entry.id] ?? { fgMaskReady: false, isBgProcessing: false, bgProcessError: false }}
                          settings={getSettings(entry.id)}
                          carouselRef={carouselRefsMap.current.get(entry.id)}
                          onRemoveRow={onRemoveRow}
                          isCarouselVideo={isCarouselVideo}
                        />
                      </div>
                    )}

                    {/* Charts — delete button */}
                    {isEntryCharts && (
                      <div className="flex items-center justify-end px-0.5">
                        <button onClick={() => onRemoveRow(entry.id)} className={BTN_ICON} title="Delete row">
                          <TrashIcon size={15} />
                        </button>
                      </div>
                    )}

                    {/* Video canvas zoom + delete (non-carousel, non-charts only) */}
                    {!isEntryCarousel && !isEntryCharts && (
                      <div className="flex items-center gap-2 px-0.5">
                        <span className="text-[10px] text-zinc-600 select-none shrink-0">Zoom</span>
                        <input
                          type="range" min={50} max={300} step={5}
                          value={Math.round(getVideoZoom(entry.id) * 100)}
                          onChange={e => applyVideoZoom(entry.id, parseInt(e.target.value) / 100)}
                          className="w-20 h-1 accent-white cursor-pointer"
                        />
                        <EditablePct
                          value={Math.round(getVideoZoom(entry.id) * 100)}
                          min={50} max={300} step={5}
                          onCommit={pct => applyVideoZoom(entry.id, pct / 100)}
                        />
                        <div className="flex items-center gap-1.5 ml-auto">
                          <button
                            onClick={() => canvasRefsMap.current.get(entry.id)?.resetBox()}
                            className="flex items-center h-9 px-2.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors text-[10px] font-medium shrink-0"
                            title="Reset box"
                          >Reset box</button>
                          <label
                            className="flex items-center gap-1 h-9 px-2.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 text-[10px] font-medium shrink-0"
                            title="Distance of the block's top edge from the top of the frame"
                          >
                            <span>Top</span>
                            <input
                              type="number" min={0} max={100} step={1}
                              value={getTopPct(entry.id)}
                              onChange={e => applyTopPct(entry.id, parseInt(e.target.value || '0', 10) || 0)}
                              className="w-9 bg-transparent text-zinc-200 text-right tabular-nums outline-none"
                            />
                            <span>%</span>
                          </label>
                          <button onClick={() => onRemoveRow(entry.id)} className={BTN_ICON} title="Delete row">
                            <TrashIcon size={15} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Selection ring + canvas */}
                    <div
                      onClick={e => {
                        if ((e.target as Element).closest('[data-carousel-slot]')) return;
                        setSelectedId(entry.id);
                      }}
                      className={`relative cursor-pointer transition-all duration-150 mt-1 ${
                        isSelected
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-black'
                          : 'ring-1 ring-zinc-800 hover:ring-zinc-600'
                      }`}
                    >
                      {isEntryCarousel ? (
                        <CarouselCanvas
                          ref={r => {
                            if (r) {
                              carouselRefsMap.current.set(entry.id, r);
                              if (!carouselRefRegistered.current.has(entry.id)) {
                                carouselRefRegistered.current.add(entry.id);
                                setCarouselRefVersion(v => v + 1);
                              }
                            } else {
                              carouselRefsMap.current.delete(entry.id);
                            }
                          }}
                          imageSrc={!isCarouselVideo ? (entry.imageSrc ?? '') : ''}
                          videoSrc={isCarouselVideo
                            ? (entry.localVideoSrc ?? (entry.data ? bestVideoUrl(entry.data) : undefined))
                            : undefined}
                          headline={entry.headline ?? ''}
                          subheadline={entry.subheadline ?? ''}
                          settings={getSettings(entry.id)}
                          invertedSlots={entrySlideTypeMap.get(entry.id) === 'supporting_2'}
                          onScaleChange={s => setScaleMap(prev => ({ ...prev, [entry.id]: s }))}
                          onSettingsChange={partial => updateSettings(entry.id, partial)}
                          onBgLayerStateChange={s => setBgStateMap(prev => ({ ...prev, [entry.id]: s }))}
                          brandLogoSrc={brand.logoSrc || undefined}
                          onRecordingStateChange={state => setCarouselRecordingStateMap(prev => ({ ...prev, [entry.id]: state }))}
                          onHeadlineChange={text => onUpdateCarouselEntry(entry.id, 'headline', text)}
                          onSubheadlineChange={text => onUpdateCarouselEntry(entry.id, 'subheadline', text)}
                        />
                      ) : isEntryCharts ? (
                        <ChartsCanvas
                          ref={r => {
                            if (r) {
                              chartsRefsMap.current.set(entry.id, r);
                              if (!chartsRefRegistered.current.has(entry.id)) {
                                chartsRefRegistered.current.add(entry.id);
                                setChartsRefVersion(v => v + 1);
                              }
                            } else {
                              chartsRefsMap.current.delete(entry.id);
                            }
                          }}
                          overlayCaption={entry.caption}
                          markets={chartsMarketsMap[entry.id] ?? [null, null]}
                          overrideNames={chartsNameOverrideMap[entry.id] ?? ['', '']}
                          rowNumber={index}
                          onRecordingStateChange={state => setChartsRecordingStateMap(prev => ({ ...prev, [entry.id]: state }))}
                          audioUrl={chartsAudioMap[entry.id]?.url}
                          audioDurationMs={chartsAudioMap[entry.id]?.durationMs}
                        />
                      ) : (
                        <TikTokCanvas
                          ref={r => {
                            if (r) {
                              canvasRefsMap.current.set(entry.id, r);
                              if (!canvasRefRegistered.current.has(entry.id)) {
                                canvasRefRegistered.current.add(entry.id);
                                setCanvasRefVersion(v => v + 1);
                              }
                            } else {
                              canvasRefsMap.current.delete(entry.id);
                            }
                          }}
                          videoSrc={entry.localVideoSrc ?? (entry.data ? bestVideoUrl(entry.data) : '')}
                          videoId={entry.data?.id}
                          rowNumber={index}
                          onVideoError={() => onHandleVideoError(entry.id)}
                          brand={entry.mode === 'caption' ? 'clean' : 'pauv'}
                          overlayLogoSrc={brand.logoSrc || '/templatelogo.png'}
                          overlayDisplayName={brand.displayName || 'Pauv'}
                          overlayHandle={brand.handle || '@Pauv'}
                          overlayVerified={true}
                          overlayCaption={entry.caption}
                          marketData={entry.mode === 'twitter' ? getMarketData(entry.id) : null}
                          marketDataAlt={entry.mode === 'twitter' ? getMarketDataAlt(entry.id) : null}
                          onRecordingStateChange={state =>
                            setRecordingStateMap(prev => ({ ...prev, [entry.id]: state }))
                          }
                        />
                      )}

                      {/* Safe-zone guide — the red TikTok safe / unsafe-zone
                          overlay, laid on top of the video canvas (contained,
                          never stretched) when toggled on below. Carousel has no
                          equivalent so it's video-only. pointer-events-none so it
                          never blocks dragging / resizing the video box. */}
                      {!isEntryCarousel && !isEntryCharts && (safeZoneMap[entry.id] ?? true) && (
                        <img
                          src="/safe-zones.png"
                          alt=""
                          aria-hidden
                          draggable={false}
                          className="absolute inset-0 w-full h-full pointer-events-none select-none opacity-50"
                          style={{ objectFit: 'contain' }}
                        />
                      )}
                    </div>

                    {/* Safe-zone toggle — slim row under the canvas, styled like the
                        market section's controls. On by default. */}
                    {!isEntryCarousel && !isEntryCharts && (() => {
                      const on = safeZoneMap[entry.id] ?? true;
                      return (
                        <div className="mt-2 flex items-center justify-between gap-3 px-3 py-1.5 rounded-md bg-zinc-950 border border-zinc-800">
                          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Safe zones</span>
                          <button
                            onClick={() => setSafeZoneMap(prev => ({ ...prev, [entry.id]: !(prev[entry.id] ?? true) }))}
                            title={on ? 'Hide TikTok safe zones' : 'Show TikTok safe zones'}
                            className={`inline-flex items-center shrink-0 w-9 h-5 rounded-full px-0.5 transition-colors ${on ? 'bg-[#fe2c55]' : 'bg-zinc-700'}`}
                          >
                            <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
                          </button>
                        </div>
                      );
                    })()}

                    {/* Market selector — Twitter template only.
                        Lets the user pick a Pauv market and renders its
                        details row on the canvas below the video box.
                        Selected state and list rows match the ArtistRow
                        design from pauv-the-app/MobileTradeList.tsx. */}
                    {entry.mode === 'twitter' && (() => {
                      const selected = marketMap[entry.id] ?? null;
                      // Market card is always shown for Twitter posts so the
                      // user can collapse / change / toggle it before a market
                      // is picked. The body shows a placeholder until a talent
                      // is auto-picked by the CTA generator or manually chosen
                      // via Change.
                      const collapsed = marketCardCollapsedMap[entry.id] ?? false;
                      return (
                        <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                          <div className={`flex items-center justify-between gap-3 px-3 py-2 ${collapsed ? '' : 'border-b border-zinc-800'}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <button
                                onClick={() => setMarketCardCollapsedMap(prev => ({ ...prev, [entry.id]: !(prev[entry.id] ?? false) }))}
                                title={collapsed ? 'Expand market' : 'Collapse market'}
                                className="flex items-center justify-center w-4 h-4 text-zinc-500 hover:text-zinc-200 transition-colors shrink-0"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  {collapsed
                                    ? <polyline points="6 9 12 15 18 9"/>
                                    : <polyline points="18 15 12 9 6 15"/>}
                                </svg>
                              </button>
                              <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Market</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* CTA size toggle — Large (full row) vs Small (one line) vs Bio (link only). */}
                              <div className="flex items-center rounded-md border border-zinc-800 overflow-hidden">
                                {(['large', 'small', 'bio'] as const).map(sz => {
                                  const active = (marketSizeMap[entry.id] ?? 'small') === sz;
                                  return (
                                    <button
                                      key={sz}
                                      onClick={() => setMarketSizeMap(prev => ({ ...prev, [entry.id]: sz }))}
                                      title={sz === 'large' ? 'Full row: photo, name, industry, sparkline, price, change' : sz === 'small' ? 'One line: photo, name, price, change' : 'No widget — just “pauv.com to trade” under the video'}
                                      className={`px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${active ? 'bg-zinc-700 text-zinc-100' : 'bg-transparent text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                      {sz}
                                    </button>
                                  );
                                })}
                              </div>
                              {/* Visibility toggle — global preference. Hides the market widget
                                  from the canvas/export across ALL videos, persists through
                                  Clear + refresh. Picked talent + overrides stay intact for
                                  instant re-enable. */}
                              <button
                                onClick={() => setMarketWidgetVisible(v => !v)}
                                title={marketWidgetVisible ? 'Hide market widget (applies to all videos)' : 'Show market widget'}
                                className={`inline-flex items-center shrink-0 w-9 h-5 rounded-full px-0.5 transition-colors ${marketWidgetVisible ? 'bg-[#04df9d]' : 'bg-zinc-700'}`}
                              >
                                <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${marketWidgetVisible ? 'translate-x-4' : 'translate-x-0'}`} />
                              </button>
                            </div>
                          </div>
                          {!collapsed && ((marketSizeMap[entry.id] ?? 'small') === 'bio' ? (
                            <div className="px-3 py-4 text-center">
                              <p className="text-[11px] text-zinc-600">Bio CTA — just the <span className="text-zinc-400 font-medium">pauv.com to trade</span> line. No person needed.</p>
                            </div>
                          ) : (() => {
                            const selected2 = marketMap2[entry.id] ?? null;
                            // One compact row per person — name + Down toggle + Change
                            // (and Remove on the second). The on-canvas render IS the
                            // preview, so there's no mock row / edit fields here.
                            const renderPersonRow = (
                              slot: 1 | 2,
                              talent: Talent | null,
                              displayName: string | undefined,
                              isDown: boolean,
                              onToggleDown: () => void,
                              removable: boolean,
                            ) => (
                              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-zinc-900 border border-zinc-800">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider shrink-0">{slot === 1 ? 'P1' : 'P2'}</span>
                                  {talent
                                    ? <span className="text-xs text-zinc-200 truncate">{displayName || talent.name}</span>
                                    : <span className="text-xs text-zinc-600 italic truncate">No one picked yet</span>}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {talent && (
                                    <button
                                      onClick={onToggleDown}
                                      title={isDown ? 'Showing a loss — red, down arrow, declining chart. Click for a gain.' : 'Show this person as a loss — red, down arrow, declining chart'}
                                      className={`px-2 py-0.5 rounded-md border text-[10px] font-medium transition-colors ${isDown ? 'border-[#FF4B4B] text-[#FF4B4B] bg-[#FF4B4B]/10' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'}`}
                                    >
                                      Down
                                    </button>
                                  )}
                                  <button
                                    onClick={() => openPersonPicker(entry.id, slot)}
                                    title="Pick a person from the Pauv roster"
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-800 text-[10px] font-medium text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m22 8-3 3-1.5-1.5"/></svg>
                                    Change
                                  </button>
                                  {removable && (
                                    <button
                                      onClick={() => removeSecondPerson(entry.id)}
                                      title="Remove the second person (back to a single CTA)"
                                      className="flex items-center justify-center w-6 h-6 rounded-md border border-zinc-800 text-zinc-500 hover:text-[#FF4B4B] hover:border-[#FF4B4B]/60 transition-colors"
                                    >
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                            return (
                              <div className="px-3 py-2.5 flex flex-col gap-2">
                                {renderPersonRow(
                                  1, selected, marketOverrideMap[entry.id]?.name,
                                  marketDownMap[entry.id] ?? false,
                                  () => setMarketDownMap(prev => ({ ...prev, [entry.id]: !(prev[entry.id] ?? false) })),
                                  false,
                                )}
                                {selected2
                                  ? renderPersonRow(
                                      2, selected2, marketOverrideMap2[entry.id]?.name,
                                      marketDownMap2[entry.id] ?? false,
                                      () => setMarketDownMap2(prev => ({ ...prev, [entry.id]: !(prev[entry.id] ?? false) })),
                                      true,
                                    )
                                  : selected && (
                                      <button
                                        onClick={() => openPersonPicker(entry.id, 2)}
                                        title="Add a second person — the CTA card cube-rotates between the two every 8 seconds"
                                        className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-dashed border-zinc-700 text-[11px] font-medium text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                        Add another person
                                      </button>
                                    )}
                                {selected2 && (
                                  <p className="text-[10px] text-zinc-600 text-center">Cube-rotating between both every 8s.</p>
                                )}
                                {!selected && (
                                  <p className="text-[10px] text-zinc-600 text-center">No one picked yet — use <span className="text-zinc-400 font-medium">Change</span> to choose, or let the caption generator auto-pick.</p>
                                )}
                              </div>
                            );
                          })())}
                        </div>
                      );
                    })()}

                    {/* Social caption generator — only for video-mode posts.
                        Lives directly below the rendered preview so the user
                        can generate, edit, and copy a long-form post caption
                        without leaving the row. */}
                    {!isEntryCarousel && (() => {
                      const sc = socialCaptionMap[entry.id];
                      const collapsed = postCaptionCollapsedMap[entry.id] ?? false;
                      return (
                        <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                          <div className={`flex items-center justify-between gap-3 px-3 py-2 ${collapsed ? '' : 'border-b border-zinc-800'}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <button
                                onClick={() => setPostCaptionCollapsedMap(prev => ({ ...prev, [entry.id]: !(prev[entry.id] ?? false) }))}
                                title={collapsed ? 'Expand caption' : 'Collapse caption'}
                                className="flex items-center justify-center w-4 h-4 text-zinc-500 hover:text-zinc-200 transition-colors shrink-0"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  {collapsed
                                    ? <polyline points="6 9 12 15 18 9"/>
                                    : <polyline points="18 15 12 9 6 15"/>}
                                </svg>
                              </button>
                              <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Post caption</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => setAutoCopyCaption(v => !v)}
                                title={autoCopyCaption
                                  ? 'Auto-copy is ON — captions are copied to the clipboard as soon as they finish generating'
                                  : 'Auto-copy is OFF — turn on to copy each caption automatically when it finishes generating'}
                                className={`flex items-center gap-1 h-7 px-2 rounded-md border transition-colors text-[10px] font-medium ${
                                  autoCopyCaption
                                    ? 'bg-emerald-600/15 border-emerald-700 text-emerald-300'
                                    : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${autoCopyCaption ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                                Auto-copy
                              </button>
                              {sc?.text && (
                                <button
                                  onClick={() => copySocialCaption(entry.id)}
                                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors text-[10px] font-medium"
                                  title="Copy to clipboard"
                                >
                                  {sc.copied ? (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                  ) : (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                    </svg>
                                  )}
                                  {sc.copied ? 'Copied' : 'Copy'}
                                </button>
                              )}
                              <button
                                onClick={() => isEntryCharts ? generateChartsCaption(entry.id) : generateSocialCaption(entry)}
                                disabled={sc?.loading}
                                className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-white text-black hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[10px] font-semibold"
                                title="Generate caption with AI"
                              >
                                {sc?.loading ? (
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                  </svg>
                                ) : (
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                                  </svg>
                                )}
                                {sc?.loading ? 'Generating…' : sc?.text ? 'Regenerate' : 'Generate'}
                              </button>
                            </div>
                          </div>
                          {!collapsed && (
                            <div className="px-3 py-2.5">
                              {sc?.error ? (
                                <span className="text-xs text-red-400">{sc.error}</span>
                              ) : sc?.text ? (
                                <textarea
                                  value={sc.text}
                                  onChange={e => setSocialCaptionMap(prev => ({
                                    ...prev,
                                    [entry.id]: { ...prev[entry.id]!, text: e.target.value, copied: false },
                                  }))}
                                  rows={Math.min(8, Math.max(4, sc.text.split('\n').length + Math.ceil(sc.text.length / 90)))}
                                  className="w-full bg-transparent text-[12px] text-zinc-200 placeholder-zinc-700 outline-none resize-y leading-relaxed"
                                />
                              ) : (
                                <span className="text-[11px] text-zinc-600">
                                  Click Generate to draft a long-form caption. Edit the Context field above to steer it.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}

          {/* Manual "add row" card removed from Media. */}

          </div>
        </div>
      </div>

      {/* ── Video controls bar — shared bottom panel for video templates ──
          relative z-[70] keeps the trimmer + export controls at the very front:
          above the floating Studio widgets (BoardWidget / Phonedeck panel, z-40)
          AND above the PixelTroll, which stands ON the trim bar (data-troll-floor)
          and even rides to z-60 as the monster — so the bar always draws over him
          and his gore instead of being covered. Still below modals/dropdowns
          (z-[1000]+). Safe to compete at the root stacking level: no ancestor
          between here and the page root creates a stacking context. */}
      <div className="relative z-[70] bg-zinc-950" style={{ paddingRight: isCarouselVideoSelected ? 360 : 0 }}>
        <VideoControlsBar
          entryId={showVideoControls ? selectedEntry!.id : null}
          activeRef={activeVideoRef}
          recordingState={activeRecordingState}
          videoSrc={activeVideoSrc}
          onDownloadAll={onDownloadAll}
          onExport={(fileName) => { if (selectedEntry) onEntryExported?.(selectedEntry.id, fileName); }}
        />
      </div>

      {/* ── Photo picker modal — opens when user clicks an avatar in the market selector ── */}
      {photoPickerEntryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPhotoPickerEntryId(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
              <span className="text-sm font-semibold text-zinc-100">Pick a photo</span>
              <button onClick={() => setPhotoPickerEntryId(null)} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            {/* Search */}
            <div className="flex gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
              <input
                value={photoPickerQuery}
                onChange={e => setPhotoPickerQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchPickerPhotos(photoPickerQuery, 0, false); }}
                placeholder="Search photos…"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
              <button
                onClick={() => searchPickerPhotos(photoPickerQuery, 0, false)}
                disabled={!photoPickerQuery.trim() || photoPickerLoading}
                className="px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 text-sm transition-colors"
              >Search</button>
            </div>
            {/* Grid */}
            <div className="overflow-y-auto flex-1 p-4">
              {photoPickerLoading && (
                <div className="flex flex-wrap gap-3">
                  {[1,2,3,4,5,6].map(i => <div key={i} className="rounded-lg bg-zinc-800 animate-pulse" style={{ width: 140, height: 140 }} />)}
                </div>
              )}
              {!photoPickerLoading && photoPickerPhotos.length === 0 && (
                <p className="text-sm text-zinc-600 text-center py-8">Search for a photo above.</p>
              )}
              {!photoPickerLoading && photoPickerPhotos.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {photoPickerPhotos.map(p => (
                    <button
                      key={p.url}
                      onClick={() => {
                        if (photoPickerEntryId!.startsWith('charts:')) {
                          const parts   = photoPickerEntryId!.split(':');
                          const entryId = parts[1];
                          const slotIdx = parseInt(parts[2]) as 0 | 1;
                          setChartsMarketsMap(prev => {
                            const cur  = prev[entryId] ?? [null, null];
                            const slot = cur[slotIdx];
                            if (!slot) return prev;
                            const next: [ChartsMarket | null, ChartsMarket | null] = [cur[0], cur[1]];
                            next[slotIdx] = { ...slot, photo_url: p.url };
                            return { ...prev, [entryId]: next };
                          });
                        } else {
                          setMarketOverrideMap(prev => ({
                            ...prev,
                            [photoPickerEntryId!]: { ...(prev[photoPickerEntryId!] ?? { name: '', industry: '', photo_url: null, priceUsd: '', lifetimeChangePct: '' }), photo_url: p.url },
                          }));
                        }
                        setPhotoPickerEntryId(null);
                      }}
                      className="rounded-lg overflow-hidden border-2 border-transparent hover:border-white transition-colors"
                      style={{ width: 140, height: 140 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.thumbnail} alt={p.title ?? ''} className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    </button>
                  ))}
                  <button
                    onClick={() => { setPhotoPickerMore(true); searchPickerPhotos(photoPickerQuery, photoPickerOffset, true).finally(() => setPhotoPickerMore(false)); }}
                    disabled={photoPickerMore}
                    className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800 disabled:opacity-40 transition-colors text-zinc-600 hover:text-zinc-300"
                    style={{ width: 140, height: 140 }}
                  >
                    <span className="text-2xl leading-none">+</span>
                    <span className="text-xs">More</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Person picker — manually choose which Pauv talent the CTA features. */}
      {personPickerEntryId && (() => {
        const q = personPickerQuery.trim().toLowerCase();
        const results = (allTalents ?? [])
          .filter(t => !q
            || t.name.toLowerCase().includes(q)
            || t.ticker.toLowerCase().includes(q)
            || (t.industry ?? '').toLowerCase().includes(q))
          .slice(0, 60);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPersonPickerEntryId(null)}>
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
                <span className="text-sm font-semibold text-zinc-100">Change person</span>
                <button onClick={() => setPersonPickerEntryId(null)} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {/* Search */}
              <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
                <input
                  autoFocus
                  value={personPickerQuery}
                  onChange={e => setPersonPickerQuery(e.target.value)}
                  placeholder="Search by name, ticker, or industry…"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
                />
              </div>
              {/* List */}
              <div className="overflow-y-auto flex-1 p-2">
                {talentsLoading && (
                  <p className="text-sm text-zinc-600 text-center py-8">Loading roster…</p>
                )}
                {!talentsLoading && talentsError && (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <p className="text-sm text-red-400 text-center px-4">Couldn’t load the roster.</p>
                    <p className="text-[11px] text-zinc-600 text-center px-4 break-words">{talentsError}</p>
                    <button
                      onClick={loadTalents}
                      className="px-3 py-1.5 rounded-md border border-zinc-700 text-xs font-medium text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {!talentsLoading && !talentsError && results.length === 0 && (
                  <p className="text-sm text-zinc-600 text-center py-8">No matches.</p>
                )}
                {!talentsLoading && !talentsError && results.map(t => (
                  <button
                    key={t.id}
                    onClick={() => applyTalent(personPickerEntryId, t)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left"
                  >
                    <span className="relative shrink-0 flex items-center justify-center rounded-lg overflow-hidden" style={{ width: 36, height: 36, background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                      <span style={{ fontSize: 9, color: '#52525b', fontWeight: 600 }}>
                        {t.name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                      </span>
                      {t.photo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.photo_url} alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                      )}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="text-sm text-zinc-100 truncate">{t.name}</span>
                      <span className="text-[11px] text-zinc-500 truncate">{t.industry || 'Unknown'}</span>
                    </span>
                    <span className="shrink-0 text-[11px] font-mono text-zinc-500">{t.ticker}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── AI Pairs panel ── */}
      {showAiGroupsPanel && (
        <div className="fixed top-[52px] right-0 z-30 bg-zinc-950 border-l border-zinc-800 w-[360px] h-[calc(100vh-52px)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-zinc-400">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
              </svg>
              <span className="text-sm font-semibold text-zinc-100">AI Pairs</span>
              {aiGroupsLoading && (
                <SpinnerIcon size={13} className="text-zinc-500 animate-spin" />
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  aiGroupsFetchedRef.current = false;
                  setAiGroups([]);
                  setAiGroupsError(null);
                  openAiGroupsPanel(aiGroupsEntryId ?? '');
                }}
                disabled={aiGroupsLoading}
                title="Refresh AI suggestions"
                className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-200 disabled:opacity-30 transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                  <path d="M3 21v-5h5"/>
                </svg>
              </button>
              <button
                onClick={() => setShowAiGroupsPanel(false)}
                className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {aiGroupsLoading && aiGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <SpinnerIcon size={18} className="text-zinc-500 animate-spin" />
                <span className="text-[11px] text-zinc-500">Asking AI…</span>
              </div>
            ) : aiGroupsError ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 px-4">
                <span className="text-[11px] text-red-400 text-center">{aiGroupsError}</span>
              </div>
            ) : aiGroups.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="text-[11px] text-zinc-600">No pairs found</span>
              </div>
            ) : (
              <div className="p-2 flex flex-col gap-0.5">
                {aiGroups.map((group, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      if (!aiGroupsEntryId) return;
                      setChartsMarketsMap(prev => ({ ...prev, [aiGroupsEntryId]: [group.a, group.b] }));
                      setChartsNameOverrideMap(prev => ({ ...prev, [aiGroupsEntryId]: [group.a.name, group.b.name] }));
                      setChartsTrendsLoadedMap(prev => ({ ...prev, [aiGroupsEntryId]: [false, false] }));
                      setChartsTrendsLoadingMap(prev => ({ ...prev, [aiGroupsEntryId]: [false, false] }));
                      onUpdateEntry(aiGroupsEntryId, 'caption', `${group.a.name} and ${group.b.name}'s Pauv over time:`);
                      setShowAiGroupsPanel(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors text-left"
                  >
                    <div className="flex items-center shrink-0" style={{ gap: -6 }}>
                      {([group.a, group.b] as const).map((m, mi) => (
                        <span
                          key={mi}
                          className="relative flex items-center justify-center rounded-full overflow-hidden"
                          style={{ width: 30, height: 30, background: '#1e1e1e', border: '2px solid #09090b', marginLeft: mi === 1 ? -6 : 0 }}
                        >
                          <span className="text-[7px] text-zinc-500 font-semibold select-none">
                            {m.name.split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                          </span>
                          {m.photo_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.photo_url} alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                        </span>
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-zinc-100 truncate leading-tight">
                        {group.a.name} <span className="text-zinc-500 font-normal">vs</span> {group.b.name}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5">{group.reason}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Settings panel — fixed right column ── */}
      {isSelectedCarousel && selectedEntry && (
        <div className="fixed top-[52px] right-0 z-20 bg-transparent w-[360px] h-[calc(100vh-52px)] flex flex-col">
          <CarouselSettingsPanel
            settings={getSettings(selectedEntry.id)}
            onChange={partial => updateSettings(selectedEntry.id, partial)}
            videoMode={selectedEntry.carouselSubMode === 'video'}
          />
        </div>
      )}
    </div>
  );
}
