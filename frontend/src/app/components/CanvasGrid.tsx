'use client';

import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { TikTokCanvas } from './TikTokCanvas';
import type { TikTokCanvasRef } from './TikTokCanvas';
import CarouselCanvas, { CAROUSEL_PREVIEW_W } from './CarouselCanvas';
import { CarouselSettingsPanel } from './CarouselSettingsPanel';
import { defaultCarouselSettings } from './carouselTypes';
import type { CarouselCanvasRef, CarouselSettings, CarouselBgLayerState } from './carouselTypes';
import { useCarouselTemplates } from '../hooks/useCarouselTemplates';
import type { VideoEntry, BrandProps, SlideType } from '../types';
import type { RecordingState } from './TikTokCanvas/types';
import { VideoControlsBar } from './VideoControlsBar';
import { bestVideoUrl } from '@/lib/utils';
import { BTN_ICON, BTN_TEXT } from '@/lib/ui-constants';
import {
  UploadIcon, ArrowRightIcon, SpinnerIcon,
  TrashIcon, CloseIcon, DownloadIcon, VideoIcon, LinkIcon, CropIcon,
} from '@/lib/icons';

const CARD_W = CAROUSEL_PREVIEW_W; // 410 — same width as canvas preview

interface CanvasGridProps {
  entries: VideoEntry[];
  canvasRefsMap: MutableRefObject<Map<string, TikTokCanvasRef>>;
  carouselRefsMap: MutableRefObject<Map<string, CarouselCanvasRef>>;
  brand: BrandProps;
  onAddRow: (carouselSlideType?: SlideType) => void;
  onRemoveRow: (id: string) => void;
  onDownloadAll: () => void;
  onHandleVideoError: (id: string) => void;
  onUpdateEntry: (id: string, field: 'url' | 'caption', value: string) => void;
  onUpdateCarouselEntry: (id: string, field: 'imageSrc' | 'headline' | 'subheadline', value: string) => void;
  onUpdateLocalVideo: (id: string, src: string, name: string) => void;
  onFetchVideo: (id: string) => void;
  onSetCarouselSubMode: (id: string, mode: 'image' | 'video') => void;
  userId: string | null;
  settingsMap: Record<string, CarouselSettings>;
  setSettingsMap: Dispatch<SetStateAction<Record<string, CarouselSettings>>>;
  pendingAiSeed?: { imageSrc: string; headline: string; subheadline: string; subheadline2?: string } | null;
  onAiSeedConsumed?: () => void;
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
  onUpdateCarousel: (field: 'imageSrc' | 'headline' | 'subheadline', value: string) => void;
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
  onUpdateField: (field: 'url' | 'caption', value: string) => void;
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

        <div className="px-3 py-2">
          <textarea
            value={entry.caption}
            onChange={e => onUpdateField('caption', e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault(); }}
            placeholder="Caption…"
            rows={2}
            className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none resize-none leading-relaxed"
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
  pendingAiSeed, onAiSeedConsumed,
}: CanvasGridProps) {
  const isCarousel = entries.length > 0 && entries[0].mode === 'carousel';

  const videoRenderEntries = entries.filter(e =>
    e.mode !== 'carousel' && !e.loading && (
      e.localVideoSrc || (e.data && !(e.data.images && e.data.images.length > 0))
    )
  );

  const [selectedId,                setSelectedId]                = useState<string>(entries[0]?.id ?? '');
  const [scaleMap,                  setScaleMap]                  = useState<Record<string, number>>({});
  const [bgStateMap,                setBgStateMap]                = useState<Record<string, CarouselBgLayerState>>({});
  const [viewScale,                 setViewScale]                 = useState(0.9);
  const [recordingStateMap,         setRecordingStateMap]         = useState<Record<string, RecordingState>>({});
  const [carouselRecordingStateMap, setCarouselRecordingStateMap] = useState<Record<string, RecordingState>>({});
  const [canvasRefVersion,          setCanvasRefVersion]          = useState(0);
  const [carouselRefVersion,        setCarouselRefVersion]        = useState(0);
  const [videoZoomMap,              setVideoZoomMap]              = useState<Record<string, number>>({});

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
        {/* View zoom */}
        <div className="flex items-center gap-2">
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
          {videoRenderEntries.length > 0 && (
            <button onClick={onDownloadAll} className="flex items-center gap-1.5 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-black hover:bg-zinc-100 transition-colors">
              <DownloadIcon size={11} stroke="currentColor" />
              Download All
            </button>
          )}
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
                    onFetch={() => onFetchVideo(entry.id)}
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
                          <span className="text-[10px] text-zinc-500 w-8 text-right tabular-nums shrink-0">
                            {Math.round(scale * 100)}%
                          </span>
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
                        <span className="text-[10px] text-zinc-500 w-8 text-right tabular-nums shrink-0">
                          {Math.round(getVideoZoom(entry.id) * 100)}%
                        </span>
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
                          <button
                            onClick={() => canvasRefsMap.current.get(entry.id)?.centerBox()}
                            className="flex items-center h-9 px-2.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors text-[10px] font-medium shrink-0"
                            title="Center"
                          >Center</button>
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
                          onRecordingStateChange={state =>
                            setRecordingStateMap(prev => ({ ...prev, [entry.id]: state }))
                          }
                        />
                      )}
                    </div>
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
        />
      </div>

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
