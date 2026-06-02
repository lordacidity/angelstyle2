'use client';

import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { TikTokCanvas } from './TikTokCanvas';
import type { TikTokCanvasRef, MarketData, SparkPoint } from './TikTokCanvas';
import CarouselCanvas, { CAROUSEL_PREVIEW_W } from './CarouselCanvas';
import { CarouselSettingsPanel } from './CarouselSettingsPanel';
import { defaultCarouselSettings } from './carouselTypes';
import type { CarouselCanvasRef, CarouselSettings, CarouselBgLayerState } from './carouselTypes';
import { useCarouselTemplates } from '../hooks/useCarouselTemplates';
import type { VideoEntry, BrandProps, SlideType, VideoData } from '../types';
import type { RecordingState } from './TikTokCanvas/types';
import { VideoControlsBar } from './VideoControlsBar';
import { EditablePct } from './EditablePct';
import { bestVideoUrl } from '@/lib/utils';
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
  onDownloadAll: () => void;
  onHandleVideoError: (id: string) => void;
  onUpdateEntry: (id: string, field: 'url' | 'caption' | 'context', value: string) => void;
  onUpdateCarouselEntry: (id: string, field: 'imageSrc' | 'headline' | 'subheadline' | 'articleUrl', value: string) => void;
  onUpdateLocalVideo: (id: string, src: string, name: string) => void;
  onFetchVideo: (id: string) => Promise<VideoData | null>;
  onSetCarouselSubMode: (id: string, mode: 'image' | 'video') => void;
  userId: string | null;
  settingsMap: Record<string, CarouselSettings>;
  setSettingsMap: Dispatch<SetStateAction<Record<string, CarouselSettings>>>;
  pendingAiSeed?: { imageSrc: string; headline: string; subheadline: string; subheadline2?: string; articleUrl?: string } | null;
  onAiSeedConsumed?: () => void;
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

        <div className="px-3 py-2 border-b border-zinc-800">
          <textarea
            value={entry.caption}
            onChange={e => onUpdateField('caption', e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault(); }}
            placeholder="Caption…"
            rows={2}
            className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none resize-none leading-relaxed"
          />
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
  onAddRow, onRemoveRow, onDownloadAll, onHandleVideoError,
  onUpdateEntry, onUpdateCarouselEntry, onUpdateLocalVideo,
  onFetchVideo, onSetCarouselSubMode, userId,
  settingsMap, setSettingsMap,
  pendingAiSeed, onAiSeedConsumed, onBackToAi,
}: CanvasGridProps) {
  const isCarousel = entries.length > 0 && entries[0].mode === 'carousel';

  const [selectedId,                setSelectedId]                = useState<string>(entries[0]?.id ?? '');
  const [scaleMap,                  setScaleMap]                  = useState<Record<string, number>>({});
  const [bgStateMap,                setBgStateMap]                = useState<Record<string, CarouselBgLayerState>>({});
  const [viewScale,                 setViewScale]                 = useState(0.9);
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
  // CTA widget size per entry: 'large' (full row w/ industry + sparkline) or
  // 'small' (one-line: photo, name, price, change). Defaults to 'large'.
  const [marketSizeMap,           setMarketSizeMap]           = useState<Record<string, 'large' | 'small'>>({});

  // Per-entry user overrides for the selected market's display fields
  interface MarketOverride {
    name: string; industry: string; photo_url: string | null;
    priceUsd: string; lifetimeChangePct: string;
  }
  const [marketOverrideMap, setMarketOverrideMap] = useState<Record<string, MarketOverride>>({});

  // Per-entry sparkline data (fetched when a market is selected)
  const [sparklineMap, setSparklineMap] = useState<Record<string, SparkPoint[]>>({});

  // Deterministic pseudo-random sparkline (LCG seeded on ticker). MARKETING:
  // a wandering line that has genuine ups AND downs but trends upward and ends
  // higher than it started — a believable rising chart, not an extreme straight
  // climb. Drawn in natural order (the canvas no longer sorts it ascending).
  function generateFallbackSparkline(ticker: string): SparkPoint[] {
    let seed = ticker.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x1234) >>> 0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
    const N = 16;
    // Kalshi-style step chart: a MOMENTUM walk (autocorrelated shocks → sustained
    // runs / legs, real pullbacks — not white noise, not a straight ramp) plus an
    // upward trend so it clearly closes higher, normalized to fill the box. Fewer
    // points → chunkier steps. Seeded → unique per ticker.
    const raw: number[] = [];
    let v = 0, m = 0;
    for (let i = 0; i < N; i++) {
      m = m * 0.68 + (rand() - 0.5) * 0.6;   // momentum: shocks persist into legs
      v += m;
      raw.push(v);
    }
    const span = Math.max(1e-6, Math.max(...raw) - Math.min(...raw));
    const trend = (1.05 + rand() * 0.6) * span;         // upward pull — a touch stronger
    const withTrend = raw.map((x, i) => x + (i / (N - 1)) * trend);
    const lo = Math.min(...withTrend), hi = Math.max(...withTrend);
    const range = Math.max(1e-6, hi - lo);
    return withTrend.map((x, i) => ({
      value: 0.1 + ((x - lo) / range) * 0.8,            // fill [0.1, 0.9]
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

  // Build a MarketData object merging the selected talent with any user overrides
  const getMarketData = useCallback((entryId: string): MarketData | null => {
    const sel = marketMap[entryId];
    if (!sel) return null;
    const ov = marketOverrideMap[entryId];
    // MARKETING: always use the synthetic ticker-seeded fallback so every
    // market gets a healthy-looking upward green curve. Real API data is
    // unreliable for our purpose — some markets return a single point or all
    // identical values, which renders as a flat line and undercuts the buy
    // signal we want the post to send.
    const spark = generateFallbackSparkline(sel.ticker);
    const syntheticPct = syntheticPctForTicker(sel.ticker);
    const size = marketSizeMap[entryId] ?? 'large';
    if (!ov) {
      return {
        ...(sel as unknown as MarketData),
        sparkline: spark,
        size,
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
      price: {
        usd:              !isNaN(priceNum ?? NaN) ? priceNum : sel.price.usd,
        lifetimeChangePct: !isNaN(pctNum ?? NaN) ? pctNum  : syntheticPct,
      },
    };
  }, [marketMap, marketOverrideMap, sparklineMap, marketSizeMap]);


  const generateSocialCaption = useCallback(async (entry: VideoEntry) => {
    setSocialCaptionMap(prev => ({
      ...prev,
      [entry.id]: { text: prev[entry.id]?.text ?? '', loading: true, error: null, copied: false },
    }));
    try {
      const r = await fetch('/api/ai/social-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url:        entry.url || undefined,
          caption:    entry.caption || undefined,
          context:    entry.context || undefined,
          videoTitle: entry.data?.title || undefined,
          author:     entry.data?.author?.nickname || undefined,
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

      let finalText = generated;
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
          }),
        });
        if (cr.ok) {
          const cta = await cr.json() as { talent?: Talent; ctaParagraph?: string; matchType?: string; error?: string };
          if (cta.talent && !cta.error) {
            const t = cta.talent;
            // Fill the Market widget exactly as a manual pick would.
            setMarketMap(prev => ({ ...prev, [entry.id]: t }));
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
            // Swap the caption's closing paragraph for the CTA naming this talent.
            if (cta.ctaParagraph) {
              const paras = generated.split(/\n\s*\n/);
              if (paras.length > 0) {
                paras[paras.length - 1] = cta.ctaParagraph;
                finalText = paras.join('\n\n');
              }
            }
          }
        }
      } catch { /* CTA pick is best-effort — keep the caption as written */ }

      setSocialCaptionMap(prev => ({
        ...prev,
        [entry.id]: { text: finalText, loading: false, error: null, copied: false },
      }));
    } catch (e) {
      setSocialCaptionMap(prev => ({
        ...prev,
        [entry.id]: { text: prev[entry.id]?.text ?? '', loading: false, error: String(e), copied: false },
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSparkline]);

  // "Next" in the media tab: fetch the video, then — for video posts — auto-run
  // the caption generator (which itself chains the CTA pick). One action instead
  // of three. If the fetch fails, the error is already surfaced on the entry.
  const handleFetchThenGenerate = useCallback(async (entry: VideoEntry) => {
    const data = await onFetchVideo(entry.id);
    if (!data) return;
    await generateSocialCaption({ ...entry, data });
  }, [onFetchVideo, generateSocialCaption]);

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

  const isSelectedVideo = !isSelectedCarousel && selectedEntry && (
    !!selectedEntry.localVideoSrc || (!!selectedEntry.data && !selectedEntry.loading)
  );
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
          {/* Download All moved into the export bar (bottom-right) — appears after Export is pressed. */}
        </div>
      </div>

      {/* ── Vertical scroll column ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scroll-smooth"
        style={{ paddingRight: isSelectedCarousel && selectedEntry ? 360 : 0 }}
      >
        <div className="flex flex-col items-center gap-8 py-6 px-4" style={{ zoom: viewScale }}>

          {entries.map((entry, index) => {
            const isSelected      = entry.id === (selectedEntry?.id ?? '');
            const isEntryCarousel = entry.mode === 'carousel';

            const isCarouselVideo   = isEntryCarousel && entry.carouselSubMode === 'video';
            const hasCarouselRender = isEntryCarousel && (
              (!isCarouselVideo && (!!entry.imageSrc || !!entry.headline || !!entry.subheadline)) ||
              (isCarouselVideo && (!!entry.localVideoSrc || (!!entry.data && !entry.loading)))
            );
            const hasVideoRender = !isEntryCarousel && !entry.loading && (
              !!entry.localVideoSrc
              || (!!entry.data && !(entry.data.images && entry.data.images.length > 0))
            );
            const hasRender = hasCarouselRender || hasVideoRender;
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

                    {/* Video canvas zoom + delete (non-carousel only) */}
                    {!isEntryCarousel && (
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
                            onClick={() => canvasRefsMap.current.get(entry.id)?.resetTrim()}
                            className="flex items-center h-9 px-2.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors text-[10px] font-medium shrink-0"
                            title="Reset trim"
                          >Reset trim</button>
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
                          brand={entry.mode === 'caption' ? 'clean' : 'sonotrade'}
                          overlayLogoSrc={brand.logoSrc || '/templatelogo.png'}
                          overlayDisplayName={brand.displayName || 'Sonotrade'}
                          overlayHandle={brand.handle || '@SonotradeHQ'}
                          overlayVerified={true}
                          overlayCaption={entry.caption}
                          marketData={entry.mode === 'twitter' ? getMarketData(entry.id) : null}
                          onRecordingStateChange={state =>
                            setRecordingStateMap(prev => ({ ...prev, [entry.id]: state }))
                          }
                        />
                      )}
                    </div>

                    {/* Market selector — Twitter template only.
                        Lets the user pick a Pauv market and renders its
                        details row on the canvas below the video box.
                        Selected state and list rows match the ArtistRow
                        design from pauv-the-app/MobileTradeList.tsx. */}
                    {entry.mode === 'twitter' && (() => {
                      const selected = marketMap[entry.id] ?? null;
                      // The CTA UI only appears AFTER the caption + CTA have been
                      // generated (auto-pick sets the market). No pre-generation
                      // search/picker — the generated CTA is the first thing shown.
                      if (!selected) return null;
                      return (
                        <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-800">
                            <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Market</span>
                            <div className="flex items-center gap-2">
                              {/* CTA size toggle — Large (full row) vs Small (one line). */}
                              <div className="flex items-center rounded-md border border-zinc-800 overflow-hidden">
                                {(['large', 'small'] as const).map(sz => {
                                  const active = (marketSizeMap[entry.id] ?? 'large') === sz;
                                  return (
                                    <button
                                      key={sz}
                                      onClick={() => setMarketSizeMap(prev => ({ ...prev, [entry.id]: sz }))}
                                      title={sz === 'large' ? 'Full row: photo, name, industry, sparkline, price, change' : 'One line: photo, name, price, change'}
                                      className={`px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${active ? 'bg-zinc-700 text-zinc-100' : 'bg-transparent text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                      {sz}
                                    </button>
                                  );
                                })}
                              </div>
                              {selected && (
                                <button
                                  onClick={() => {
                                    setMarketMap(prev => ({ ...prev, [entry.id]: null }));
                                    setMarketOverrideMap(prev => { const n = { ...prev }; delete n[entry.id]; return n; });
                                  }}
                                  className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>
                          {(() => {
                            const ov = marketOverrideMap[entry.id] ?? {
                              name: selected.name, industry: selected.industry ?? '',
                              photo_url: selected.photo_url,
                              priceUsd: selected.price.usd?.toFixed(2) ?? '',
                              lifetimeChangePct: selected.price.lifetimeChangePct?.toFixed(2) ?? '',
                            };
                            const setOv = (patch: Partial<typeof ov>) =>
                              setMarketOverrideMap(prev => ({ ...prev, [entry.id]: { ...ov, ...patch } }));
                            const displayPhoto = ov.photo_url;
                            const pctVal = parseFloat(ov.lifetimeChangePct);
                            // MARKETING: always render as positive (green + up arrow) so the
                            // preview always encourages buying, regardless of real direction.
                            const isPos = true;
                            const changeColor = '#04df9d';
                            return (
                              <div>
                                {/* Preview row (ArtistRow style, read from overrides) */}
                                <div className="flex items-center" style={{ gap: 12, padding: '10px 12px', borderBottom: '1px solid #1a1a1a' }}>
                                  {/* Avatar — click to open photo picker */}
                                  <button
                                    onClick={() => openPhotoPicker(entry.id, ov.name || selected.name)}
                                    title="Change photo"
                                    className="relative shrink-0 flex items-center justify-center rounded-lg overflow-hidden group"
                                    style={{ width: 42, height: 42, background: '#1e1e1e', border: '1px solid #2a2a2a' }}
                                  >
                                    <span style={{ fontSize: 10, color: '#52525b', fontWeight: 600 }}>
                                      {(ov.name || selected.name).split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                                    </span>
                                    {displayPhoto && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={displayPhoto} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                    )}
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                                    </div>
                                  </button>
                                  {/* Name + Industry — left-aligned, stacked tight on top of each other */}
                                  <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
                                    <span style={{ fontSize: 19, fontWeight: 600, color: '#fff', letterSpacing: '-0.015em', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ov.name || '—'}</span>
                                    <span style={{ fontSize: 12, color: '#71717a', lineHeight: 1 }}>{ov.industry || '—'}</span>
                                  </div>
                                  {/* Sparkline — 80×30, between name/industry and price/change (SXSparkline) */}
                                  {(() => {
                                    // MARKETING: always synthetic, ticker-seeded so the picker
                                    // shows the exact same green upward curve that will appear
                                    // in the exported video. Never trust the real API data here
                                    // — it would diverge between picker and export.
                                    const spark = generateFallbackSparkline(selected.ticker);
                                    const sparkColor = '#04df9d';
                                    const W = 96, H = 32, pad = 2;
                                    const paddedSpark = spark.length === 1 ? [spark[0]!, spark[0]!] : spark;
                                    const vals = paddedSpark.map(p => p.value);
                                    const vMin = Math.min(...vals), vMax = Math.max(...vals);
                                    const vRange = vMax - vMin;
                                    const pts = paddedSpark.map((p, i) => ({
                                      x: (i / (paddedSpark.length - 1)) * W,
                                      y: vRange === 0 ? H / 2 : pad + (1 - (p.value - vMin) / vRange) * (H - pad * 2),
                                    }));
                                    let d = `M${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;
                                    for (let i = 0; i < pts.length - 1; i++) {
                                      d += ` H${pts[i+1]!.x.toFixed(1)} V${pts[i+1]!.y.toFixed(1)}`;
                                    }
                                    return (
                                      <div style={{ width: 80, height: 30, flexShrink: 0, marginRight: 16 }}>
                                        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }}>
                                          <path d={d} fill="none" stroke={sparkColor} strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
                                        </svg>
                                      </div>
                                    );
                                  })()}
                                  {/* Price + Change */}
                                  <div className="flex flex-col items-end shrink-0" style={{ gap: 3 }}>
                                    <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 19, fontWeight: 600, color: '#fff', lineHeight: 1 }}>
                                      {ov.priceUsd !== '' && !isNaN(parseFloat(ov.priceUsd))
                                        ? parseFloat(ov.priceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                        : '—'}
                                    </span>
                                    <div className="flex items-center" style={{ gap: 3, lineHeight: 1 }}>
                                      {ov.lifetimeChangePct !== '' && !isNaN(pctVal) && (
                                        <>
                                          <svg viewBox="0 0 24 18" width="13" height="13" style={{ color: changeColor, flexShrink: 0, transform: `rotate(${isPos ? '0' : '180'}deg)` }}>
                                            <path fill="currentColor" d="m12 0 10.392 14.25H1.608z" />
                                          </svg>
                                          <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12, fontWeight: 500, color: changeColor, lineHeight: 1 }}>
                                            {Math.abs(pctVal).toFixed(1)}%
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {/* Edit fields */}
                                <div className="px-3 py-2.5 flex flex-col gap-2">
                                  <div className="flex gap-2">
                                    <input value={ov.name} onChange={e => setOv({ name: e.target.value })}
                                      placeholder="Name" className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600" />
                                    <input value={ov.industry} onChange={e => setOv({ industry: e.target.value })}
                                      placeholder="Industry" className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600" />
                                  </div>
                                  <div className="flex gap-2">
                                    <input value={ov.priceUsd} onChange={e => setOv({ priceUsd: e.target.value })}
                                      placeholder="Price (USD)" type="number" step="0.01"
                                      className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 font-mono" />
                                    <input value={ov.lifetimeChangePct} onChange={e => setOv({ lifetimeChangePct: e.target.value })}
                                      placeholder="Change %" type="number" step="0.01"
                                      className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 font-mono" />
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    {/* Social caption generator — only for video-mode posts.
                        Lives directly below the rendered preview so the user
                        can generate, edit, and copy a long-form post caption
                        without leaving the row. */}
                    {!isEntryCarousel && (() => {
                      const sc = socialCaptionMap[entry.id];
                      return (
                        <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-800">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Post caption</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
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
                                onClick={() => generateSocialCaption(entry)}
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
                                rows={Math.min(14, Math.max(6, sc.text.split('\n').length + Math.ceil(sc.text.length / 70)))}
                                className="w-full bg-transparent text-[12px] text-zinc-200 placeholder-zinc-700 outline-none resize-y leading-relaxed"
                              />
                            ) : (
                              <span className="text-[11px] text-zinc-600">
                                Click Generate to draft a long-form caption. Edit the Context field above to steer it.
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}

          {isCarousel
            ? <CarouselAddRow onAdd={type => onAddRow(type)} />
            : <GhostAddCard onAdd={() => onAddRow()} />
          }

        </div>
      </div>

      {/* ── Video controls bar — shared bottom panel for video templates ── */}
      <div className="bg-zinc-950" style={{ paddingRight: isCarouselVideoSelected ? 360 : 0 }}>
        <VideoControlsBar
          entryId={showVideoControls ? selectedEntry!.id : null}
          activeRef={activeVideoRef}
          recordingState={activeRecordingState}
          videoSrc={activeVideoSrc}
          onDownloadAll={onDownloadAll}
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
                        setMarketOverrideMap(prev => ({
                          ...prev,
                          [photoPickerEntryId!]: { ...(prev[photoPickerEntryId!] ?? { name: '', industry: '', photo_url: null, priceUsd: '', lifetimeChangePct: '' }), photo_url: p.url },
                        }));
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
