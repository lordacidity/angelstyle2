'use client';

// The Carousel editor — extracted from CanvasGrid when carousel left /media.
// Owns the page canvases, per-page style settings, the chart-background state
// (the module's 4th card), and export. Pages live in useCarouselPages (owned by
// CarouselSection so wizard → editor seeding is a plain state handoff).

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import CarouselCanvas, { CAROUSEL_PREVIEW_W } from '../CarouselCanvas';
import type { CarouselChartBg } from '../CarouselCanvas';
import { CarouselSettingsPanel } from '../CarouselSettingsPanel';
import { defaultCarouselSettings, defaultSwipeStyle } from '../carouselTypes';
import type { CarouselCanvasRef, CarouselSettings, CarouselBgLayerState } from '../carouselTypes';
import { useCarouselTemplates } from '../../hooks/useCarouselTemplates';
import { ChartsImageInputCard } from '../ChartsImageInputCard';
import type { ChartsMarket } from '../ChartsCanvas';
import type { ChartsImageMarket, ChartsImageDirection, ChartsImageNoiseLevel, ChartsImageSubMode } from '../ChartsImageCanvas';
import type { PreloadedAudio } from '../ChartsInputCard';
import type { RecordingState } from '../TikTokCanvas/types';
import { VideoControlsBar } from '../VideoControlsBar';
import { EditablePct } from '../EditablePct';
import { CarouselInputCard } from './CarouselInputCard';
import { resolvePhotoSrc } from './photoSrc';
import type { CarouselPagesApi } from './useCarouselPages';
import type { VideoEntry, BrandProps, SlideType } from '../../types';
import { bestVideoUrl } from '@/lib/utils';
import { BTN_ICON, BTN_TEXT } from '@/lib/ui-constants';
import { SpinnerIcon, DownloadIcon, TrashIcon, CropIcon } from '@/lib/icons';

const CARD_W = CAROUSEL_PREVIEW_W;

interface Talent {
  id: string;
  ticker: string;
  name: string;
  photo_url: string | null;
  industry: string | null;
  price: { usd: number | null; lifetimeChangePct: number | null; holders: number | null };
}

// Set when the wizard builds a 4-card module: configures the last page as a
// chart-background card for the module's market (Trends fetch kicked
// immediately), stamps the pauv logo + swipe onto the photo pages, gives
// card 1 its context circle, and keeps the wizard's photo pool around for
// one-click photo swaps.
export interface CarouselModuleSeed {
  chartEntryId: string;
  // Entry ids of the three photo pages (cards 1–3, in order).
  photoPageIds: string[];
  // Context image for card 1's circle (logo/symbol for the story), if picked.
  circlePhotoUrl?: string;
  // The AI search phrase behind the circle image — reused when changing it.
  circleQuery?: string;
  // Every photo the wizard showed — offered as swaps in the left panel.
  photoPool: Array<{ url: string; thumbnail: string; title?: string }>;
  market: {
    id: string;
    ticker: string;
    name: string;
    photo_url: string | null;
    industry: string | null;
    price?: { usd: number | null; lifetimeChangePct?: number | null } | null;
  };
}

interface CarouselStudioProps {
  pagesApi: CarouselPagesApi;
  userId: string | null;
  brand: BrandProps;
  onBackHome: () => void;
  pendingSeed: CarouselModuleSeed | null;
  onSeedConsumed: () => void;
}

const SLIDE_TYPE_LABELS: [SlideType, string][] = [
  ['main',        'Main'],
  ['supporting_1','Supporting 1'],
  ['supporting_2','Supporting 2'],
];

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

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

export function CarouselStudio({
  pagesApi, userId, brand, onBackHome, pendingSeed, onSeedConsumed,
}: CarouselStudioProps) {
  const { pages } = pagesApi;

  const [selectedId, setSelectedId] = useState<string>('');
  const [scaleMap,   setScaleMap]   = useState<Record<string, number>>({});
  const [bgStateMap, setBgStateMap] = useState<Record<string, CarouselBgLayerState>>({});
  const [viewScale,  setViewScale]  = useState(0.9);

  const [settingsMap, setSettingsMap] = useState<Record<string, CarouselSettings>>({});
  const { savedSlides, loading: templatesLoading } = useCarouselTemplates(userId);
  const savedSlidesRef  = useRef(savedSlides);
  savedSlidesRef.current = savedSlides;

  const [recordingStateMap, setRecordingStateMap] = useState<Record<string, RecordingState>>({});
  const carouselRefsMap       = useRef(new Map<string, CarouselCanvasRef>());
  const carouselRefRegistered = useRef(new Set<string>());
  const [refVersion, setRefVersion] = useState(0);

  // Background source per page. 'chart' binds the page to the chartsImage* maps
  // below (same state shape the media Charts Image mode uses).
  const [carouselBgSourceMap, setCarouselBgSourceMap] = useState<Record<string, 'photo' | 'video' | 'chart'>>({});
  const [chartsImageMarketMap,           setChartsImageMarketMap]           = useState<Record<string, ChartsMarket | null>>({});
  const [chartsImageNameOverrideMap,     setChartsImageNameOverrideMap]     = useState<Record<string, string>>({});
  const [chartsImageTrendsLoadingMap,    setChartsImageTrendsLoadingMap]    = useState<Record<string, boolean>>({});
  const [chartsImageTrendsLoadedMap,     setChartsImageTrendsLoadedMap]     = useState<Record<string, boolean>>({});
  const [chartsImageTrendsErrorMap,      setChartsImageTrendsErrorMap]      = useState<Record<string, string | null>>({});
  const [chartsImageIndustryOverrideMap, setChartsImageIndustryOverrideMap] = useState<Record<string, string>>({});
  const [chartsImageDirectionMap,        setChartsImageDirectionMap]        = useState<Record<string, ChartsImageDirection>>({});
  const [chartsImageNoiseLevelMap,       setChartsImageNoiseLevelMap]       = useState<Record<string, ChartsImageNoiseLevel>>({});
  const [chartsImageSubModeMap,          setChartsImageSubModeMap]          = useState<Record<string, ChartsImageSubMode>>({});
  const [chartsImageSpeedMap,            setChartsImageSpeedMap]            = useState<Record<string, number>>({});
  const [chartsImageAudioMap,            setChartsImageAudioMap]            = useState<Record<string, { label: string; url: string; durationMs: number } | null>>({});

  // Shared audio library (for the chart page's muxed track)
  const [preloadedAudios, setPreloadedAudios] = useState<PreloadedAudio[]>([]);
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
        setChartsImageAudioMap(cur => {
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
    const audio = preloadedAudios[idx];
    if (audio && audio.status === 'ready') {
      setChartsImageAudioMap(cur => {
        const next = { ...cur };
        for (const id of Object.keys(next)) {
          if (next[id]?.url === audio.url) next[id] = { ...next[id]!, label };
        }
        return next;
      });
    }
  }, [preloadedAudios]);

  // Talent roster — lazy-loaded for the chart page's market search.
  const [allTalents,     setAllTalents]     = useState<Talent[] | null>(null);
  const [talentsLoading, setTalentsLoading] = useState(false);
  const talentsLoadingRef = useRef(false);
  const ensureTalents = useCallback(() => {
    if (allTalents || talentsLoadingRef.current) return;
    talentsLoadingRef.current = true;
    setTalentsLoading(true);
    fetch('/api/ai/talents')
      .then(r => r.json())
      .then((data: Talent[] | { error?: string }) => { if (Array.isArray(data)) setAllTalents(data); })
      .catch(() => {})
      .finally(() => { talentsLoadingRef.current = false; setTalentsLoading(false); });
  }, [allTalents]);

  // Photo picker (chart page market avatar)
  interface PickerPhoto { url: string; thumbnail: string; title?: string }
  const [photoPickerEntryId, setPhotoPickerEntryId] = useState<string | null>(null);
  const [photoPickerPhotos,  setPhotoPickerPhotos]  = useState<PickerPhoto[]>([]);
  const [photoPickerLoading, setPhotoPickerLoading] = useState(false);
  const [photoPickerQuery,   setPhotoPickerQuery]   = useState('');
  const [photoPickerOffset,  setPhotoPickerOffset]  = useState(0);
  const [photoPickerMore,    setPhotoPickerMore]    = useState(false);

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
    if (initialQuery.trim()) void searchPickerPhotos(initialQuery, 0, false);
  }, [searchPickerPhotos]);

  // Google Trends fetch for a chart page (same source the Charts features use).
  const loadChartTrends = useCallback((entryId: string, market: ChartsMarket, term: string) => {
    setChartsImageTrendsErrorMap(prev => ({ ...prev, [entryId]: null }));
    setChartsImageMarketMap(prev => ({ ...prev, [entryId]: { ...market, sparkline: undefined } }));
    setChartsImageTrendsLoadedMap(prev => ({ ...prev, [entryId]: false }));
    setChartsImageTrendsLoadingMap(prev => ({ ...prev, [entryId]: true }));
    fetch(`/api/charts/trends?term=${encodeURIComponent(term)}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { error?: string };
          const msg = r.status === 429 || body.error === 'rate_limited'
            ? 'Google Trends is rate-limiting — wait a moment and try again'
            : `Failed to load trends (${r.status})`;
          setChartsImageTrendsErrorMap(prev => ({ ...prev, [entryId]: msg }));
          return null;
        }
        return r.json() as Promise<Array<{ timestamp: number; value: number }>>;
      })
      .then(points => {
        if (!points || !Array.isArray(points) || !points.length) return;
        setChartsImageMarketMap(prev => {
          const cur = prev[entryId];
          return cur ? { ...prev, [entryId]: { ...cur, sparkline: points } } : prev;
        });
        setChartsImageTrendsLoadedMap(prev => ({ ...prev, [entryId]: true }));
      })
      .catch(e => setChartsImageTrendsErrorMap(prev => ({ ...prev, [entryId]: String(e) })))
      .finally(() => setChartsImageTrendsLoadingMap(prev => ({ ...prev, [entryId]: false })));
  }, []);

  // Wizard photo pool + page ids, kept after the seed is consumed so the left
  // panel can offer one-click photo swaps for the module's cards.
  const [modulePhotoPool,    setModulePhotoPool]    = useState<Array<{ url: string; thumbnail: string; title?: string }>>([]);
  const [modulePhotoPageIds, setModulePhotoPageIds] = useState<string[]>([]);
  const [moduleCircleQuery,  setModuleCircleQuery]  = useState('');
  const [swappingPhoto,      setSwappingPhoto]      = useState(false);
  // Overlay stamping waits for the saved templates, so the pauv logo / swipe /
  // circle merge ONTO the template look instead of replacing it with defaults.
  const pendingOverridesRef = useRef<{ pageIds: string[]; mainId: string; secondId?: string; thirdId?: string; circleUrl?: string } | null>(null);
  const [overridesTick, setOverridesTick] = useState(0);
  // Cards 1 + 3 get their backgrounds blurred once the auto subject-split
  // finishes (blur makes the circle easier to position).
  const pendingBlurPagesRef = useRef<Set<string>>(new Set());

  // Wizard module seed → configure the last page as the market's chart (still
  // image by default — flip to Video per-page) and start its trends fetch
  // immediately; queue the photo-page overlays + card-1 blur.
  useEffect(() => {
    if (!pendingSeed) return;
    const { chartEntryId, market, photoPageIds, circlePhotoUrl, circleQuery, photoPool } = pendingSeed;
    const mk: ChartsMarket = {
      id: market.id, name: market.name, ticker: market.ticker,
      photo_url: market.photo_url, industry: market.industry, price: market.price ?? null,
    };
    setCarouselBgSourceMap(prev => ({ ...prev, [chartEntryId]: 'chart' }));
    setChartsImageSubModeMap(prev => ({ ...prev, [chartEntryId]: 'image' }));
    setChartsImageNameOverrideMap(prev => ({ ...prev, [chartEntryId]: market.name }));
    setChartsImageMarketMap(prev => ({ ...prev, [chartEntryId]: mk }));
    loadChartTrends(chartEntryId, mk, market.name);

    setModulePhotoPool(photoPool);
    setModulePhotoPageIds(photoPageIds);
    setModuleCircleQuery(circleQuery ?? '');
    pendingOverridesRef.current = {
      pageIds: photoPageIds,
      mainId: photoPageIds[0],
      secondId: photoPageIds[1],
      thirdId: photoPageIds[2],
      circleUrl: circlePhotoUrl,
    };
    setOverridesTick(t => t + 1);
    pendingBlurPagesRef.current = new Set([photoPageIds[0], photoPageIds[2]].filter(Boolean));

    onSeedConsumed();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed]);

  // Stamp the module overlays once the saved templates are in: pauv logo
  // top-left + white SWIPE→ top-right on the photo pages, the context circle
  // on card 1, and the pauv-on-black circle on card 3.
  useEffect(() => {
    const pending = pendingOverridesRef.current;
    if (!pending || templatesLoading) return;
    pendingOverridesRef.current = null;
    setSettingsMap(prev => {
      const next = { ...prev };
      for (const id of pending.pageIds) {
        const slideType = pages.find(p => p.id === id)?.carouselSlideType ?? 'main';
        const base = prev[id] ?? savedSlidesRef.current?.[slideType]?.settings ?? defaultCarouselSettings();
        const zoneLogoSlots = [...(base.zoneLogoSlots ?? Array(9).fill(null))];
        // Top-left pauv logo on cards 1–2 only — card 3's circle already
        // carries the pauv mark, so no logo up top there.
        zoneLogoSlots[0] = id === pending.thirdId ? null : '/pauvlogo.png';
        const swipeZoneSlots = [...(base.swipeZoneSlots ?? Array(9).fill(null))];
        swipeZoneSlots[2] = defaultSwipeStyle();            // top-right zone — white SWIPE →
        next[id] = {
          ...base,
          zoneLogoSlots,
          swipeZoneSlots,
          ...(id === pending.mainId && pending.circleUrl ? { circleImageSrc: pending.circleUrl } : {}),
          // Card 2 is the meaty explainer — the text sits in a solid black band
          // at the bottom (no fade over the photo), sized between head + sub.
          ...(id === pending.secondId ? {
            showFade: false,
            bottomBandEnabled: true,
            fontSize: Math.round((base.fontSize + base.subFontSize) / 2),
          } : {}),
          // Card 3 bridges to the chart — its circle is always the pauv mark.
          ...(id === pending.thirdId ? { circleImageSrc: '/pauv-circle.png' } : {}),
        };
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overridesTick, templatesLoading, pages]);

  // Background blur for cards 1 + 3: CarouselCanvas auto-runs the subject split
  // on image load (blur amount 0); once a page's mask is ready, turn its blur
  // on — same as pressing "BG Blur" by hand.
  useEffect(() => {
    const waiting = pendingBlurPagesRef.current;
    if (waiting.size === 0) return;
    for (const id of [...waiting]) {
      if (!bgStateMap[id]?.fgMaskReady) continue;
      waiting.delete(id);
      setSettingsMap(prev => {
        const slideType = pages.find(p => p.id === id)?.carouselSlideType ?? 'main';
        const base = prev[id] ?? savedSlidesRef.current?.[slideType]?.settings ?? defaultCarouselSettings();
        return { ...prev, [id]: { ...base, bgBlurEnabled: true, bgBlurAmount: 10 } };
      });
    }
  }, [bgStateMap, pages]);

  // Swap a module card's photo for another from the wizard pool (resolved to a
  // same-origin/data: URL so exports never depend on the remote host).
  const swapModulePhoto = useCallback(async (entryId: string, url: string, thumbnail?: string) => {
    if (swappingPhoto) return;
    setSwappingPhoto(true);
    try {
      const src = await resolvePhotoSrc(url, thumbnail);
      pagesApi.updatePage(entryId, 'imageSrc', src);
      // Cards 1 + 3 re-blur after the new image's subject split completes.
      if (entryId === modulePhotoPageIds[0] || entryId === modulePhotoPageIds[2]) {
        pendingBlurPagesRef.current.add(entryId);
      }
    } finally { setSwappingPhoto(false); }
  }, [swappingPhoto, pagesApi, modulePhotoPageIds]);

  // Search MORE photos from inside the Swap strip — results append to the pool
  // (never replace), so every photo ever searched stays available.
  const [swapQuery,     setSwapQuery]     = useState('');
  const [swapOffset,    setSwapOffset]    = useState(0);
  const [swapSearching, setSwapSearching] = useState(false);
  const searchSwapPhotos = useCallback(async (query: string, offset: number) => {
    if (!query.trim() || swapSearching) return;
    setSwapSearching(true);
    try {
      const r = await fetch('/api/ai/photos/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, count: 9, offset }),
      });
      if (!r.ok) return;
      const fresh = await r.json() as Array<{ url: string; thumbnail: string; title?: string }>;
      setSwapOffset(offset + fresh.length);
      setModulePhotoPool(cur => {
        const seen = new Set(cur.map(p => p.url));
        return [...cur, ...fresh.filter(p => !seen.has(p.url))];
      });
    } finally { setSwapSearching(false); }
  }, [swapSearching]);

  // Change a page's circle image from the photo picker (resolved like the
  // background swaps so canvas export never depends on the remote host).
  const applyCirclePhoto = useCallback(async (entryId: string, url: string, thumbnail?: string) => {
    const src = await resolvePhotoSrc(url, thumbnail);
    setSettingsMap(prev => {
      const slideType = pages.find(p => p.id === entryId)?.carouselSlideType ?? 'main';
      const base = prev[entryId] ?? savedSlidesRef.current?.[slideType]?.settings ?? defaultCarouselSettings();
      return { ...prev, [entryId]: { ...base, circleImageSrc: src } };
    });
  }, [pages]);

  // Selection follows page additions: a fresh module selects page 1, a manually
  // added page selects itself.
  const prevLengthRef = useRef(pages.length);
  useEffect(() => {
    if (pages.length > prevLengthRef.current) {
      const target = prevLengthRef.current === 0 ? pages[0] : pages[pages.length - 1];
      if (target) setTimeout(() => setSelectedId(target.id), 30);
    }
    prevLengthRef.current = pages.length;
  }, [pages]);

  // Scroll selected card into view
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs  = useRef<Record<string, HTMLDivElement | null>>({});
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

  const getSettings = useCallback((id: string): CarouselSettings => {
    if (settingsMap[id]) return settingsMap[id];
    const slideType = pages.find(p => p.id === id)?.carouselSlideType ?? 'main';
    const saved = savedSlides?.[slideType];
    return saved?.settings ?? defaultCarouselSettings();
  }, [settingsMap, pages, savedSlides]);

  const updateSettings = useCallback((id: string, partial: Partial<CarouselSettings>) => {
    setSettingsMap(prev => {
      const slideType = pages.find(p => p.id === id)?.carouselSlideType ?? 'main';
      const saved = savedSlidesRef.current?.[slideType];
      const base  = prev[id] ?? saved?.settings ?? defaultCarouselSettings();
      return { ...prev, [id]: { ...base, ...partial } };
    });
  }, [pages]);

  const bgSourceOf = useCallback((entry: VideoEntry): 'photo' | 'video' | 'chart' =>
    carouselBgSourceMap[entry.id] ?? (entry.carouselSubMode === 'video' ? 'video' : 'photo'),
  [carouselBgSourceMap]);

  const chartBgOf = useCallback((entry: VideoEntry): CarouselChartBg | null => {
    if (bgSourceOf(entry) !== 'chart') return null;
    const market = chartsImageMarketMap[entry.id];
    if (!market) return null;
    return {
      market:           market as ChartsImageMarket,
      overrideName:     chartsImageNameOverrideMap[entry.id] ?? '',
      overrideIndustry: chartsImageIndustryOverrideMap[entry.id] ?? '',
      direction:        chartsImageDirectionMap[entry.id] ?? 'up',
      noiseLevel:       chartsImageNoiseLevelMap[entry.id] ?? 'none',
      subMode:          chartsImageSubModeMap[entry.id] ?? 'image',
      speed:            chartsImageSpeedMap[entry.id] ?? 1,
      audioUrl:         chartsImageAudioMap[entry.id]?.url,
    };
  }, [bgSourceOf, chartsImageMarketMap, chartsImageNameOverrideMap, chartsImageIndustryOverrideMap,
      chartsImageDirectionMap, chartsImageNoiseLevelMap, chartsImageSubModeMap, chartsImageSpeedMap, chartsImageAudioMap]);

  const selectedEntry = pages.find(p => p.id === selectedId) ?? pages[0];
  const showPanels = !!selectedEntry;
  const selectedBgSource = selectedEntry ? bgSourceOf(selectedEntry) : 'photo';
  const isSelectedVideoPage = !!selectedEntry && selectedBgSource === 'video' && (
    !!selectedEntry.localVideoSrc || (!!selectedEntry.data && !selectedEntry.loading)
  );

  // refVersion forces re-derivation once canvas refs register
  const activeVideoRef = isSelectedVideoPage && refVersion >= 0
    ? (carouselRefsMap.current.get(selectedEntry!.id) ?? null)
    : null;
  const activeRecordingState = isSelectedVideoPage ? (recordingStateMap[selectedEntry!.id] ?? null) : null;
  const activeVideoSrc = isSelectedVideoPage
    ? (selectedEntry!.localVideoSrc ?? (selectedEntry!.data ? bestVideoUrl(selectedEntry!.data) : null))
    : null;

  // Export every page in order (PNGs and MP4s alike) — used by the toolbar and
  // the video bar's Download All.
  const [exportingAll, setExportingAll] = useState(false);
  const exportAll = useCallback(async () => {
    if (exportingAll) return;
    setExportingAll(true);
    try {
      for (const p of pages) {
        const ref = carouselRefsMap.current.get(p.id);
        if (!ref) continue;
        try { await ref.startDownload(); } catch (err) { console.error(`[carousel] export failed for page ${p.id}:`, err); }
        await new Promise(r => setTimeout(r, 400));
      }
    } finally { setExportingAll(false); }
  }, [pages, exportingAll]);

  function handleClear() {
    pagesApi.clearAll();
    setSelectedId('');
    setSettingsMap({});
  }

  return (
    <div className="w-full flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-800 shrink-0 bg-[#0f0f0f]">
        <div className="flex items-center gap-2">
          <button
            onClick={onBackHome}
            title="Back to Carousel home"
            className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <span className="text-sm font-semibold text-zinc-100">Carousel</span>
          <span className="text-[10px] text-zinc-600 select-none tabular-nums w-8 text-right ml-2">{Math.round(viewScale * 100)}%</span>
          <input
            type="range" min={40} max={150} step={10}
            value={Math.round(viewScale * 100)}
            onChange={e => setViewScale(parseInt(e.target.value) / 100)}
            className="w-20 h-1 accent-white cursor-pointer"
          />
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-3">
          {selectedEntry && (() => {
            const src = selectedBgSource;
            const chartSub = chartsImageSubModeMap[selectedEntry.id] ?? 'image';
            // MP4 export when the media is a video, or the chart background is animated.
            const isVid = src === 'video' || (src === 'chart' && chartSub === 'video');
            const recState = recordingStateMap[selectedEntry.id];
            const isRec = recState?.isRecording ?? false;
            const pct   = recState?.recProgress ?? 0;
            return (
              <button
                onClick={() => carouselRefsMap.current.get(selectedEntry.id)?.startDownload()}
                disabled={isRec || exportingAll}
                className="relative flex items-center gap-1.5 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-black hover:bg-zinc-100 disabled:opacity-60 transition-colors overflow-hidden"
              >
                {isRec && (
                  <span className="absolute inset-0 bg-zinc-300 origin-left transition-none" style={{ transform: `scaleX(${pct})` }} />
                )}
                <span className="relative flex items-center gap-1.5">
                  {isRec
                    ? <SpinnerIcon size={11} style={{ animation: 'spin 1s linear infinite' }} />
                    : <DownloadIcon size={11} stroke="currentColor" />
                  }
                  {isRec ? `${Math.round(pct * 100)}%` : isVid ? 'Export' : 'PNG'}
                </span>
              </button>
            );
          })()}
          {pages.length > 1 && (
            <button
              onClick={() => void exportAll()}
              disabled={exportingAll}
              title="Export every page in order"
              className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-60 transition-colors"
            >
              {exportingAll
                ? <SpinnerIcon size={11} style={{ animation: 'spin 1s linear infinite' }} />
                : <DownloadIcon size={11} stroke="currentColor" />}
              {exportingAll ? 'Exporting…' : `All ${pages.length}`}
            </button>
          )}
          {pages.length > 0 && (
            <button
              onClick={handleClear}
              title="Clear all pages and start over"
              className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-zinc-100 transition-colors shrink-0"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Vertical scroll column ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth"
        style={{ paddingLeft: showPanels ? 450 : 0, paddingRight: showPanels ? 360 : 0 }}
      >
        <div className="flex flex-col items-center gap-8 pt-4 pb-6 px-4" style={{ zoom: viewScale }}>
          {pages.map(entry => {
            const isSelected = entry.id === (selectedEntry?.id ?? '');
            return (
              <div
                key={entry.id}
                ref={el => { cardRefs.current[entry.id] = el; }}
                className="flex flex-col items-center"
                style={{ width: CARD_W }}
              >
                <div
                  onClick={e => {
                    if ((e.target as Element).closest('[data-carousel-slot]')) return;
                    setSelectedId(entry.id);
                  }}
                  className={`relative cursor-pointer transition-all duration-150 ${
                    isSelected
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-black'
                      : 'ring-1 ring-zinc-800 hover:ring-zinc-600'
                  }`}
                >
                  <CarouselCanvas
                    ref={r => {
                      if (r) {
                        carouselRefsMap.current.set(entry.id, r);
                        if (!carouselRefRegistered.current.has(entry.id)) {
                          carouselRefRegistered.current.add(entry.id);
                          setRefVersion(v => v + 1);
                        }
                      } else {
                        carouselRefsMap.current.delete(entry.id);
                      }
                    }}
                    imageSrc={bgSourceOf(entry) === 'photo' ? (entry.imageSrc ?? '') : ''}
                    videoSrc={bgSourceOf(entry) === 'video'
                      ? (entry.localVideoSrc ?? (entry.data ? bestVideoUrl(entry.data) : undefined))
                      : undefined}
                    chartBg={chartBgOf(entry)}
                    headline={entry.headline ?? ''}
                    subheadline={entry.subheadline ?? ''}
                    settings={getSettings(entry.id)}
                    invertedSlots={(entry.carouselSlideType ?? 'main') === 'supporting_2'}
                    onScaleChange={s => setScaleMap(prev => ({ ...prev, [entry.id]: s }))}
                    onSettingsChange={partial => updateSettings(entry.id, partial)}
                    onBgLayerStateChange={s => setBgStateMap(prev => ({ ...prev, [entry.id]: s }))}
                    brandLogoSrc={brand.logoSrc || undefined}
                    onRecordingStateChange={state => setRecordingStateMap(prev => ({ ...prev, [entry.id]: state }))}
                    onHeadlineChange={text => pagesApi.updatePage(entry.id, 'headline', text)}
                    onSubheadlineChange={text => pagesApi.updatePage(entry.id, 'subheadline', text)}
                  />
                </div>
              </div>
            );
          })}

          <CarouselAddRow onAdd={type => pagesApi.addPage(type)} />
        </div>
      </div>

      {/* ── Video controls bar — trim/mute/export for video-background pages ── */}
      <div className="relative z-[70] bg-zinc-950" style={{ paddingRight: showPanels ? 360 : 0 }}>
        <VideoControlsBar
          entryId={isSelectedVideoPage ? selectedEntry!.id : null}
          activeRef={activeVideoRef}
          recordingState={activeRecordingState}
          videoSrc={activeVideoSrc}
          onDownloadAll={() => void exportAll()}
        />
      </div>

      {/* ── Left panel — the selected page's inputs + controls ── */}
      {selectedEntry && (
        <div className="fixed left-[72px] top-[52px] z-20 w-[450px] h-[calc(100vh-52px)] overflow-y-auto bg-zinc-950 border-r border-zinc-800 p-4 flex flex-col items-center gap-3">
          <CarouselInputCard
            entry={selectedEntry}
            onUpdateCarousel={(field, value) => pagesApi.updatePage(selectedEntry.id, field, value)}
            onUpdateUrl={url => pagesApi.updateUrl(selectedEntry.id, url)}
            onUpdateLocalVideo={(src, name) => pagesApi.updateLocalVideo(selectedEntry.id, src, name)}
            onFetch={() => void pagesApi.fetchVideo(selectedEntry.id)}
            bgSource={selectedBgSource}
            onSetBgSource={source => {
              setCarouselBgSourceMap(prev => ({ ...prev, [selectedEntry.id]: source }));
              pagesApi.setSubMode(selectedEntry.id, source === 'video' ? 'video' : 'image');
            }}
            onRemove={() => pagesApi.removePage(selectedEntry.id)}
          />

          {/* Card 1 circle — the context image behind the subject. Change it via
              the photo picker, seeded with the wizard's AI search phrase. */}
          {selectedEntry.id === modulePhotoPageIds[0] && (
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden" style={{ width: CARD_W }}>
              <div className="px-3 py-2 border-b border-zinc-800">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Circle photo</span>
              </div>
              <div className="p-2.5 flex items-center gap-3">
                {getSettings(selectedEntry.id).circleImageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getSettings(selectedEntry.id).circleImageSrc!} alt="" className="w-11 h-11 rounded-full object-cover shrink-0 border border-zinc-700" />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-zinc-900 border border-dashed border-zinc-700 shrink-0" />
                )}
                <span className="flex-1 min-w-0 text-xs text-zinc-500 truncate">{moduleCircleQuery || 'Context image for the story'}</span>
                <button
                  onClick={() => openPhotoPicker(`circle:${selectedEntry.id}`, moduleCircleQuery)}
                  className="shrink-0 px-2.5 py-1.5 rounded-md bg-white text-black hover:bg-zinc-100 text-[11px] font-medium transition-colors"
                >
                  Change
                </button>
              </div>
            </div>
          )}

          {/* Wizard photo pool — one-click swaps for the module's photo cards,
              plus a search that keeps growing the pool (results append, never
              replace, so every photo ever searched stays usable). */}
          {selectedBgSource === 'photo' && modulePhotoPageIds.includes(selectedEntry.id) && (
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden" style={{ width: CARD_W }}>
              <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Swap photo</span>
                {(swappingPhoto || swapSearching) && <SpinnerIcon size={11} className="text-zinc-500" style={{ animation: 'spin 1s linear infinite' }} />}
              </div>
              <div className="flex gap-1.5 px-2 pt-2">
                <input
                  value={swapQuery}
                  onChange={e => setSwapQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void searchSwapPhotos(swapQuery, 0); }}
                  placeholder="Search more photos…"
                  className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
                />
                <button
                  onClick={() => void searchSwapPhotos(swapQuery, 0)}
                  disabled={!swapQuery.trim() || swapSearching}
                  className="shrink-0 px-2.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 text-xs transition-colors"
                >Search</button>
              </div>
              <div className="p-2 flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
                {modulePhotoPool.map(p => (
                  <button
                    key={p.url}
                    onClick={() => void swapModulePhoto(selectedEntry.id, p.url, p.thumbnail)}
                    disabled={swappingPhoto}
                    title={p.title ?? 'Use this photo'}
                    className="rounded-md overflow-hidden border-2 border-transparent hover:border-white disabled:opacity-50 transition-colors"
                    style={{ width: 74, height: 74 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumbnail} alt={p.title ?? ''} className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  </button>
                ))}
                {modulePhotoPool.length === 0 && !swapSearching && (
                  <p className="text-xs text-zinc-600 px-1 py-2">Search above to pull in photos.</p>
                )}
                {swapQuery.trim() && modulePhotoPool.length > 0 && (
                  <button
                    onClick={() => void searchSwapPhotos(swapQuery, swapOffset)}
                    disabled={swapSearching}
                    title="Load more results for this search"
                    className="flex items-center justify-center rounded-md border-2 border-dashed border-zinc-700 hover:border-zinc-500 text-zinc-600 hover:text-zinc-300 disabled:opacity-40 transition-colors text-lg"
                    style={{ width: 74, height: 74 }}
                  >+</button>
                )}
              </div>
            </div>
          )}

          {selectedBgSource === 'chart' && (
            <ChartsImageInputCard
              entry={selectedEntry}
              market={chartsImageMarketMap[selectedEntry.id] ?? null}
              overrideName={chartsImageNameOverrideMap[selectedEntry.id] ?? ''}
              allMarkets={(allTalents ?? []).map(t => ({ id: t.id, name: t.name, ticker: t.ticker, photo_url: t.photo_url, industry: t.industry, price: t.price }))}
              marketsLoading={talentsLoading}
              onEnsureMarkets={ensureTalents}
              onUpdateMarket={market => {
                setChartsImageMarketMap(prev => ({ ...prev, [selectedEntry.id]: market }));
                setChartsImageNameOverrideMap(prev => ({ ...prev, [selectedEntry.id]: market?.name ?? '' }));
                setChartsImageTrendsLoadedMap(prev => ({ ...prev, [selectedEntry.id]: false }));
              }}
              onUpdateOverrideName={name => setChartsImageNameOverrideMap(prev => ({ ...prev, [selectedEntry.id]: name }))}
              anyLoading={chartsImageTrendsLoadingMap[selectedEntry.id] ?? false}
              trendsLoaded={chartsImageTrendsLoadedMap[selectedEntry.id] ?? false}
              trendsError={chartsImageTrendsErrorMap[selectedEntry.id] ?? null}
              onStart={() => {
                const mk = chartsImageMarketMap[selectedEntry.id];
                if (!mk) return;
                if (chartsImageTrendsLoadedMap[selectedEntry.id]) return;
                const term = (chartsImageNameOverrideMap[selectedEntry.id] || mk.name).trim();
                loadChartTrends(selectedEntry.id, mk, term);
              }}
              onRemove={() => setCarouselBgSourceMap(prev => ({ ...prev, [selectedEntry.id]: 'photo' }))}
              onOpenPhotoPicker={query => openPhotoPicker(selectedEntry.id, query)}
              overrideIndustry={chartsImageIndustryOverrideMap[selectedEntry.id] ?? ''}
              direction={chartsImageDirectionMap[selectedEntry.id] ?? 'up'}
              noiseLevel={chartsImageNoiseLevelMap[selectedEntry.id] ?? 'none'}
              onUpdateOverrideIndustry={v => setChartsImageIndustryOverrideMap(prev => ({ ...prev, [selectedEntry.id]: v }))}
              onUpdateDirection={v => setChartsImageDirectionMap(prev => ({ ...prev, [selectedEntry.id]: v }))}
              onUpdateNoiseLevel={v => setChartsImageNoiseLevelMap(prev => ({ ...prev, [selectedEntry.id]: v }))}
              subMode={chartsImageSubModeMap[selectedEntry.id] ?? 'image'}
              preloadedAudios={preloadedAudios}
              audioTrack={chartsImageAudioMap[selectedEntry.id] ?? null}
              onSelectAudioTrack={track => setChartsImageAudioMap(prev => ({ ...prev, [selectedEntry.id]: track }))}
              onAddAudio={handleAddAudio}
              onDeleteAudio={handleDeleteAudio}
              onRenameAudio={handleRenameAudio}
            />
          )}

          <div className="flex flex-col gap-4" style={{ width: CARD_W }}>
            {/* Chart pages get their own controls (still vs animated + speed);
                photo/video pages keep the zoom + crop/blur controls. */}
            {selectedBgSource === 'chart' ? (
              (() => {
                const chartSub = chartsImageSubModeMap[selectedEntry.id] ?? 'image';
                const chSpeed  = chartsImageSpeedMap[selectedEntry.id] ?? 1;
                const isRec    = recordingStateMap[selectedEntry.id]?.isRecording ?? false;
                return (
                  <div className="flex items-center justify-between gap-4 px-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-600 select-none">Chart</span>
                      <div className="flex items-center rounded-full border border-zinc-700 bg-zinc-900 p-0.5" title="Render the chart background as a still image or animated video">
                        {([['image', 'Image'], ['video', 'Video']] as const).map(([m, label]) => (
                          <button key={m} disabled={isRec}
                            onClick={() => setChartsImageSubModeMap(prev => ({ ...prev, [selectedEntry.id]: m }))}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 ${chartSub === m ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-200'}`}
                          >{label}</button>
                        ))}
                      </div>
                      {chartSub === 'video' && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-zinc-600 select-none">Anim</span>
                          <div className="flex items-center rounded-full border border-zinc-700 bg-zinc-900 p-0.5" title="Chart animation speed">
                            {[1, 2, 3].map(s => (
                              <button key={s} disabled={isRec}
                                onClick={() => setChartsImageSpeedMap(prev => ({ ...prev, [selectedEntry.id]: s }))}
                                className={`rounded-full px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 ${chSpeed === s ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-200'}`}
                              >{s}×</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <button onClick={() => pagesApi.removePage(selectedEntry.id)} className={BTN_ICON} title="Delete page">
                      <TrashIcon size={15} />
                    </button>
                  </div>
                );
              })()
            ) : (
              <div className="flex items-center justify-between gap-4">
                {/* Zoom */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-zinc-600 select-none shrink-0">Zoom</span>
                  <input
                    type="range" min={20} max={800} step={5}
                    value={Math.round((scaleMap[selectedEntry.id] ?? 1) * 100)}
                    onChange={e => {
                      const n = parseInt(e.target.value) / 100;
                      carouselRefsMap.current.get(selectedEntry.id)?.setZoom(n);
                    }}
                    className="w-20 h-1 accent-white cursor-pointer"
                  />
                  <EditablePct
                    value={Math.round((scaleMap[selectedEntry.id] ?? 1) * 100)}
                    min={20} max={800} step={5}
                    onCommit={pct => carouselRefsMap.current.get(selectedEntry.id)?.setZoom(pct / 100)}
                  />
                </div>

                {/* Crop / Split / BG Blur */}
                <CarouselBgControls
                  entry={selectedEntry}
                  bgState={bgStateMap[selectedEntry.id] ?? { fgMaskReady: false, isBgProcessing: false, bgProcessError: false }}
                  settings={getSettings(selectedEntry.id)}
                  carouselRef={carouselRefsMap.current.get(selectedEntry.id)}
                  onRemoveRow={id => pagesApi.removePage(id)}
                  isCarouselVideo={selectedBgSource === 'video'}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Style settings — fixed column on the right ── */}
      {selectedEntry && (
        <div className="fixed top-[52px] right-0 z-20 bg-transparent w-[360px] h-[calc(100vh-52px)] flex flex-col">
          <CarouselSettingsPanel
            settings={getSettings(selectedEntry.id)}
            onChange={partial => updateSettings(selectedEntry.id, partial)}
            videoMode={selectedBgSource === 'video'}
          />
        </div>
      )}

      {/* ── Photo picker modal — chart page market avatar ── */}
      {photoPickerEntryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPhotoPickerEntryId(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
              <span className="text-sm font-semibold text-zinc-100">Pick a photo</span>
              <button onClick={() => setPhotoPickerEntryId(null)} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="flex gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
              <input
                value={photoPickerQuery}
                onChange={e => setPhotoPickerQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void searchPickerPhotos(photoPickerQuery, 0, false); }}
                placeholder="Search photos…"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
              <button
                onClick={() => void searchPickerPhotos(photoPickerQuery, 0, false)}
                disabled={!photoPickerQuery.trim() || photoPickerLoading}
                className="px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 text-sm transition-colors"
              >Search</button>
            </div>
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
                        const target = photoPickerEntryId!;
                        if (target.startsWith('circle:')) {
                          void applyCirclePhoto(target.slice('circle:'.length), p.url, p.thumbnail);
                        } else {
                          setChartsImageMarketMap(prev => {
                            const cur = prev[target];
                            if (!cur) return prev;
                            return { ...prev, [target]: { ...cur, photo_url: p.url } };
                          });
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
    </div>
  );
}
