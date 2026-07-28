'use client';

import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { QUOTE_STYLES, QUOTE_STYLES_PAIRED, ALL_QUOTE_STYLES } from '../quoteStyles';
import type { QuoteStyle } from '../quoteStyles';
import type {
  CarouselCanvasRef, CarouselTextAlign, CarouselFontLabel,
  CarouselSettings, CarouselBgLayerState, SlotContent, LayerId, TagStyle, TextSpan,
  SidebarElementData, DividerSubSlotContent, DividerStyleSettings,
  SwipeStyle, SwipeArrowType, SwipeLayout, SwipeDirection, ShadowStyle,
} from '../carouselTypes';
import {
  MAX_FONT, SUB_MAX, CAROUSEL_FONTS, defaultTagStyle, TAG_PRESETS, defaultDividerSettings,
  defaultSwipeStyle, SWIPE_PRESETS,
} from '../carouselTypes';
import { LayersPanel } from '../CarouselSettingsPanel';
import { SwipePreviewMini } from '../SwipePreviewMini';

import {
  CAROUSEL_W as W, CAROUSEL_H, CAROUSEL_X_H,
  CAROUSEL_PREVIEW_W, CAROUSEL_PREVIEW_H, CAROUSEL_X_PREVIEW_H,
  DISPLAY_SCALE,
  LOGO_PH, LOGO_CW, LOGO_CH,
} from './constants';
export { CAROUSEL_PREVIEW_W, CAROUSEL_PREVIEW_H, LOGO_PH };

import { divHexToRgba, drawWaveSegment, applyShadow, clearShadow, drawDividerOnCanvas, getSubZoneCanvasBounds } from './drawing/divider';
import { ensureFontLoaded, wrapText, drawAligned, hexToRgba, roundRectPath, drawTag, drawLogoFit } from './drawing/helpers';
import { drawSwipeArrow, drawSwipeOnCanvas } from './drawing/swipe';
import { wrapTextOffsets, getLineSpanSegs, drawSpanLine, spansToHtml, rgbToHex, htmlToSpans } from './drawing/spans';
import { drawChartImageFrame, GROW_MS, HOLD_MS, PULSE_MS } from '../ChartsImageCanvas/render';
import type { ChartsImageMarket, ChartsImageStrength, ChartsImageNoise } from '../ChartsImageCanvas/types';
import { muxClientSide } from '@/lib/canvasVideoExport';

// A chart used as the carousel background (alternative to a photo/video). Renders
// the Charts Image card full-frame behind the fade + headline/subheadline.
export interface CarouselChartBg {
  market:            ChartsImageMarket;
  overrideName?:     string;
  overrideIndustry?: string;
  strength?:         ChartsImageStrength;
  noise?:            ChartsImageNoise;
  subMode:           'image' | 'video'; // static card vs animated draw-in
  speed?:            number;            // 1/2/3 — line-draw speed (video)
  audioUrl?:         string;            // optional narration muxed into the MP4
}

// Swatch palette for the inline rich-text colour picker (the foreColor swatches
// in the floating text toolbar). A spread of vivid, legible colours plus
// black/white.
const RICH_COLORS: readonly string[] = [
  '#ffffff', '#000000', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#ec4899', '#f43f5e',
];

// Phonedeck server runs on the user's OWN machine (default localhost:8080).
// Exports must upload DIRECTLY from the browser (multer field "files"), the same
// way every other Phonedeck call works — never via a Next.js route, which on
// Vercel runs on Vercel's server and can't reach the user's PC.
const PHONEDECK_URL = process.env.NEXT_PUBLIC_PHONEDECK_URL ?? 'http://localhost:8080';

// Send an exported blob to Phonedeck's Incoming folder. Falls back to a normal
// browser download if Phonedeck isn't running, so an export is never lost.
// Returns a status string for the UI.
async function sendToPhonedeck(blob: Blob, filename: string): Promise<string> {
  try {
    const form = new FormData();
    form.append('files', blob, filename);
    const r = await fetch(`${PHONEDECK_URL}/api/upload`, { method: 'POST', body: form });
    if (!r.ok) throw new Error(await r.text());
    return `In Phonedeck Incoming: ${filename}`;
  } catch (err) {
    console.warn('[carousel export] phonedeck upload failed, falling back to download:', err);
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
    return 'Phonedeck not reachable — saved to Downloads instead';
  }
}

interface CarouselCanvasProps {
  imageSrc: string;
  videoSrc?: string;
  chartBg?: CarouselChartBg | null;
  headline: string;
  subheadline: string;
  settings: CarouselSettings;
  onScaleChange?: (scale: number) => void;
  onSettingsChange?: (partial: Partial<CarouselSettings>) => void;
  onBgLayerStateChange?: (s: CarouselBgLayerState) => void;
  brandLogoSrc?: string;
  onRecordingStateChange?: (state: { isRecording: boolean; recProgress: number; recStatus: string }) => void;
  onHeadlineChange?: (text: string) => void;
  onSubheadlineChange?: (text: string) => void;
  rectMode?: boolean;
  isDraggingElement?: boolean;
  invertedSlots?: boolean;
  onSlotDrop?: (slotIndex: number, data: SidebarElementData) => void;
  staticMode?: boolean;
  // Frame aspect: 'ig' = 4:5 (1080×1350), 'x' = 15:17 (1080×1224). Fixed per
  // mount — parents must remount (key) the canvas when the platform changes.
  platform?: 'ig' | 'x';
}

// ── CarouselCanvas (canvas + pan/zoom only) ──────────────────────────────────

// How far a circle may be dragged past the post edge, as a fraction of its radius.
// 0 = must stay fully inside (old behaviour); 0.9 lets ~90% of the circle hang off
// any edge for maximum creative framing, while keeping a sliver anchored on-canvas
// so it can always be grabbed and dragged back.
const CIRCLE_DRAG_BLEED_RATIO = 0.9;

const CarouselCanvas = forwardRef<CarouselCanvasRef, CarouselCanvasProps>(
  function CarouselCanvas({ imageSrc, videoSrc, chartBg = null, headline, subheadline, settings, onScaleChange, onSettingsChange, onBgLayerStateChange, brandLogoSrc, onRecordingStateChange, onHeadlineChange, onSubheadlineChange, rectMode = false, isDraggingElement = false, invertedSlots = false, onSlotDrop, staticMode = false, platform = 'ig' }, ref) {
    // Per-instance frame height (width is always 1080 so DISPLAY_SCALE holds).
    // Closures below capture these — safe because platform is fixed per mount.
    const H         = platform === 'x' ? CAROUSEL_X_H         : CAROUSEL_H;
    const PREVIEW_H = platform === 'x' ? CAROUSEL_X_PREVIEW_H : CAROUSEL_PREVIEW_H;
    const canvasRef    = useRef<HTMLCanvasElement>(null);
    const wrapperRef   = useRef<HTMLDivElement>(null);
    const cachedImgRef = useRef<HTMLImageElement | null>(null);
    const videoRef     = useRef<HTMLVideoElement>(null);
    const animFrameRef  = useRef<number | null>(null);
    const pulseAlphaRef = useRef(0.12);
    const isDraggingElementRef = useRef(isDraggingElement);
    const invertedSlotsRef     = useRef(invertedSlots);
    const pulseRafRef   = useRef<number | null>(null);
    const videoModeRef = useRef(!!videoSrc);
    useEffect(() => { videoModeRef.current = !!videoSrc; }, [videoSrc]);
    const trimStartRef = useRef(0);
    const trimEndRef   = useRef(Infinity);
    // When true, the source video's audio is dropped from the export and live
    // preview is silenced. Toggled from the VideoControlsBar mute button.
    const mutedRef     = useRef(false);

    const videoSrcRef = useRef<string | undefined>(videoSrc);
    useEffect(() => { videoSrcRef.current = videoSrc; }, [videoSrc]);

    // ── Chart background (alternative to photo/video) ─────────────────────────
    const chartBgRef        = useRef<CarouselChartBg | null>(chartBg);
    const chartAvatarRef    = useRef<HTMLImageElement | null>(null);
    const chartPauvLogoRef  = useRef<HTMLImageElement | null>(null);
    const chartAnimStartRef = useRef(0);   // reveal clock for chart-video (0 = not started)
    // True only for an animated chart background — drives the MP4 (canvas-record) export path.
    const chartVideoModeRef = useRef(!!chartBg && chartBg.subMode === 'video');
    useEffect(() => { chartBgRef.current = chartBg; chartVideoModeRef.current = !!chartBg && chartBg.subMode === 'video'; }, [chartBg]);
    const [isVideoExporting,    setIsVideoExporting]    = useState(false);
    const [videoExportProgress, setVideoExportProgress] = useState(0);
    const [videoExportStatus,   setVideoExportStatus]   = useState('');
    const videoExportAbortRef         = useRef<AbortController | null>(null);
    const onRecordingStateChangeRef   = useRef(onRecordingStateChange);
    useEffect(() => { onRecordingStateChangeRef.current = onRecordingStateChange; }, [onRecordingStateChange]);

    const imgOffsetRef      = useRef({ x: 0, y: 0 });
    const imgScaleRef       = useRef(1);
    // Stores committed crop as source-rect in image's natural pixel coords
    const imgSrcCropRef     = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);
    // Saved state from before entering crop mode (for Escape / cancel)
    const cropEntryStateRef = useRef<{
      crop:  typeof imgSrcCropRef.current;
      ox: number; oy: number; sc: number;
    } | null>(null);
    const [imgScale,   setImgScale]   = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [isCropMode, setIsCropMode] = useState(false);
    const [cropRect,   setCropRect]   = useState({ x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: PREVIEW_H });
    const [cropLock,   setCropLock]   = useState<'free' | '4:5'>('free');
    const dragStartRef     = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
    const cropOverlayRef   = useRef<HTMLCanvasElement>(null);
    const cropActiveHandle = useRef<string | null>(null);
    const cropDragStart    = useRef({ mx: 0, my: 0, rect: { x: 0, y: 0, w: 0, h: 0 } });
    const cropRectRef      = useRef({ x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: PREVIEW_H });
    const cropLockRef      = useRef<'free' | '4:5'>('free');
    useEffect(() => { cropRectRef.current = cropRect; }, [cropRect]);
    useEffect(() => { cropLockRef.current = cropLock; }, [cropLock]);

    const [slots,         setSlots]         = useState<(SlotContent | null)[]>(Array(3).fill(null));
    const slotsRef        = useRef<(SlotContent | null)[]>(Array(6).fill(null));
    const logoImgsRef     = useRef<(HTMLImageElement | null)[]>(Array(3).fill(null));
    const zoneLogoImgsRef = useRef<(HTMLImageElement | null)[]>(Array(9).fill(null));
    const subImgRefsArr   = useRef<(HTMLImageElement | null)[]>(Array(3).fill(null));

    // ── Rect mode state (replaces both circles when rectMode=true) ────────────
    // Stores the preview-px band [top, bottom, left, right] between the top-3 and bottom-3 tag slots (rectMode)
    const rectBandRef                     = useRef({ top: 0, bottom: 0, left: 0, right: 0 });

    const [circleSrcs, setCircleSrcs] = useState<(string|null)[]>([null, null]);
    const circleImgRefsArr    = useRef<(HTMLImageElement|null)[]>([null, null]);
    const circlePosRefsArr    = useRef<({x:number;y:number}|null)[]>([null, null]);
    const [circlePoses, setCirclePoses]   = useState<({x:number;y:number}|null)[]>([null, null]);
    const [activeDragCircle, setActiveDragCircle]     = useState<number|null>(null);
    const circleDragStart     = useRef({ mx: 0, my: 0, cx: 0, cy: 0 });
    const circleRadsArr       = useRef<number[]>([90, 90]);
    const [circleRadii, setCircleRadii]   = useState<number[]>([90, 90]);
    const [activeResizeCircle, setActiveResizeCircle] = useState<number|null>(null);
    const circleResizeStart   = useRef({ cx: 0, cy: 0 });
    const circleImgOffsetsArr = useRef<{x:number;y:number}[]>([{x:0,y:0},{x:0,y:0}]);
    const circleImgScalesArr  = useRef<number[]>([1, 1]);
    const [circleImgEditModes, setCircleImgEditModes] = useState<boolean[]>([false, false]);
    const [activeImgDragCircle, setActiveImgDragCircle]   = useState<number|null>(null);
    const circleImgDragStart  = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
    const [activeZoomDragCircle, setActiveZoomDragCircle] = useState<number|null>(null);
    const circleZoomDragStart = useRef({ my: 0, scale: 1 });
    const circleEl0Ref        = useRef<HTMLDivElement>(null);
    const circleEl1Ref        = useRef<HTMLDivElement>(null);
    const fgMaskImgRef          = useRef<HTMLImageElement | null>(null);
    const [fgMaskSrc, setFgMaskSrc] = useState<string | null>(null);
    const fgMaskSrcRef          = useRef<string | null>(null);
    const [isBgProcessing, setIsBgProcessing] = useState(false);
    const [bgProcessError, setBgProcessError] = useState(false);
    useEffect(() => { circlePosRefsArr.current = [...circlePoses]; }, [circlePoses]);
    useEffect(() => { circleRadsArr.current    = [...circleRadii]; }, [circleRadii]);
    const instanceId      = useRef(Math.random().toString(36).slice(2)).current;
    const [customTagText,   setCustomTagText]   = useState('');
    const [showCustom,      setShowCustom]      = useState(false);
    const [showQuotePicker, setShowQuotePicker] = useState<number | null>(null);
    // blockTopPv tracks the text-block's top edge in preview-px so above-headline slots stay anchored
    const [blockTopPv,   setBlockTopPv]   = useState(384);
    const [headBlockHPv, setHeadBlockHPv] = useState(0);
    const [subBlockHPv,  setSubBlockHPv]  = useState(0);
    const [gapPv,        setGapPv]        = useState(0);
    // Rich text editing overlay
    const [richEditTarget, setRichEditTarget] = useState<'headline' | 'sub' | null>(null);
    const richEditTargetRef  = useRef<'headline' | 'sub' | null>(null);
    const richEditRef        = useRef<HTMLDivElement>(null);
    const savedSelRef        = useRef<Range | null>(null);
    const [toolbarPos,     setToolbarPos]     = useState<{ top: number; left: number } | null>(null);

    const headlineRef    = useRef(headline);
    const subheadlineRef = useRef(subheadline);
    useEffect(() => { headlineRef.current    = headline; },    [headline]);
    useEffect(() => { subheadlineRef.current = subheadline; }, [subheadline]);
    // Clear stale spans if the headline text is changed externally (e.g., settings panel textarea)
    useEffect(() => {
      if (!settingsRef.current.headlineSpans) return;
      const t = settingsRef.current.headlineSpans.map(s => s.text).join('');
      if (t !== headline) onSettingsChange?.({ headlineSpans: null });
    }, [headline]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
      if (!settingsRef.current.subSpans) return;
      const t = settingsRef.current.subSpans.map(s => s.text).join('');
      if (t !== subheadline) onSettingsChange?.({ subSpans: null });
    }, [subheadline]); // eslint-disable-line react-hooks/exhaustive-deps

    const drawCanvas = useCallback((
      img: HTMLImageElement | null,
      imgOx: number, imgOy: number, imgSc: number,
      s: CarouselSettings,
      targetCanvas?: HTMLCanvasElement | OffscreenCanvas,
      videoFrameOverride?: { source: CanvasImageSource; vw: number; vh: number } | null,
    ) => {
      const canvas = targetCanvas ?? canvasRef.current;
      if (!canvas) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D | null;
      if (!ctx) return;
      const sc = canvas.width / W;
      ctx.setTransform(sc, 0, 0, sc, 0, 0);

      const setLS = (px: number) => { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px * sc}px`; };

      const fontDef    = CAROUSEL_FONTS.find(f => f.label === s.fontLabel)    ?? CAROUSEL_FONTS[0];
      const subFontDef = CAROUSEL_FONTS.find(f => f.label === s.subFontLabel) ?? CAROUSEL_FONTS[0];
      const fs  = (sz: number) => `${s.italic    ? 'italic ' : ''}${s.fontWeight}  ${sz}px ${fontDef.css}`;
      const sfs = (sz: number) => `${s.subItalic ? 'italic ' : ''}${s.subFontWeight} ${sz}px ${subFontDef.css}`;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = s.bgColor || '#111';
      ctx.fillRect(0, 0, W, H);

      // Chart background takes precedence over photo/video. It fills the whole
      // frame (1080×1350, same as the standalone Charts Image), so the fade +
      // headline/subheadline below composite on top exactly as for a photo.
      const _chartBg = chartBgRef.current;
      if (_chartBg?.market) {
        let revealT = 1, tipPulseT = -1;
        if (_chartBg.subMode === 'video') {
          const hasData = (_chartBg.market.sparkline?.length ?? 0) > 0;
          if (hasData && chartAnimStartRef.current === 0) chartAnimStartRef.current = performance.now();
          revealT = chartAnimStartRef.current === 0
            ? 0
            : Math.min((performance.now() - chartAnimStartRef.current) / (GROW_MS / Math.min(3, Math.max(1, _chartBg.speed || 1))), 1);
          tipPulseT = (performance.now() % PULSE_MS) / PULSE_MS;
        }
        drawChartImageFrame(ctx, W, H, {
          market:           _chartBg.market,
          overrideName:     _chartBg.overrideName,
          overrideIndustry: _chartBg.overrideIndustry,
          strength:         _chartBg.strength,
          noise:            _chartBg.noise,
          avatarImg:        chartAvatarRef.current,
          pauvLogo:         chartPauvLogoRef.current,
          revealT, tipPulseT,
        });
      } else if (img) {
        const crop = imgSrcCropRef.current;
        const sx = crop?.sx ?? 0;
        const sy = crop?.sy ?? 0;
        const sw = crop?.sw ?? img.naturalWidth;
        const sh = crop?.sh ?? img.naturalHeight;
        const baseScale      = Math.max(W / sw, H / sh);
        const effectiveScale = baseScale * imgSc;
        const drawW = sw * effectiveScale;
        const drawH = sh * effectiveScale;
        const drawX = (W - drawW) / 2 + imgOx;
        const drawY = (H - drawH) / 2 + imgOy;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
        const fgMask = fgMaskImgRef.current;
        if (s.bgBlurEnabled && fgMask) {
          const defaultOrder: LayerId[] = ['background', 'circle', 'circle2', 'subject'];
          const order: LayerId[] = (s.layerOrder && s.layerOrder.length >= 4) ? s.layerOrder : defaultOrder;
          const drawCircle = (ci: number) => {
            const _cImg = circleImgRefsArr.current[ci];
            if (!_cImg) return;
            const _pos = circlePosRefsArr.current[ci];
            const _defX = ci === 0 ? Math.round(CAROUSEL_PREVIEW_W / 4) : Math.round(CAROUSEL_PREVIEW_W * 3 / 4);
            const _cX = _pos ? _pos.x / DISPLAY_SCALE : _defX / DISPLAY_SCALE;
            const _cY = _pos ? _pos.y / DISPLAY_SCALE : H / 2;
            const _cR = Math.round(circleRadsArr.current[ci] / DISPLAY_SCALE);
            const _shadowEnabled = ci === 0 ? s.circleShadowEnabled : s.circle2ShadowEnabled;
            const _lift = ci === 0 ? s.circleLift : s.circle2Lift;
            if (_shadowEnabled || _lift > 0) {
              ctx.save();
              if (_shadowEnabled) {
                ctx.shadowBlur    = ci === 0 ? s.circleShadowBlur    : s.circle2ShadowBlur;
                ctx.shadowOffsetX = ci === 0 ? s.circleShadowOffsetX : s.circle2ShadowOffsetX;
                ctx.shadowOffsetY = ci === 0 ? s.circleShadowOffsetY : s.circle2ShadowOffsetY;
                ctx.shadowColor   = hexToRgba(ci === 0 ? s.circleShadowColor : s.circle2ShadowColor, (ci === 0 ? s.circleShadowOpacity : s.circle2ShadowOpacity) / 100);
              } else {
                ctx.shadowBlur = _lift * 0.5; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = _lift * 0.3; ctx.shadowColor = 'rgba(0,0,0,0.7)';
              }
              ctx.beginPath(); ctx.arc(_cX, _cY, _cR, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
              ctx.restore();
            }
            ctx.save();
            ctx.beginPath(); ctx.arc(_cX, _cY, _cR, 0, Math.PI * 2); ctx.clip();
            const _cs  = Math.max((_cR * 2) / _cImg.naturalWidth, (_cR * 2) / _cImg.naturalHeight);
            const _ecs = _cs * circleImgScalesArr.current[ci];
            const _off = circleImgOffsetsArr.current[ci];
            const _cdw = _cImg.naturalWidth * _ecs, _cdh = _cImg.naturalHeight * _ecs;
            ctx.drawImage(_cImg, _cX - _cdw / 2 + _off.x, _cY - _cdh / 2 + _off.y, _cdw, _cdh);
            ctx.restore();
            const _bw = ci === 0 ? s.circleBorderWidth   : s.circle2BorderWidth;
            const _bo = ci === 0 ? s.circleBorderOpacity : s.circle2BorderOpacity;
            const _bc = ci === 0 ? s.circleBorderColor   : s.circle2BorderColor;
            if (_bw > 0 && _bo > 0) {
              ctx.save();
              ctx.beginPath(); ctx.arc(_cX, _cY, _cR, 0, Math.PI * 2);
              ctx.strokeStyle = hexToRgba(_bc, _bo / 100); ctx.lineWidth = _bw; ctx.stroke();
              ctx.restore();
            }
          };
          const drawRect = () => {
            const _rImg = circleImgRefsArr.current[0];
            if (!_rImg) return;
            const { top: _rtPv, bottom: _rbPv, left: _rlPv } = rectBandRef.current;
            const _rl  = _rlPv / DISPLAY_SCALE;
            const _rt  = _rtPv / DISPLAY_SCALE;
            const _rw  = W - _rl * 2;
            const _rh  = (_rbPv - _rtPv) / DISPLAY_SCALE;
            const SHIFT_CV = Math.round(50 / DISPLAY_SCALE);
            const _pos = circlePosRefsArr.current[0];
            const _cr  = _pos ? Math.round(circleRadsArr.current[0] / DISPLAY_SCALE) : Math.min(_rh, _rw) / 2 - Math.round(4 / DISPLAY_SCALE);
            const _cx  = _pos ? _pos.x / DISPLAY_SCALE : W / 2 + SHIFT_CV;
            const _cy  = _pos ? _pos.y / DISPLAY_SCALE : _rt + _rh / 2;
            ctx.save();
            ctx.beginPath(); ctx.arc(_cx, _cy, _cr, 0, Math.PI * 2); ctx.clip();
            const _cs  = Math.max((_cr * 2) / _rImg.naturalWidth, (_cr * 2) / _rImg.naturalHeight);
            const _ecs = _cs * circleImgScalesArr.current[0];
            const _off = circleImgOffsetsArr.current[0];
            const _cdw = _rImg.naturalWidth * _ecs, _cdh = _rImg.naturalHeight * _ecs;
            ctx.drawImage(_rImg, _cx - _cdw / 2 + _off.x, _cy - _cdh / 2 + _off.y, _cdw, _cdh);
            ctx.restore();
          };

          for (const layer of order) {
            if (layer === 'background') {
              if (s.bgBlurAmount > 0) {
                const blurPx = Math.max(1, Math.round(s.bgBlurAmount * sc));
                ctx.filter = `blur(${blurPx}px)`;
              }
              ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
              ctx.filter = 'none';
              if (s.bgDarkenAmount > 0) {
                ctx.fillStyle = `rgba(0,0,0,${(s.bgDarkenAmount / 100).toFixed(3)})`;
                ctx.fillRect(0, 0, W, H);
              }
            } else if (layer === 'circle') {
              rectMode ? drawRect() : drawCircle(0);
            } else if (layer === 'circle2') {
              if (!rectMode) drawCircle(1);
            } else if (layer === 'subject') {
              ctx.drawImage(fgMask, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
            }
          }
        } else {
          ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
        }
        ctx.restore();
      } else if (videoFrameOverride || (videoRef.current && videoRef.current.readyState >= 2)) {
        const vSrc: CanvasImageSource = videoFrameOverride ? videoFrameOverride.source : videoRef.current!;
        const vw = videoFrameOverride ? videoFrameOverride.vw : (videoRef.current!.videoWidth || 1);
        const vh = videoFrameOverride ? videoFrameOverride.vh : (videoRef.current!.videoHeight || 1);
        const crop = imgSrcCropRef.current;
        const sx = crop?.sx ?? 0, sy = crop?.sy ?? 0;
        const sw = crop?.sw ?? vw, sh = crop?.sh ?? vh;
        const baseScale = Math.max(W / sw, H / sh);
        const drawW = sw * baseScale * imgSc, drawH = sh * baseScale * imgSc;
        const drawX = (W - drawW) / 2 + imgOx, drawY = (H - drawH) / 2 + imgOy;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
        ctx.drawImage(vSrc, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
        if (s.bgDarkenAmount > 0) {
          ctx.fillStyle = `rgba(0,0,0,${(s.bgDarkenAmount / 100).toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.restore();
      }

      const rawHead = s.headlineSpans ? s.headlineSpans.map(sp => sp.text).join('') : headlineRef.current;
      const rawSub  = s.subSpans      ? s.subSpans.map(sp => sp.text).join('')      : subheadlineRef.current;
      const text    = s.allCaps    ? rawHead.trim().toUpperCase() : rawHead.trim();
      const subText = s.subAllCaps ? rawSub.trim().toUpperCase()  : rawSub.trim();
      if (!text && !subText) return;

      const padX      = Math.round(32 + s.contentPadding * 0.64);
      const padBot    = Math.round(40 + s.contentPadding * 0.80);
      const MAX_W     = W - padX * 2;
      const lsPx      = (s.lSpacing    / 100) * 20;
      const subLsPx   = (s.subLSpacing / 100) * 20;
      const lhMult    = 1.0 + (s.lHeight    / 100) * 1.2;
      const subLhMult = 1.0 + (s.subLHeight / 100) * 1.2;

      const hasSub   = subText.length > 0;

      let hSize = s.fontSize, hLines: string[] = [];
      if (text) {
        setLS(lsPx);
        ctx.font = fs(hSize);
        hLines = wrapText(ctx, text, MAX_W);
      }
      const hLineH  = hSize * lhMult;
      const hBlockH = hLines.length * hLineH;

      let sSize = s.subFontSize, sLines: string[] = [];
      if (subText) {
        setLS(subLsPx);
        ctx.font = sfs(sSize);
        sLines = wrapText(ctx, subText, MAX_W);
      }
      const sLineH  = sSize * subLhMult;
      const sBlockH = sLines.length * sLineH;
      const gap         = hasSub && text ? hSize * (s.headSubGap / 100) : 0;
      // Bottom slot is hidden when nothing is placed there and nothing is being dragged
      const hasBottomContent = !!(
        slotsRef.current[2] ||
        s.dividerSlots?.[2] ||
        s.tagSlots?.[2] ||
        s.quoteSlots?.[2] ||
        s.tagZoneSlots?.slice(6).some(Boolean) ||
        s.zoneLogoSlots?.slice(6).some(Boolean) ||
        s.quoteZoneSlots?.slice(6).some(Boolean) ||
        s.swipeZoneSlots?.slice(6).some(Boolean)
      );
      const invSl = invertedSlotsRef.current;
      const hasTopContent = !!(
        slotsRef.current[0] || s.dividerSlots?.[0] || s.tagSlots?.[0] || s.quoteSlots?.[0] ||
        s.tagZoneSlots?.slice(0, 3).some(Boolean) || s.zoneLogoSlots?.slice(0, 3).some(Boolean) ||
        s.quoteZoneSlots?.slice(0, 3).some(Boolean) || s.swipeZoneSlots?.slice(0, 3).some(Boolean)
      );
      const showBottomSlot = invSl ? true  : (isDraggingElementRef.current || hasBottomContent);
      const showTopSlot    = invSl ? (isDraggingElementRef.current || hasTopContent) : true;
      const showMiddleSlot = !invSl;
      const showSlot       = [showTopSlot, showMiddleSlot, showBottomSlot] as const;
      const subSlotCV   = H - (showBottomSlot ? LOGO_CH + padX : padX);
      const aboveGapCV  = Math.round(s.aboveLogoGap / DISPLAY_SCALE);
      // Inverted: text sits just below top slot when visible, or at padX when top slot is hidden
      // Normal: aboveGapCV only moves slot 1 upward — text stays anchored above the bottom slot
      const blockTop    = invSl
        ? (showTopSlot ? (padX + LOGO_CH + aboveGapCV) : padX)
        : Math.max(padX, subSlotCV - (hBlockH + gap + sBlockH));

      if (!targetCanvas) {
        const btp = Math.round(blockTop * DISPLAY_SCALE);
        setBlockTopPv(prev => prev === btp ? prev : btp);
        const hbhPv = Math.round(hBlockH * DISPLAY_SCALE);
        setHeadBlockHPv(prev => prev === hbhPv ? prev : hbhPv);
        const sbhPv = Math.round(sBlockH * DISPLAY_SCALE);
        setSubBlockHPv(prev => prev === sbhPv ? prev : sbhPv);
        const gPv = Math.round(gap * DISPLAY_SCALE);
        setGapPv(prev => prev === gPv ? prev : gPv);
      }

      // Solid bottom band — a hard section the text sits IN (not a fade over the
      // photo). Grows upward to fit the text block, minimum ~1/5 of the card.
      if (s.bottomBandEnabled) {
        const bandPad = H * 0.035;
        const bandTop = Math.min(H * 0.8, blockTop - bandPad);
        ctx.fillStyle = s.bottomBandColor || '#000000';
        ctx.fillRect(0, bandTop, W, H - bandTop);
      }

      if (s.showFade) {
        const alpha    = s.fadeIntensity / 100;
        const floorH   = H * 0.6 * (s.fadeFloor / 100);
        const floorTop = H - floorH;
        if (floorH > 0) {
          ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
          ctx.fillRect(0, floorTop, W, floorH);
        }
        const fadeH      = H * 0.05 + H * 0.95 * (s.fadeReach / 100);
        const gradBottom = floorTop + 0.3;
        const gradTop    = Math.max(0, gradBottom - fadeH);
        if (fadeH > 0 && gradBottom > 0) {
          const grad = ctx.createLinearGradient(0, gradTop, 0, gradBottom);
          grad.addColorStop(0,    `rgba(0,0,0,0)`);
          grad.addColorStop(0.4,  `rgba(0,0,0,${(alpha * 0.5).toFixed(3)})`);
          grad.addColorStop(0.75, `rgba(0,0,0,${(alpha * 0.85).toFixed(3)})`);
          grad.addColorStop(1,    `rgba(0,0,0,${alpha.toFixed(3)})`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, gradTop, W, gradBottom - gradTop);
        }
      }
      if (s.showTopFade) {
        const alpha  = (s.topFadeIntensity ?? 85) / 100;
        const floorH = H * 0.6 * ((s.topFadeFloor ?? 20) / 100);
        if (floorH > 0) {
          ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
          ctx.fillRect(0, 0, W, floorH);
        }
        const fadeH      = H * 0.05 + H * 0.95 * ((s.topFadeReach ?? 40) / 100);
        const gradTop    = floorH - 0.3;
        const gradBottom = Math.min(H, gradTop + fadeH);
        if (fadeH > 0 && gradTop < H) {
          const grad = ctx.createLinearGradient(0, gradTop, 0, gradBottom);
          grad.addColorStop(0,    `rgba(0,0,0,${alpha.toFixed(3)})`);
          grad.addColorStop(0.25, `rgba(0,0,0,${(alpha * 0.85).toFixed(3)})`);
          grad.addColorStop(0.6,  `rgba(0,0,0,${(alpha * 0.5).toFixed(3)})`);
          grad.addColorStop(1,    `rgba(0,0,0,0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, gradTop, W, gradBottom - gradTop);
        }
      }

      // Logo overlays drawn on canvas (included in download) — positions mirror the HTML overlay slots
      const slotFW       = W - 2 * padX;
      const logoCY_top   = padX;
      const logoCY_above = Math.max(0, blockTop - LOGO_CH - Math.round(s.aboveLogoGap / DISPLAY_SCALE));
      const logoCY_sub   = H - LOGO_CH - padX;
      const logoCYs      = [logoCY_top, logoCY_above, logoCY_sub];
      const logoAlpha = (s.logoOpacity ?? 100) / 100;
      logoImgsRef.current.forEach((logoImg, li) => {
        if (!logoImg || li > 2) return;
        if (li <= 2 && !showSlot[li]) return;
        ctx.save();
        ctx.globalAlpha = logoAlpha;
        const lha = (s.logoSlotAligns?.[li] ?? 'center') as 'left' | 'center' | 'right';
        const lva = li === 0 ? 'top' as const : 'bottom' as const;
        const logoLift = s.logoShadow?.lift ?? 0;
        applyShadow(ctx, s.logoShadow);
        drawLogoFit(ctx, logoImg, padX, logoCYs[li] - logoLift, slotFW, LOGO_CH, lha, lva, s.logoScale ?? 100, s.logoCornerRadius ?? 0);
        clearShadow(ctx);
        ctx.restore();
      });
      (s.tagSlots ?? []).forEach((tagSlot, li) => {
        if (!tagSlot || li > 2) return;
        if (li <= 2 && !showSlot[li]) return;
        const ts = tagSlot.style;
        const tagFontDef = CAROUSEL_FONTS.find(f => f.label === ts.fontLabel) ?? CAROUSEL_FONTS[0];
        const ha = (s.tagSlotAligns?.[li] ?? 'center') as 'left' | 'center' | 'right';
        // Slot 0 (top) pins to top edge; slots 1/2 pin to bottom edge toward content/padding boundary
        const va = li === 0 ? 'top' as const : 'bottom' as const;
        const tagSlotLift = ts.shadow?.lift ?? 0;
        applyShadow(ctx, ts.shadow);
        drawTag(ctx, tagSlot.text, padX, logoCYs[li] - tagSlotLift, slotFW, LOGO_CH, ha, va, ts, tagFontDef.css, 1 / DISPLAY_SCALE);
        clearShadow(ctx);
      });

      // Quote mark overlays
      (s.quoteSlots ?? []).forEach((styleId, li) => {
        if (!styleId || li > 2) return;
        if (li <= 2 && !showSlot[li]) return;
        const qs = ALL_QUOTE_STYLES.find(q => q.id === styleId);
        if (!qs) return;
        const qColor   = s.quoteColor   ?? '#ffffff';
        const qSize    = s.quoteSize    ?? 120;
        const qAlpha   = (s.quoteOpacity ?? 100) / 100;
        const [vbX, vbY, vbW, vbH] = qs.viewBox;
        const scale    = Math.min(qSize / vbW, qSize / vbH);
        const drawW    = vbW * scale;
        const drawH    = vbH * scale;
        const quoteGap = qs.paired ? (s.quoteGap ?? 8) : 0;
        const totalW   = qs.paired ? drawW * 2 + quoteGap : drawW;
        const qx = padX + (slotFW - totalW) / 2;
        const quoteLift = s.quoteShadow?.lift ?? 0;
        const qy = logoCYs[li] - quoteLift + (LOGO_CH - drawH) / 2;
        // Opening mark
        ctx.save();
        ctx.globalAlpha = qAlpha;
        ctx.fillStyle   = qColor;
        applyShadow(ctx, s.quoteShadow);
        ctx.translate(qx - vbX * scale, qy - vbY * scale);
        ctx.scale(scale, scale);
        if (qs.pathOffset) ctx.translate(qs.pathOffset.x, qs.pathOffset.y);
        for (const pathD of qs.paths) ctx.fill(new Path2D(pathD));
        clearShadow(ctx);
        ctx.restore();
        // Closing mark — same shape rotated 180°, offset by quoteGap
        if (qs.paired) {
          const cx = qx + drawW + quoteGap;
          ctx.save();
          ctx.globalAlpha = qAlpha;
          ctx.fillStyle   = qColor;
          applyShadow(ctx, s.quoteShadow);
          ctx.translate(cx + drawW / 2, qy + drawH / 2);
          ctx.rotate(Math.PI);
          ctx.translate(-drawW / 2, -drawH / 2);
          ctx.translate(-vbX * scale, -vbY * scale);
          ctx.scale(scale, scale);
          if (qs.pathOffset) ctx.translate(qs.pathOffset.x, qs.pathOffset.y);
          for (const pathD of qs.paths) ctx.fill(new Path2D(pathD));
          clearShadow(ctx);
          ctx.restore();
        }
      });

      // Zone-level independent items (row*3+zone, zones: 0=left,1=center,2=right)
      const zoneW = slotFW / 3;
      for (let row = 0; row < 3; row++) {
        if (row <= 2 && !showSlot[row]) continue;
        if (s.dividerSlots?.[row]) continue; // divider takes whole row, skip zone items
        const lva = row === 0 ? 'top' as const : row === 2 ? 'bottom' as const : 'center' as const;
        for (let zi = 0; zi < 3; zi++) {
          const fi = row * 3 + zi;
          const zoneX = padX + zi * zoneW;
          const lha = zi === 0 ? 'left' as const : zi === 2 ? 'right' as const : 'center' as const;
          // Zone tag
          const zt = s.tagZoneSlots?.[fi];
          if (zt) {
            const tfd = CAROUSEL_FONTS.find(f => f.label === zt.style.fontLabel) ?? CAROUSEL_FONTS[0];
            const tzLift = zt.style.shadow?.lift ?? 0;
            applyShadow(ctx, zt.style.shadow);
            drawTag(ctx, zt.text, zoneX, logoCYs[row] - tzLift, zoneW, LOGO_CH, lha, lva, zt.style, tfd.css, 1 / DISPLAY_SCALE);
            clearShadow(ctx);
          }
          // Zone logo (brand)
          if (s.zoneLogoSlots?.[fi]) {
            const zImg = zoneLogoImgsRef.current[fi];
            if (zImg) {
              const zLogoLift = s.logoShadow?.lift ?? 0;
              ctx.save();
              ctx.globalAlpha = logoAlpha;
              applyShadow(ctx, s.logoShadow);
              drawLogoFit(ctx, zImg, zoneX, logoCYs[row] - zLogoLift, zoneW, LOGO_CH, lha, lva, s.logoScale ?? 100, s.logoCornerRadius ?? 0);
              clearShadow(ctx);
              ctx.restore();
            }
          }
          // Zone quote — positioned to match the zone corner (same anchor as tag/logo)
          const zq = s.quoteZoneSlots?.[fi];
          if (zq) {
            const qs = ALL_QUOTE_STYLES.find(q => q.id === zq);
            if (qs) {
              const qColor = s.quoteColor ?? '#ffffff';
              const qSize  = s.quoteSize  ?? 120;
              const qAlpha = (s.quoteOpacity ?? 100) / 100;
              const [vbX, vbY, vbW, vbH] = qs.viewBox;
              const scale = Math.min(qSize / vbW, qSize / vbH);
              const drawW = vbW * scale, drawH = vbH * scale;
              const quoteGap = qs.paired ? (s.quoteGap ?? 8) : 0;
              const totalW   = qs.paired ? drawW * 2 + quoteGap : drawW;
              const zqLift = s.quoteShadow?.lift ?? 0;
              // Horizontal anchor
              const qx = lha === 'left' ? zoneX
                       : lha === 'right' ? zoneX + zoneW - totalW
                       : zoneX + (zoneW - totalW) / 2;
              // Vertical anchor
              const qy = (lva === 'top'    ? logoCYs[row]
                        : lva === 'bottom' ? logoCYs[row] + LOGO_CH - drawH
                        : logoCYs[row] + (LOGO_CH - drawH) / 2) - zqLift;
              ctx.save(); ctx.globalAlpha = qAlpha; ctx.fillStyle = qColor;
              applyShadow(ctx, s.quoteShadow);
              ctx.translate(qx - vbX * scale, qy - vbY * scale);
              ctx.scale(scale, scale);
              if (qs.pathOffset) ctx.translate(qs.pathOffset.x, qs.pathOffset.y);
              for (const pathD of qs.paths) ctx.fill(new Path2D(pathD));
              clearShadow(ctx);
              ctx.restore();
              if (qs.paired) {
                const cx = qx + drawW + quoteGap;
                ctx.save(); ctx.globalAlpha = qAlpha; ctx.fillStyle = qColor;
                applyShadow(ctx, s.quoteShadow);
                ctx.translate(cx + drawW / 2, qy + drawH / 2); ctx.rotate(Math.PI);
                ctx.translate(-drawW / 2, -drawH / 2); ctx.translate(-vbX * scale, -vbY * scale);
                ctx.scale(scale, scale);
                if (qs.pathOffset) ctx.translate(qs.pathOffset.x, qs.pathOffset.y);
                for (const pathD of qs.paths) ctx.fill(new Path2D(pathD));
                clearShadow(ctx);
                ctx.restore();
              }
            }
          }
          // Zone swipe
          const zsw = s.swipeZoneSlots?.[fi];
          if (zsw) {
            const sfd = CAROUSEL_FONTS.find(f => f.label === zsw.fontLabel) ?? CAROUSEL_FONTS[0];
            const zswLift = zsw.shadow?.lift ?? 0;
            applyShadow(ctx, zsw.shadow);
            drawSwipeOnCanvas(ctx, zoneX, logoCYs[row] - zswLift, zoneW, LOGO_CH, lha, lva, zsw, sfd.css);
            clearShadow(ctx);
          }
        }
      }

      // Draw dividers + sub-slot content together (merged so line gaps recalculate from actual content)
      (s.dividerSlots ?? []).forEach((divId, li) => {
        if (!divId || li > 2) return;
        if (li <= 2 && !showSlot[li]) return;
        const subContent = s.dividerSubSlots?.[li] ?? null;
        const szC = subContent ? getSubZoneCanvasBounds(divId, padX, logoCYs[li], slotFW, LOGO_CH) : null;

        // Measure actual rendered content width + center so lines align to content
        let contentW: number | null = null;
        let contentCY: number | null = null;
        let fittedTs: TagStyle | null = null;
        const va = li === 0 ? 'top' as const : li === 2 ? 'bottom' as const : 'center' as const;
        if (subContent && szC) {
          if (subContent.type === 'image') {
            const img = subImgRefsArr.current[li];
            if (img) {
              const imgS = Math.min(szC.w / img.naturalWidth, szC.h / img.naturalHeight);
              const dh = img.naturalHeight * imgS;
              const dy = va === 'top' ? szC.y : va === 'bottom' ? szC.y + szC.h - dh : szC.y + (szC.h - dh) / 2;
              contentW = img.naturalWidth * imgS;
              contentCY = dy + dh / 2;
            }
          } else if (subContent.type === 'tag') {
            const ts = subContent.style;
            const tfd = CAROUSEL_FONTS.find(f => f.label === ts.fontLabel) ?? CAROUSEL_FONTS[0];
            const pxScale = 1 / DISPLAY_SCALE;
            const tc = ts.textCase ?? 'none';
            const dispTxt = tc === 'upper' ? subContent.text.toUpperCase() : subContent.text;
            const variant = tc === 'smallcaps' ? 'small-caps ' : '';
            let fsPx = Math.round(ts.fontSize * pxScale);
            (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
              `${((ts.letterSpacing ?? 0) * pxScale).toFixed(2)}px`;
            ctx.font = `${ts.italic ? 'italic ' : ''}${variant}${ts.fontWeight} ${fsPx}px ${tfd.css}`;
            const pxPad = Math.round(ts.paddingX * pxScale);
            const pxPy  = Math.round(ts.paddingY * pxScale);
            // Always measure against full slot width — sub-zone (140px) would artificially shrink font
            const avail = slotFW - pxPad * 2;
            let tw = ctx.measureText(dispTxt).width;
            if (tw > avail && avail > 0) {
              fsPx = Math.max(6, Math.floor(fsPx * avail / tw));
              ctx.font = `${ts.italic ? 'italic ' : ''}${variant}${ts.fontWeight} ${fsPx}px ${tfd.css}`;
              tw = ctx.measureText(dispTxt).width;
            }
            contentW = Math.max(1, tw + pxPad * 2);
            fittedTs = { ...ts, fontSize: Math.round(fsPx / pxScale) };
            const boxH = Math.round(fsPx * 1.2 + pxPy * 2);
            const by = va === 'top' ? logoCYs[li] : va === 'bottom' ? logoCYs[li] + LOGO_CH - boxH : logoCYs[li] + (LOGO_CH - boxH) / 2;
            contentCY = by + boxH / 2;
          } else if (subContent.type === 'swipe') {
            contentW = szC.w;
            contentCY = szC.y + szC.h / 2;
          }
        }

        // For dividers without tag/logo content, pin line to top edge (slot 0) or bottom edge (slots 1/2)
        const isContentDiv = divId.startsWith('tag') || divId.startsWith('logo');
        const positionalCY = (!isContentDiv && contentW == null)
          ? (li === 0 ? logoCYs[li] : logoCYs[li] + LOGO_CH)
          : null;

        // Draw divider lines — placeholder box hidden when contentW is known; lines align to content center
        const divLift = s.dividerSettings?.[li]?.shadow?.lift ?? 0;
        applyShadow(ctx, s.dividerSettings?.[li]?.shadow);
        drawDividerOnCanvas(ctx, divId, padX, logoCYs[li] - divLift, slotFW, LOGO_CH, contentW, contentCY != null ? contentCY - divLift : positionalCY != null ? positionalCY - divLift : null, s.dividerSettings?.[li], pulseAlphaRef.current);
        clearShadow(ctx);

        // Draw content clipped to the original placeholder zone
        if (subContent && szC) {
          const ha = divId.includes('left') ? 'left'   as const
                   : divId.includes('right') ? 'right'  as const
                   : 'center' as const;
          if (subContent.type === 'image') {
            const img = subImgRefsArr.current[li];
            if (img) {
              ctx.save();
              ctx.beginPath(); ctx.roundRect(szC.x, szC.y, szC.w, szC.h, 8); ctx.clip();
              drawLogoFit(ctx, img, szC.x, szC.y, szC.w, szC.h, ha, va);
              ctx.restore();
            }
          } else if (subContent.type === 'tag' && fittedTs) {
            const tfd = CAROUSEL_FONTS.find(f => f.label === fittedTs.fontLabel) ?? CAROUSEL_FONTS[0];
            drawTag(ctx, subContent.text, padX, logoCYs[li], slotFW, LOGO_CH, ha, va, fittedTs, tfd.css, 1 / DISPLAY_SCALE);
          } else if (subContent.type === 'swipe') {
            const sfd = CAROUSEL_FONTS.find(f => f.label === subContent.style.fontLabel) ?? CAROUSEL_FONTS[0];
            drawSwipeOnCanvas(ctx, szC.x, szC.y, szC.w, szC.h, ha, va, subContent.style, sfd.css);
          }
        }
      });

      // Circle images (drawn between top and bottom slot rows)
      const circleCY = (logoCY_top + LOGO_CH + logoCY_above) / 2; // midpoint between slot 0 and slot 1
      [0, 1].forEach(ci => {
        if (rectMode && ci === 0) return; // rectMode ci=0 handled by drawRect() in bgBlur path and rect block below
        const circleImg = circleImgRefsArr.current[ci];
        if (!circleImg || (s.bgBlurEnabled && fgMaskImgRef.current) || videoModeRef.current) return;
        const pos = circlePosRefsArr.current[ci];
        const _defX  = ci === 0 ? Math.round(CAROUSEL_PREVIEW_W / 4) : Math.round(CAROUSEL_PREVIEW_W * 3 / 4);
        const circleCX   = pos ? pos.x / DISPLAY_SCALE : _defX / DISPLAY_SCALE;
        const circleCanY = pos ? pos.y / DISPLAY_SCALE : circleCY;
        const circleR    = Math.round(circleRadsArr.current[ci] / DISPLAY_SCALE);
        const imgOffset  = circleImgOffsetsArr.current[ci];
        const imgScale   = circleImgScalesArr.current[ci];
        const shadowEnabled = ci === 0 ? s.circleShadowEnabled : s.circle2ShadowEnabled;
        const lift          = ci === 0 ? s.circleLift          : s.circle2Lift;
        if (shadowEnabled || lift > 0) {
          ctx.save();
          if (shadowEnabled) {
            ctx.shadowBlur    = ci === 0 ? s.circleShadowBlur    : s.circle2ShadowBlur;
            ctx.shadowOffsetX = ci === 0 ? s.circleShadowOffsetX : s.circle2ShadowOffsetX;
            ctx.shadowOffsetY = ci === 0 ? s.circleShadowOffsetY : s.circle2ShadowOffsetY;
            ctx.shadowColor   = hexToRgba(ci === 0 ? s.circleShadowColor : s.circle2ShadowColor, (ci === 0 ? s.circleShadowOpacity : s.circle2ShadowOpacity) / 100);
          } else {
            ctx.shadowBlur = lift * 0.5; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = lift * 0.3; ctx.shadowColor = 'rgba(0,0,0,0.7)';
          }
          ctx.beginPath(); ctx.arc(circleCX, circleCanY, circleR, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath(); ctx.arc(circleCX, circleCanY, circleR, 0, Math.PI * 2); ctx.clip();
        const cs = Math.max((circleR * 2) / circleImg.naturalWidth, (circleR * 2) / circleImg.naturalHeight);
        const effectiveCs = cs * imgScale;
        const cdw = circleImg.naturalWidth * effectiveCs, cdh = circleImg.naturalHeight * effectiveCs;
        ctx.drawImage(circleImg, circleCX - cdw / 2 + imgOffset.x, circleCanY - cdh / 2 + imgOffset.y, cdw, cdh);
        ctx.restore();
        const bw = ci === 0 ? s.circleBorderWidth   : s.circle2BorderWidth;
        const bo = ci === 0 ? s.circleBorderOpacity : s.circle2BorderOpacity;
        const bc = ci === 0 ? s.circleBorderColor   : s.circle2BorderColor;
        if (bw > 0 && bo > 0) {
          ctx.save();
          ctx.beginPath(); ctx.arc(circleCX, circleCanY, circleR, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(bc, bo / 100); ctx.lineWidth = bw; ctx.stroke();
          ctx.restore();
        }
      });

      // Rect-mode circle — non-bgBlur path (bgBlur path uses drawRect inside layer loop)
      if (rectMode) {
        const rImg = circleImgRefsArr.current[0];
        if (rImg && !(s.bgBlurEnabled && fgMaskImgRef.current) && !videoModeRef.current) {
          const { top: _rtPv, bottom: _rbPv, left: _rlPv } = rectBandRef.current;
          const _rl  = _rlPv / DISPLAY_SCALE;
          const _rt  = _rtPv / DISPLAY_SCALE;
          const _rw  = W - _rl * 2;
          const _rh  = (_rbPv - _rtPv) / DISPLAY_SCALE;
          const SHIFT_CV = Math.round(50 / DISPLAY_SCALE);
          const _pos = circlePosRefsArr.current[0];
          const _cr  = _pos ? Math.round(circleRadsArr.current[0] / DISPLAY_SCALE) : Math.min(_rh, _rw) / 2 - Math.round(4 / DISPLAY_SCALE);
          const _cx  = _pos ? _pos.x / DISPLAY_SCALE : W / 2 + SHIFT_CV;
          const _cy  = _pos ? _pos.y / DISPLAY_SCALE : _rt + _rh / 2;
          ctx.save();
          ctx.beginPath(); ctx.arc(_cx, _cy, _cr, 0, Math.PI * 2); ctx.clip();
          const _cs  = Math.max((_cr * 2) / rImg.naturalWidth, (_cr * 2) / rImg.naturalHeight);
          const _ecs = _cs * circleImgScalesArr.current[0];
          const _off = circleImgOffsetsArr.current[0];
          const _cdw = rImg.naturalWidth * _ecs, _cdh = rImg.naturalHeight * _ecs;
          ctx.drawImage(rImg, _cx - _cdw / 2 + _off.x, _cy - _cdh / 2 + _off.y, _cdw, _cdh);
          ctx.restore();
        }
      }

      ctx.textBaseline = 'alphabetic';

      const editHead = !targetCanvas && richEditTargetRef.current === 'headline';
      const editSub  = !targetCanvas && richEditTargetRef.current === 'sub';
      const headColor = s.headlineColor ?? '#ffffff';
      const subColor  = s.subheadlineColor ?? '#ffffff';
      const headLift = s.headlineShadow?.lift ?? 0;
      const subLift  = s.subShadow?.lift ?? 0;

      applyShadow(ctx, s.headlineShadow);
      if (text && !editHead) {
        ctx.fillStyle = headColor;
        setLS(lsPx); ctx.font = fs(hSize);
        if (s.headlineSpans && s.headlineSpans.length > 0) {
          const dispSpans = s.allCaps ? s.headlineSpans.map(sp => ({ ...sp, text: sp.text.toUpperCase() })) : s.headlineSpans;
          const linesWO = wrapTextOffsets(ctx, text, MAX_W);
          let y = blockTop - headLift + hLineH * 0.82;
          for (const { line, offset } of linesWO) {
            drawSpanLine(ctx, getLineSpanSegs(dispSpans, offset, line), y, s.textAlign, padX, MAX_W, W, fontDef.css, hSize, s.fontWeight, s.italic, headColor, lsPx, sc);
            y += hLineH;
          }
        } else {
          let y = blockTop - headLift + hLineH * 0.82;
          hLines.forEach((line, i) => { drawAligned(ctx, line, y, i === hLines.length - 1, s.textAlign, padX, MAX_W, W); y += hLineH; });
        }
      }
      clearShadow(ctx);
      applyShadow(ctx, s.subShadow);
      if (subText && !editSub) {
        ctx.fillStyle = subColor;
        setLS(subLsPx); ctx.font = sfs(sSize);
        if (s.subSpans && s.subSpans.length > 0) {
          const dispSpans = s.subAllCaps ? s.subSpans.map(sp => ({ ...sp, text: sp.text.toUpperCase() })) : s.subSpans;
          const linesWO = wrapTextOffsets(ctx, subText, MAX_W);
          let y = blockTop - subLift + hBlockH + gap + sLineH * 0.82;
          for (const { line, offset } of linesWO) {
            drawSpanLine(ctx, getLineSpanSegs(dispSpans, offset, line), y, s.subTextAlign, padX, MAX_W, W, subFontDef.css, sSize, s.subFontWeight, s.subItalic, subColor, subLsPx, sc);
            y += sLineH;
          }
        } else {
          let y = blockTop - subLift + hBlockH + gap + sLineH * 0.82;
          sLines.forEach((line, i) => { drawAligned(ctx, line, y, i === sLines.length - 1, s.subTextAlign, padX, MAX_W, W); y += sLineH; });
        }
      }
      clearShadow(ctx);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; });
    useEffect(() => { slotsRef.current = slots; });
    const onBgLayerStateChangeRef = useRef(onBgLayerStateChange);
    useEffect(() => { onBgLayerStateChangeRef.current = onBgLayerStateChange; });
    useEffect(() => {
      onBgLayerStateChangeRef.current?.({ fgMaskReady: !!fgMaskSrc, isBgProcessing, bgProcessError });
    }, [fgMaskSrc, isBgProcessing, bgProcessError]);

    const redraw = useCallback((img: HTMLImageElement | null) => {
      drawCanvas(img, imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current, settingsRef.current);
    }, [drawCanvas]);

    // Sync isDraggingElement / invertedSlots into refs so drawCanvas can access the latest value
    useEffect(() => {
      isDraggingElementRef.current = isDraggingElement;
      redraw(cachedImgRef.current);
    }, [isDraggingElement, redraw]);
    useEffect(() => {
      invertedSlotsRef.current = invertedSlots;
      redraw(cachedImgRef.current);
    }, [invertedSlots, redraw]);

    // Text-only redraw — stable drawCanvas means this won't cascade into image-reset effects
    useEffect(() => {
      redraw(cachedImgRef.current);
    }, [headline, subheadline]); // eslint-disable-line react-hooks/exhaustive-deps

    // Rich text edit mode — sync ref + redraw (hides canvas text). Kept separate
    // from the contentEditable init below so redraws don't touch the live DOM.
    useEffect(() => {
      richEditTargetRef.current = richEditTarget;
      redraw(cachedImgRef.current);
    }, [richEditTarget, redraw]);

    // Initialize the contentEditable ONCE when entering edit mode. This must NOT
    // depend on redraw: re-running it mid-edit would reset innerHTML back to the
    // last-saved spans, wiping live formatting (e.g. a colour just clicked, which
    // only persists to spans on blur) — so the colour appeared to "not apply until
    // you leave the slide". Now the DOM keeps live edits until blur.
    useEffect(() => {
      if (!richEditTarget || !richEditRef.current) return;
      const s = settingsRef.current;
      const isHead = richEditTarget === 'headline';
      const spans = isHead ? s.headlineSpans : s.subSpans;
      const plainText = isHead
        ? (s.allCaps ? headlineRef.current.toUpperCase() : headlineRef.current)
        : (s.subAllCaps ? subheadlineRef.current.toUpperCase() : subheadlineRef.current);
      richEditRef.current.innerHTML = (spans && spans.length > 0)
        ? spansToHtml(spans)
        : plainText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      richEditRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(richEditRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [richEditTarget]);

    // Track text selection inside contentEditable to show floating toolbar
    useEffect(() => {
      if (!richEditTarget) { setToolbarPos(null); return; }
      function onSelChange() {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !richEditRef.current?.contains(sel.anchorNode)) {
          setToolbarPos(null); return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const wrap = wrapperRef.current?.getBoundingClientRect();
        if (!wrap) return;
        setToolbarPos({
          top:  rect.top  - wrap.top  - 44,
          left: Math.max(4, Math.min(rect.left - wrap.left, CAROUSEL_PREVIEW_W - 200)),
        });
      }
      document.addEventListener('selectionchange', onSelChange);
      return () => document.removeEventListener('selectionchange', onSelChange);
    }, [richEditTarget]);

    const drawCropOverlay = useCallback((r: { x: number; y: number; w: number; h: number }) => {
      const vc = cropOverlayRef.current;
      if (!vc) return;
      const ctx = vc.getContext('2d');
      if (!ctx) return;
      const PW = CAROUSEL_PREVIEW_W, PH = PREVIEW_H;
      ctx.clearRect(0, 0, PW, PH);
      // Dim the 4 strips outside the crop rect
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, PW, r.y);
      ctx.fillRect(0, r.y, r.x, r.h);
      ctx.fillRect(r.x + r.w, r.y, PW - r.x - r.w, r.h);
      ctx.fillRect(0, r.y + r.h, PW, PH - r.y - r.h);
      // Crop border
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      // Rule-of-thirds grid
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i <= 2; i++) {
        const gx = r.x + r.w * i / 3, gy = r.y + r.h * i / 3;
        ctx.beginPath(); ctx.moveTo(gx, r.y); ctx.lineTo(gx, r.y + r.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke();
      }
    }, []);

    function handleLogoFile(idx: number, e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        logoImgsRef.current[idx] = img;
        const next = [...slotsRef.current] as (SlotContent | null)[];
        next[idx] = { type: 'image', url };
        slotsRef.current = next;
        setSlots(next);
        const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(6).fill(null))];
        const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(6).fill(null))];
        const hadTag   = !!curTagSlots[idx];
        const hadQuote = !!curQuoteSlots[idx];
        curTagSlots[idx]   = null;
        curQuoteSlots[idx] = null;
        if (hadTag || hadQuote) onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots });
        redraw(cachedImgRef.current);
      };
      img.src = url;
    }

    function removeSlot(idx: number) {
      const imgSlot = slotsRef.current[idx];
      if (imgSlot?.type === 'image') URL.revokeObjectURL(imgSlot.url);
      logoImgsRef.current[idx] = null;
      const next = [...slotsRef.current] as (SlotContent | null)[];
      next[idx] = null;
      slotsRef.current = next;
      setSlots(next);
      const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(3).fill(null))];
      const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(3).fill(null))];
      const curLogoAligns = [...(settingsRef.current.logoSlotAligns ?? Array(3).fill('center'))] as ('left'|'center'|'right')[];
      const curLogoRow    = [...(settingsRef.current.logoRowSlots ?? Array(3).fill(null))];
      curTagSlots[idx]   = null;
      curQuoteSlots[idx] = null;
      curLogoAligns[idx] = 'center';
      curLogoRow[idx]    = null;
      settingsRef.current = { ...settingsRef.current, tagSlots: curTagSlots, quoteSlots: curQuoteSlots, logoSlotAligns: curLogoAligns, logoRowSlots: curLogoRow };
      onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots, logoSlotAligns: curLogoAligns, logoRowSlots: curLogoRow });
      redraw(cachedImgRef.current);
    }

    const [openSlot, setOpenSlot] = useState<number | null>(null);
    const [slotDropdownPos, setSlotDropdownPos] = useState<{ x: number; y: number } | null>(null);
    const slotContainerRefs = useRef<(HTMLDivElement | null)[]>(Array(3).fill(null));
    const [openSubSlot, setOpenSubSlot] = useState<number | null>(null);
    const [showSubCustom, setShowSubCustom] = useState(false);
    const subSlotBtnRefs = useRef<(HTMLButtonElement | null)[]>(Array(3).fill(null));
    const [subDropdownPos, setSubDropdownPos] = useState<{ x: number; y: number } | null>(null);
    const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
    const [dragOverZone, setDragOverZone] = useState<'left' | 'center' | 'right' | null>(null);
    const [isDividerDrag, setIsDividerDrag] = useState(false);
    const [subDragOverSlot, setSubDragOverSlot] = useState<number | null>(null);
    const [subSlotFilled, setSubSlotFilled] = useState<boolean[]>(() =>
      (settings.dividerSubSlots ?? Array(3).fill(null)).map((s: DividerSubSlotContent | null) => s !== null)
    );
    useEffect(() => {
      setSubSlotFilled((settings.dividerSubSlots ?? Array(3).fill(null)).map((s: DividerSubSlotContent | null) => s !== null));
    }, [settings.dividerSubSlots]);
    const pendingSlotZoneRef = useRef<'left' | 'center' | 'right'>('center');

    // Close slot dropdown when clicking outside any slot or the portal dropdown
    useEffect(() => {
      if (openSlot === null) return;
      function onDoc(e: MouseEvent) {
        if ((e.target as Element).closest('[data-carousel-slot]')) return;
        if ((e.target as Element).closest('[data-slot-dropdown]')) return;
        setOpenSlot(null);
        setSlotDropdownPos(null);
        setShowCustom(false);
      }
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, [openSlot]);

    useEffect(() => {
      if (openSubSlot === null) return;
      function onDoc(e: MouseEvent) {
        if ((e.target as Element).closest('[data-carousel-slot]')) return;
        setOpenSubSlot(null);
        setSubDropdownPos(null);
        setShowSubCustom(false);
      }
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, [openSubSlot]);

    // Load sub-slot images when settings change (e.g. on remount or external settings update)
    useEffect(() => {
      (settings.dividerSubSlots ?? []).forEach((sub, i) => {
        if (sub?.type === 'image' && !subImgRefsArr.current[i]) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { subImgRefsArr.current[i] = img; redraw(cachedImgRef.current); };
          img.src = sub.url;
        }
        if (!sub || sub.type !== 'image') subImgRefsArr.current[i] = null;
      });
    }, [settings.dividerSubSlots]); // eslint-disable-line react-hooks/exhaustive-deps

    // Restore zone logo images when settings are hydrated from DB
    useEffect(() => {
      (settings.zoneLogoSlots ?? []).forEach((logoUrl, fi) => {
        if (!logoUrl) { zoneLogoImgsRef.current[fi] = null; return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { zoneLogoImgsRef.current[fi] = img; redraw(cachedImgRef.current); };
        img.src = logoUrl;
        if (img.complete && img.naturalWidth > 0) { zoneLogoImgsRef.current[fi] = img; redraw(cachedImgRef.current); }
      });
    }, [settings.zoneLogoSlots]); // eslint-disable-line react-hooks/exhaustive-deps

    // Restore row-slot logo images when settings are hydrated from DB
    useEffect(() => {
      (settings.logoRowSlots ?? []).forEach((logoUrl, idx) => {
        if (!logoUrl) { logoImgsRef.current[idx] = null; return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const apply = () => {
          logoImgsRef.current[idx] = img;
          const next = [...slotsRef.current] as (SlotContent | null)[];
          next[idx] = { type: 'image', url: logoUrl };
          slotsRef.current = next;
          setSlots(next);
          redraw(cachedImgRef.current);
        };
        img.onload = apply;
        img.src = logoUrl;
        if (img.complete && img.naturalWidth > 0) apply();
      });
    }, [settings.logoRowSlots]); // eslint-disable-line react-hooks/exhaustive-deps

    function selectBrandLogo(idx: number) {
      if (!brandLogoSrc) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let applied = false;
      const apply = () => {
        if (applied) return;
        applied = true;
        logoImgsRef.current[idx] = img;
        const next = [...slotsRef.current] as (SlotContent | null)[];
        next[idx] = { type: 'image', url: brandLogoSrc };
        slotsRef.current = next;
        setSlots(next);
        const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(3).fill(null))];
        const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(3).fill(null))];
        const curLogoRow    = [...(settingsRef.current.logoRowSlots ?? Array(3).fill(null))];
        curTagSlots[idx]   = null;
        curQuoteSlots[idx] = null;
        curLogoRow[idx]    = brandLogoSrc;
        settingsRef.current = { ...settingsRef.current, tagSlots: curTagSlots, quoteSlots: curQuoteSlots, logoRowSlots: curLogoRow };
        onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots, logoRowSlots: curLogoRow });
        redraw(cachedImgRef.current);
      };
      img.onload = apply;
      img.src = brandLogoSrc;
      if (img.complete && img.naturalWidth > 0) apply();
    }

    function selectTag(idx: number, text: string, style: TagStyle) {
      const imgSlot = slotsRef.current[idx];
      if (imgSlot?.type === 'image') URL.revokeObjectURL(imgSlot.url);
      logoImgsRef.current[idx] = null;
      const next = [...slotsRef.current] as (SlotContent | null)[];
      next[idx] = null;
      slotsRef.current = next;
      setSlots(next);
      const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(3).fill(null))];
      const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(3).fill(null))];
      curTagSlots[idx]   = { text, style };
      curQuoteSlots[idx] = null;
      settingsRef.current = { ...settingsRef.current, tagSlots: curTagSlots, quoteSlots: curQuoteSlots };
      onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots });
    }

    const ZONES = ['left', 'center', 'right'] as const;
    function ziFromZone(z: 'left' | 'center' | 'right') { return z === 'left' ? 0 : z === 'center' ? 1 : 2; }

    function selectTagZone(row: number, zone: 'left' | 'center' | 'right', text: string, style: TagStyle) {
      const fi = row * 3 + ziFromZone(zone);
      const cur = [...(settingsRef.current.tagZoneSlots ?? Array(9).fill(null))];
      cur[fi] = { text, style };
      settingsRef.current = { ...settingsRef.current, tagZoneSlots: cur };
      onSettingsChange?.({ tagZoneSlots: cur });
      redraw(cachedImgRef.current);
    }

    function selectBrandLogoZone(row: number, zone: 'left' | 'center' | 'right') {
      if (!brandLogoSrc) return;
      const fi = row * 3 + ziFromZone(zone);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let applied = false;
      const apply = () => {
        if (applied) return;
        applied = true;
        zoneLogoImgsRef.current[fi] = img;
        const cur = [...(settingsRef.current.zoneLogoSlots ?? Array(9).fill(null))];
        cur[fi] = brandLogoSrc;
        settingsRef.current = { ...settingsRef.current, zoneLogoSlots: cur };
        onSettingsChange?.({ zoneLogoSlots: cur });
        redraw(cachedImgRef.current);
      };
      img.onload = apply;
      img.src = brandLogoSrc;
      if (img.complete && img.naturalWidth > 0) apply();
    }

    function selectQuoteZone(row: number, zone: 'left' | 'center' | 'right', styleId: string) {
      const fi = row * 3 + ziFromZone(zone);
      const cur = [...(settingsRef.current.quoteZoneSlots ?? Array(9).fill(null))];
      cur[fi] = styleId;
      settingsRef.current = { ...settingsRef.current, quoteZoneSlots: cur };
      onSettingsChange?.({ quoteZoneSlots: cur });
      redraw(cachedImgRef.current);
    }

    function selectSwipeZone(row: number, zone: 'left' | 'center' | 'right', style: SwipeStyle) {
      const fi = row * 3 + ziFromZone(zone);
      const cur = [...(settingsRef.current.swipeZoneSlots ?? Array(9).fill(null))];
      cur[fi] = style;
      settingsRef.current = { ...settingsRef.current, swipeZoneSlots: cur };
      onSettingsChange?.({ swipeZoneSlots: cur });
      redraw(cachedImgRef.current);
    }

    function removeZoneSlot(row: number, zone: 'left' | 'center' | 'right') {
      const fi = row * 3 + ziFromZone(zone);
      const curTag   = [...(settingsRef.current.tagZoneSlots   ?? Array(9).fill(null))];
      const curQuo   = [...(settingsRef.current.quoteZoneSlots ?? Array(9).fill(null))];
      const curLogo  = [...(settingsRef.current.zoneLogoSlots  ?? Array(9).fill(null))];
      const curSwipe = [...(settingsRef.current.swipeZoneSlots ?? Array(9).fill(null))];
      curTag[fi]  = null;
      curQuo[fi]  = null;
      curLogo[fi] = null;
      curSwipe[fi] = null;
      zoneLogoImgsRef.current[fi] = null;
      settingsRef.current = { ...settingsRef.current, tagZoneSlots: curTag, quoteZoneSlots: curQuo, zoneLogoSlots: curLogo, swipeZoneSlots: curSwipe };
      onSettingsChange?.({ tagZoneSlots: curTag, quoteZoneSlots: curQuo, zoneLogoSlots: curLogo, swipeZoneSlots: curSwipe });
      redraw(cachedImgRef.current);
    }

    function setTagSlotAlign(idx: number, align: 'left' | 'center' | 'right') {
      const cur = [0, 1, 2].map(k =>
        (settingsRef.current.tagSlotAligns?.[k] ?? 'center') as 'left' | 'center' | 'right'
      );
      cur[idx] = align;
      settingsRef.current = { ...settingsRef.current, tagSlotAligns: cur };
      onSettingsChange?.({ tagSlotAligns: cur });
      redraw(cachedImgRef.current);
    }

    function setLogoSlotAlign(idx: number, align: 'left' | 'center' | 'right') {
      const cur = [0, 1, 2].map(k =>
        (settingsRef.current.logoSlotAligns?.[k] ?? 'center') as 'left' | 'center' | 'right'
      );
      cur[idx] = align;
      settingsRef.current = { ...settingsRef.current, logoSlotAligns: cur };
      onSettingsChange?.({ logoSlotAligns: cur });
      redraw(cachedImgRef.current);
    }

    function selectQuote(idx: number, styleId: string) {
      const imgSlot = slotsRef.current[idx];
      if (imgSlot?.type === 'image') URL.revokeObjectURL(imgSlot.url);
      logoImgsRef.current[idx] = null;
      const next = [...slotsRef.current] as (SlotContent | null)[];
      next[idx] = null;
      slotsRef.current = next;
      setSlots(next);
      const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(3).fill(null))];
      const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(3).fill(null))];
      curTagSlots[idx]   = null;
      curQuoteSlots[idx] = styleId;
      settingsRef.current = { ...settingsRef.current, tagSlots: curTagSlots, quoteSlots: curQuoteSlots };
      onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots });
    }

    function handleSubSlotFile(idx: number, e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        subImgRefsArr.current[idx] = img;
        const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
        cur[idx] = { type: 'image', url };
        settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
        onSettingsChange?.({ dividerSubSlots: cur });
        redraw(cachedImgRef.current);
      };
      img.src = url;
    }

    function selectSubBrandLogo(idx: number) {
      if (!brandLogoSrc) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let applied = false;
      const apply = () => {
        if (applied) return;
        applied = true;
        subImgRefsArr.current[idx] = img;
        const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
        cur[idx] = { type: 'image', url: brandLogoSrc };
        settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
        onSettingsChange?.({ dividerSubSlots: cur });
        redraw(cachedImgRef.current);
      };
      img.onload = apply;
      img.src = brandLogoSrc;
      if (img.complete && img.naturalWidth > 0) apply();
      setSubSlotFilled(prev => { const n = [...prev]; n[idx] = true; return n; });
    }

    function selectSubTag(idx: number, text: string, style: TagStyle) {
      const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
      cur[idx] = { type: 'tag', text, style };
      settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
      onSettingsChange?.({ dividerSubSlots: cur });
      redraw(cachedImgRef.current);
      setSubSlotFilled(prev => { const n = [...prev]; n[idx] = true; return n; });
    }

    function selectSubSwipe(idx: number, style: SwipeStyle) {
      const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
      cur[idx] = { type: 'swipe', style };
      settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
      onSettingsChange?.({ dividerSubSlots: cur });
      redraw(cachedImgRef.current);
      setSubSlotFilled(prev => { const n = [...prev]; n[idx] = true; return n; });
    }

    function clearSubSlot(idx: number) {
      const sub = settingsRef.current.dividerSubSlots?.[idx];
      if (sub?.type === 'image') URL.revokeObjectURL(sub.url);
      subImgRefsArr.current[idx] = null;
      const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
      cur[idx] = null;
      settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
      onSettingsChange?.({ dividerSubSlots: cur });
      redraw(cachedImgRef.current);
      setSubSlotFilled(prev => { const n = [...prev]; n[idx] = false; return n; });
    }

    // Image load — reset transform + crop + clear bg mask
    useEffect(() => {
      imgOffsetRef.current  = { x: 0, y: 0 };
      imgScaleRef.current   = 1; setImgScale(1);
      imgSrcCropRef.current = null;
      fgMaskImgRef.current  = null;
      fgMaskSrcRef.current  = null;
      setFgMaskSrc(null);
      setBgProcessError(false);
      onSettingsChange?.({ bgBlurEnabled: false });
      if (!imageSrc) { cachedImgRef.current = null; redraw(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => { cachedImgRef.current = img; redraw(img); runBgRemovalRef.current('split'); };
      img.onerror = () => { cachedImgRef.current = null; redraw(null); };
      img.src = imageSrc;
    }, [imageSrc, redraw]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Video mode: reset transform on src change + run animation loop for live draw
    useEffect(() => {
      if (!videoSrc) { if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; } return; }
      imgOffsetRef.current = { x: 0, y: 0 };
      imgScaleRef.current  = 1; setImgScale(1);
      imgSrcCropRef.current = null;
      trimStartRef.current = 0;
      trimEndRef.current   = Infinity;
    }, [videoSrc]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (!videoSrc) return;
      let id: number;
      let lastDrawTime = 0;
      const loop = () => {
        const v = videoRef.current;
        if (v && !v.paused) {
          const end = trimEndRef.current === Infinity ? v.duration : trimEndRef.current;
          if (!isNaN(end) && v.currentTime >= end) {
            v.currentTime = trimStartRef.current;
          }
          lastDrawTime = 0; // reset throttle so next paused check draws immediately
          redraw(null);
        } else {
          const now = performance.now();
          if (now - lastDrawTime >= 100) {
            lastDrawTime = now;
            redraw(null);
          }
        }
        id = requestAnimationFrame(loop);
      };
      id = requestAnimationFrame(loop);
      animFrameRef.current = id;
      return () => { cancelAnimationFrame(id); animFrameRef.current = null; };
    }, [videoSrc, redraw]);

    // ── Chart background: load the market avatar (via proxy) ──────────────────
    useEffect(() => {
      const url = chartBg?.market?.photo_url;
      if (!url) { chartAvatarRef.current = null; redraw(cachedImgRef.current); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => { chartAvatarRef.current = img; redraw(cachedImgRef.current); };
      img.onerror = () => { chartAvatarRef.current = null; redraw(cachedImgRef.current); };
      img.src = `/api/charts/image-proxy?url=${encodeURIComponent(url)}`;
    }, [chartBg?.market?.photo_url, redraw]);

    // Load the Pauv logo once (drawn faint in the chart's bottom bar).
    useEffect(() => {
      const img = new Image();
      img.onload = () => { chartPauvLogoRef.current = img; redraw(cachedImgRef.current); };
      img.src = '/pauvlogo.png';
    }, [redraw]);

    // Redraw (and restart the reveal) whenever the chart or its config changes.
    useEffect(() => {
      chartAnimStartRef.current = 0;
      redraw(cachedImgRef.current);
    }, [chartBg?.market?.id, chartBg?.market?.sparkline?.length, chartBg?.subMode,
        chartBg?.strength, chartBg?.noise, chartBg?.overrideName,
        chartBg?.overrideIndustry, chartBg?.speed, redraw]);

    // Animation loop for an animated chart background (line draws in + tip pulses).
    const chartVideoActive = !!chartBg && chartBg.subMode === 'video';
    useEffect(() => {
      if (!chartVideoActive) return;
      let id = requestAnimationFrame(function loop() {
        redraw(cachedImgRef.current);
        id = requestAnimationFrame(loop);
      });
      return () => cancelAnimationFrame(id);
    }, [chartVideoActive, redraw]);

    // Pulse animation loop for divider placeholder boxes
    useEffect(() => {
      const hasDivSlots = (settings.dividerSlots ?? []).some(d => d !== null);
      if (!hasDivSlots) {
        if (pulseRafRef.current !== null) { cancelAnimationFrame(pulseRafRef.current); pulseRafRef.current = null; }
        pulseAlphaRef.current = 0.12;
        return;
      }
      let id: number;
      const tick = (t: number) => {
        pulseAlphaRef.current = 0.08 + 0.06 * Math.sin(t / 900 * Math.PI * 2);
        if (!videoModeRef.current) redraw(cachedImgRef.current);
        id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
      pulseRafRef.current = id;
      return () => { cancelAnimationFrame(id); pulseRafRef.current = null; };
    }, [settings.dividerSlots, redraw]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load foreground mask image when mask src changes
    useEffect(() => {
      if (!fgMaskSrc) { fgMaskImgRef.current = null; return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { fgMaskImgRef.current = img; redraw(cachedImgRef.current); };
      img.src = fgMaskSrc;
    }, [fgMaskSrc, redraw]);

    // Circle images are sourced from settings (uploaded/pasted in the settings
    // panel). Mirror them into circleSrcs, which the rest of the circle machinery
    // (load → draw, drag/resize) already keys off.
    useEffect(() => {
      setCircleSrcs([settings.circleImageSrc ?? null, settings.circle2ImageSrc ?? null]);
    }, [settings.circleImageSrc, settings.circle2ImageSrc]);

    // Circle image loads (separate effects so changing one src doesn't re-trigger the other)
    const [circleSrc0, circleSrc1] = [circleSrcs[0], circleSrcs[1]];
    useEffect(() => {
      if (!circleSrc0) { circleImgRefsArr.current[0] = null; redraw(cachedImgRef.current); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { circleImgRefsArr.current[0] = img; redraw(cachedImgRef.current); };
      img.src = circleSrc0;
    }, [circleSrc0, redraw]);
    useEffect(() => {
      if (!circleSrc1) { circleImgRefsArr.current[1] = null; redraw(cachedImgRef.current); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { circleImgRefsArr.current[1] = img; redraw(cachedImgRef.current); };
      img.src = circleSrc1;
    }, [circleSrc1, redraw]);

    // Font async redraw
    useEffect(() => {
      const f1 = CAROUSEL_FONTS.find(f => f.label === settings.fontLabel)    ?? CAROUSEL_FONTS[0];
      const f2 = CAROUSEL_FONTS.find(f => f.label === settings.subFontLabel) ?? CAROUSEL_FONTS[0];
      Promise.all([
        ensureFontLoaded(f1, settings.fontWeight, settings.italic),
        ensureFontLoaded(f2, settings.subFontWeight, settings.subItalic),
      ]).then(() => redraw(cachedImgRef.current));
    }, [settings.fontLabel, settings.fontWeight, settings.italic, settings.subFontLabel, settings.subFontWeight, settings.subItalic, redraw]);

    // Sync redraw on any settings change
    useEffect(() => {
      drawCanvas(cachedImgRef.current, imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current, settings);
    }, [drawCanvas, settings]);

    // Wheel zoom — on the wrapper div so canvas pointer-events: none doesn't block scrolling
    useEffect(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      function onWheel(e: WheelEvent) {
        e.preventDefault();
        // Gentle steps per wheel tick — zooming should creep, not jump, so the
        // crop can be dialled in precisely.
        const next = Math.max(0.2, Math.min(8, imgScaleRef.current * (1 + (-e.deltaY) * 0.0008)));
        imgScaleRef.current = next; setImgScale(next);
        onScaleChange?.(next);
        redraw(cachedImgRef.current);
      }
      wrapper.addEventListener('wheel', onWheel, { passive: false });
      return () => wrapper.removeEventListener('wheel', onWheel);
    }, [redraw, onScaleChange]);

    // Drag
    useEffect(() => {
      function onMove(e: MouseEvent) {
        if (!isDragging) return;
        const dx = (e.clientX - dragStartRef.current.mx) / DISPLAY_SCALE;
        const dy = (e.clientY - dragStartRef.current.my) / DISPLAY_SCALE;
        imgOffsetRef.current = { x: dragStartRef.current.ox + dx, y: dragStartRef.current.oy + dy };
        redraw(cachedImgRef.current);
      }
      function onUp() { setIsDragging(false); }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [isDragging, redraw]);

    // Circle drag (handles whichever circle is active)
    useEffect(() => {
      if (activeDragCircle === null) return;
      const idx = activeDragCircle;
      function onMove(e: MouseEvent) {
        const dx = e.clientX - circleDragStart.current.mx;
        const dy = e.clientY - circleDragStart.current.my;
        const r = circleRadsArr.current[idx];
        // Boundary parameter: allow the circle to bleed slightly off the post
        // edges for creative framing, capped at a fraction of its radius so it can
        // hang off the border a touch without drifting out of frame.
        const bleed = Math.round(r * CIRCLE_DRAG_BLEED_RATIO);
        const newX = Math.max(r - bleed, Math.min(CAROUSEL_PREVIEW_W - r + bleed, circleDragStart.current.cx + dx));
        const newY = Math.max(r - bleed, Math.min(PREVIEW_H - r + bleed, circleDragStart.current.cy + dy));
        circlePosRefsArr.current[idx] = { x: newX, y: newY };
        setCirclePoses(prev => { const n = [...prev]; n[idx] = { x: newX, y: newY }; return n; });
        redraw(cachedImgRef.current);
      }
      function onUp() { setActiveDragCircle(null); }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [activeDragCircle, redraw]);

    // Circle resize
    useEffect(() => {
      if (activeResizeCircle === null) return;
      const idx = activeResizeCircle;
      function onMove(e: MouseEvent) {
        const bounds = wrapperRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const mx = e.clientX - bounds.left;
        const my = e.clientY - bounds.top;
        const { cx, cy } = circleResizeStart.current;
        const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
        const maxR = Math.min(CAROUSEL_PREVIEW_W, PREVIEW_H) / 2;
        const newR = Math.max(20, Math.min(maxR, Math.round(dist)));
        circleRadsArr.current[idx] = newR;
        setCircleRadii(prev => { const n = [...prev]; n[idx] = newR; return n; });
        redraw(cachedImgRef.current);
      }
      function onUp() { setActiveResizeCircle(null); }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [activeResizeCircle, redraw]);

    // Circle image pan
    useEffect(() => {
      if (activeImgDragCircle === null) return;
      const idx = activeImgDragCircle;
      function onMove(e: MouseEvent) {
        const dx = e.clientX - circleImgDragStart.current.mx;
        const dy = e.clientY - circleImgDragStart.current.my;
        circleImgOffsetsArr.current[idx] = {
          x: circleImgDragStart.current.ox + dx / DISPLAY_SCALE,
          y: circleImgDragStart.current.oy + dy / DISPLAY_SCALE,
        };
        redraw(cachedImgRef.current);
      }
      function onUp() { setActiveImgDragCircle(null); }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [activeImgDragCircle, redraw]);

    // Circle image zoom via drag handle
    useEffect(() => {
      if (activeZoomDragCircle === null) return;
      const idx = activeZoomDragCircle;
      function onMove(e: MouseEvent) {
        const dy = e.clientY - circleZoomDragStart.current.my;
        const newScale = Math.max(0.5, Math.min(10, circleZoomDragStart.current.scale * Math.exp(-dy / 80)));
        circleImgScalesArr.current[idx] = newScale;
        redraw(cachedImgRef.current);
      }
      function onUp() { setActiveZoomDragCircle(null); }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [activeZoomDragCircle, redraw]);

    // Circle image wheel zoom — attach to each circle element
    useEffect(() => {
      const els = [circleEl0Ref.current, circleEl1Ref.current];
      const cleanups: (() => void)[] = [];
      els.forEach((el, idx) => {
        if (!el || !circleSrcs[idx]) return;
        function onWheel(e: WheelEvent) {
          e.preventDefault(); e.stopPropagation();
          const next = Math.max(0.5, Math.min(10, circleImgScalesArr.current[idx] * (1 + (-e.deltaY) * 0.005)));
          circleImgScalesArr.current[idx] = next;
          redraw(cachedImgRef.current);
        }
        el.addEventListener('wheel', onWheel, { passive: false });
        cleanups.push(() => el.removeEventListener('wheel', onWheel));
      });
      return () => cleanups.forEach(c => c());
    }, [circleSrcs, redraw]);

    // Escape exits circle image edit mode
    useEffect(() => {
      if (!circleImgEditModes.some(Boolean)) return;
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') setCircleImgEditModes([false, false]);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [circleImgEditModes]);

    // Escape exits crop mode and restores pre-entry state
    useEffect(() => {
      if (!isCropMode) return;
      function onKey(e: KeyboardEvent) {
        if (e.key !== 'Escape') return;
        const saved = cropEntryStateRef.current;
        if (saved) {
          imgSrcCropRef.current = saved.crop;
          imgOffsetRef.current  = { x: saved.ox, y: saved.oy };
          imgScaleRef.current   = saved.sc;
          setImgScale(saved.sc);
          onScaleChange?.(saved.sc);
          redraw(cachedImgRef.current);
          cropEntryStateRef.current = null;
        }
        setIsCropMode(false);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [isCropMode, redraw, onScaleChange]);

    // Redraw overlay whenever cropRect changes (e.g. snap to 4:5, reset)
    useEffect(() => { if (isCropMode) drawCropOverlay(cropRect); }, [cropRect, isCropMode, drawCropOverlay]);
    // Draw overlay on enter; clear on exit
    useEffect(() => {
      if (isCropMode) { drawCropOverlay(cropRectRef.current); }
      else { cropOverlayRef.current?.getContext('2d')?.clearRect(0, 0, CAROUSEL_PREVIEW_W, PREVIEW_H); }
    }, [isCropMode, drawCropOverlay]);

    // Crop handle drag
    useEffect(() => {
      if (!isCropMode) return;
      const MIN = 40, PW = CAROUSEL_PREVIEW_W, PH = PREVIEW_H;
      const AR  = W / H; // width / height — the frame's own aspect

      function computeRect(
        handle: string, dx: number, dy: number,
        s: { x: number; y: number; w: number; h: number },
        lock: 'free' | '4:5',
      ) {
        let { x, y, w, h } = s;
        const clW = (v: number) => Math.min(Math.max(v, MIN), PW);
        const clH = (v: number) => Math.min(Math.max(v, MIN), PH);
        switch (handle) {
          case 'se': w = clW(s.w + dx); h = lock === '4:5' ? w / AR : clH(s.h + dy); break;
          case 'sw': w = clW(s.w - dx); x = s.x + s.w - w; h = lock === '4:5' ? w / AR : clH(s.h + dy); break;
          case 'ne': w = clW(s.w + dx); h = lock === '4:5' ? w / AR : clH(s.h - dy); y = s.y + s.h - h; break;
          case 'nw': w = clW(s.w - dx); x = s.x + s.w - w; h = lock === '4:5' ? w / AR : clH(s.h - dy); y = s.y + s.h - h; break;
          case 'e':  w = clW(s.w + dx); if (lock === '4:5') { h = w / AR; y = s.y + (s.h - h) / 2; } break;
          case 'w':  w = clW(s.w - dx); x = s.x + s.w - w; if (lock === '4:5') { h = w / AR; y = s.y + (s.h - h) / 2; } break;
          case 's':  h = clH(s.h + dy); if (lock === '4:5') { w = h * AR; x = s.x + (s.w - w) / 2; } break;
          case 'n':  h = clH(s.h - dy); y = s.y + s.h - h; if (lock === '4:5') { w = h * AR; x = s.x + (s.w - w) / 2; } break;
        }
        // Clamp to canvas bounds
        if (x < 0) { w += x; x = 0; }
        if (y < 0) { h += y; y = 0; }
        if (x + w > PW) w = PW - x;
        if (y + h > PH) h = PH - y;
        return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      }

      function onMove(e: MouseEvent) {
        if (!cropActiveHandle.current) return;
        const dx = e.clientX - cropDragStart.current.mx;
        const dy = e.clientY - cropDragStart.current.my;
        const nr = computeRect(cropActiveHandle.current, dx, dy, cropDragStart.current.rect, cropLockRef.current);
        cropRectRef.current = nr;
        setCropRect(nr);
        drawCropOverlay(nr);
      }
      function onUp() { cropActiveHandle.current = null; }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [isCropMode, drawCropOverlay]);

    const runBgRemovalRef = useRef<(mode: 'split' | 'blur') => void>(() => {});
    async function runBgRemoval(mode: 'split' | 'blur' = 'split') {
      const img = cachedImgRef.current;
      if (!img || isBgProcessing) return;
      // If mask already exists, just switch mode
      if (fgMaskSrcRef.current) {
        const cur = settingsRef.current;
        if (mode === 'split') {
          onSettingsChange?.({ bgBlurEnabled: !(cur.bgBlurEnabled && cur.bgBlurAmount === 0), bgBlurAmount: 0 });
        } else {
          const newEnabled = !(cur.bgBlurEnabled && cur.bgBlurAmount > 0);
          onSettingsChange?.({ bgBlurEnabled: newEnabled, bgBlurAmount: newEnabled ? (cur.bgBlurAmount > 0 ? cur.bgBlurAmount : 10) : 0 });
        }
        return;
      }
      setIsBgProcessing(true);
      setBgProcessError(false);
      try {
        // Convert HTMLImageElement → Blob (library requires Blob/URL, not HTMLImageElement)
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width  = img.naturalWidth;
        tmpCanvas.height = img.naturalHeight;
        const tmpCtx = tmpCanvas.getContext('2d')!;
        tmpCtx.drawImage(img, 0, 0);
        const imgBlob = await new Promise<Blob>((res, rej) =>
          tmpCanvas.toBlob(b => b ? res(b) : rej(new Error('canvas toBlob failed')), 'image/jpeg', 0.92)
        );

        const { removeBackground } = await import('@imgly/background-removal');
        const blob = await removeBackground(imgBlob, {
          model: 'isnet_quint8',
          output: { format: 'image/png', quality: 1 },
        });
        const url = URL.createObjectURL(blob);
        fgMaskSrcRef.current = url;
        setFgMaskSrc(url);
        // Default to split (0 blur); blur mode activates only when explicitly requested
        onSettingsChange?.({ bgBlurEnabled: true, bgBlurAmount: mode === 'blur' ? (settingsRef.current.bgBlurAmount > 0 ? settingsRef.current.bgBlurAmount : 10) : 0 });
      } catch (err) {
        console.error('[BG Blur] removeBackground failed:', err);
        setBgProcessError(true);
      } finally {
        setIsBgProcessing(false);
      }
    }
    runBgRemovalRef.current = runBgRemoval;

    // ── Animated chart background → MP4 ──────────────────────────────────────
    // A generated chart has no source video file, so the normal carousel export
    // (which decodes a source MP4) doesn't apply. Instead record the live canvas
    // (captureStream + MediaRecorder), then mux in the chosen audio + rewrite a
    // clean MP4 client-side — the same host-independent approach the Charts
    // Image video export uses.
    const startChartVideoExportRef = useRef<() => Promise<void>>(async () => {});
    async function startChartVideoExport(): Promise<void> {
      const canvas = canvasRef.current;
      const cb = chartBgRef.current;
      if (!canvas || isVideoExporting || !cb?.market) return;
      if ((cb.market.sparkline?.length ?? 0) === 0) return;

      const emit = (progress: number, status: string) => {
        setVideoExportProgress(progress);
        setVideoExportStatus(status);
        onRecordingStateChangeRef.current?.({ isRecording: true, recProgress: progress, recStatus: status });
      };
      const done = () => {
        setVideoExportStatus('');
        onRecordingStateChangeRef.current?.({ isRecording: false, recProgress: 0, recStatus: '' });
      };

      setIsVideoExporting(true);
      emit(0, 'Starting…');
      let framePump: ReturnType<typeof setInterval> | null = null;

      try {
        // Restart the reveal so the recording captures the full draw-in.
        chartAnimStartRef.current = 0;
        await new Promise<void>(r => setTimeout(r, 80)); // let one frame restart the clock

        const mimeType =
          typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
            ? 'video/mp4;codecs=avc1'
            : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4')
              ? 'video/mp4'
              : 'video/webm;codecs=vp9';

        // captureStream(0) + manual requestFrame so static stretches (the hold)
        // are still captured. See the Charts Image export for the rationale.
        let stream = canvas.captureStream(0);
        let captureTrack = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
        if (typeof captureTrack?.requestFrame !== 'function') {
          stream = canvas.captureStream(30);
          captureTrack = null as never;
        }

        let audioEl: HTMLAudioElement | null = null;
        if (cb.audioUrl && !mutedRef.current) {
          try {
            audioEl = new Audio(cb.audioUrl);
            audioEl.preload = 'auto';
            await new Promise<void>(res => {
              if (!audioEl || audioEl.readyState >= 3) { res(); return; }
              audioEl.oncanplay = () => res();
              setTimeout(res, 6000);
            });
          } catch { audioEl = null; }
        }

        const speed   = Math.min(3, Math.max(1, cb.speed || 1));
        const cycleMs  = GROW_MS / speed + HOLD_MS;
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
        const chunks: Blob[] = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.start(200);

        if (audioEl) { audioEl.currentTime = 0; audioEl.play().catch(() => {}); }

        if (typeof captureTrack?.requestFrame === 'function') {
          framePump = setInterval(() => {
            if (!document.hidden) { try { captureTrack.requestFrame?.(); } catch { /* track ended */ } }
          }, 1000 / 30);
        }

        emit(0.01, 'Recording…');

        const startMs = performance.now();
        await new Promise<void>(resolve => {
          const tick = () => {
            const p = Math.min((performance.now() - startMs) / cycleMs, 1);
            emit(p, 'Recording…');
            if (p >= 1) resolve(); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

        if (framePump) { clearInterval(framePump); framePump = null; }
        audioEl?.pause();

        recorder.stop();
        await new Promise<void>(r => { recorder.onstop = () => r(); });

        emit(0.98, 'Processing…');
        const videoBlob = new Blob(chunks, { type: mimeType });

        let blob = videoBlob;
        try {
          const res = await muxClientSide(videoBlob, mutedRef.current ? null : (cb.audioUrl ?? null), s => emit(0.98, s));
          blob = res.blob;
        } catch (e) {
          console.error('[carousel chart export] client-side mux failed — raw recording:', e);
        }

        const status = await sendToPhonedeck(blob, `carousel-chart-${Date.now()}.mp4`);
        emit(1, status);
        setTimeout(done, 5000);
      } catch (err) {
        emit(0, `Error: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(done, 5000);
      } finally {
        if (framePump) { clearInterval(framePump); framePump = null; }
        setIsVideoExporting(false);
      }
    }
    startChartVideoExportRef.current = startChartVideoExport;

    const startVideoExportRef = useRef<() => Promise<void>>(async () => {});

    async function startVideoExport(): Promise<void> {
      const srcUrl = videoSrcRef.current;
      if (!srcUrl || isVideoExporting) return;

      const abortController = new AbortController();
      videoExportAbortRef.current = abortController;
      const signal = abortController.signal;

      const emit = (progress: number, status: string) => {
        setVideoExportProgress(progress);
        setVideoExportStatus(status);
        onRecordingStateChangeRef.current?.({ isRecording: true, recProgress: progress, recStatus: status });
      };

      setIsVideoExporting(true);
      emit(0, 'Initializing...');

      try {
        // @ts-ignore
        const MP4BoxLib = (await import('mp4box')).default;
        const mediabunny = await import('mediabunny');
        const {
          Output, Mp4OutputFormat, BufferTarget, VideoSample, VideoSampleSource,
          Input, BlobSource, ALL_FORMATS, QUALITY_HIGH, EncodedAudioPacketSource, EncodedPacketSink,
        } = mediabunny;

        const EXPORT_FPS = 30;
        const EXPORT_FRAME_DURATION = 1 / EXPORT_FPS;

        emit(0, 'Downloading video...');
        const response = await fetch(srcUrl, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();

        if (signal.aborted) throw new Error('Cancelled');

        emit(0.05, 'Parsing video...');
        // @ts-ignore
        const MP4BoxFile = MP4BoxLib.createFile();
        const videoSamples: Array<{ data: Uint8Array; timestamp: number; duration: number; isKeyframe: boolean }> = [];
        const audioSamples: Array<{ data: Uint8Array; timestamp: number; duration: number }> = [];
        let videoTrackId: number | null = null;
        let audioTrackId: number | null = null;
        let videoTimescale = 90000;
        let audioTimescale = 44100;

        MP4BoxFile.onReady = (info: any) => {
          for (const track of info.tracks || []) {
            if (track.type === 'video' && !videoTrackId) { videoTrackId = track.id; videoTimescale = track.timescale || 90000; }
            if (track.type === 'audio' && !audioTrackId) { audioTrackId = track.id; audioTimescale = track.timescale || 44100; }
          }
          if (videoTrackId) MP4BoxFile.setExtractionOptions(videoTrackId, null, { nbSamples: Infinity });
          if (audioTrackId) MP4BoxFile.setExtractionOptions(audioTrackId, null, { nbSamples: Infinity });
          MP4BoxFile.start();
        };
        MP4BoxFile.onSamples = (id: number, _user: any, samples: any[]) => {
          if (id === videoTrackId) {
            for (const s of samples) videoSamples.push({ data: new Uint8Array(s.data), timestamp: s.cts / videoTimescale, duration: s.duration / videoTimescale, isKeyframe: s.is_sync });
          }
          if (id === audioTrackId) {
            for (const s of samples) audioSamples.push({ data: new Uint8Array(s.data), timestamp: s.cts / audioTimescale, duration: s.duration / audioTimescale });
          }
        };
        // @ts-ignore
        MP4BoxFile.onError = (e: any) => console.error('[MP4Box carousel]', e);

        const copy = arrayBuffer.slice(0);
        // @ts-ignore
        copy.fileStart = 0;
        // @ts-ignore
        MP4BoxFile.appendBuffer(copy);
        // @ts-ignore
        MP4BoxFile.flush();

        await new Promise<void>((resolve, reject) => {
          const t = Date.now();
          const id = setInterval(() => {
            if (videoSamples.length > 0) { clearInterval(id); resolve(); }
            else if (Date.now() - t > 10000) { clearInterval(id); reject(new Error('Timeout extracting video samples')); }
          }, 100);
        });

        if (videoSamples.length === 0) throw new Error('No video samples found');

        const lastSample = videoSamples[videoSamples.length - 1];
        const fullDuration = lastSample.timestamp + lastSample.duration;
        const clipStart = trimStartRef.current;
        const clipEnd = trimEndRef.current > 0 && trimEndRef.current <= fullDuration ? trimEndRef.current : fullDuration;
        const clipDuration = Math.max(0.1, clipEnd - clipStart);
        const totalFrames = Math.floor(clipDuration * EXPORT_FPS);

        emit(0.1, 'Decoding video...');

        const decodedFrames: Array<{ frame: VideoFrame; timestamp: number }> = [];
        const decoder = new VideoDecoder({
          output: (frame: VideoFrame) => { decodedFrames.push({ frame, timestamp: frame.timestamp / 1_000_000 }); },
          error: (e: Error) => console.error('[VideoDecoder carousel]', e),
        });

        // Configure the decoder from the source's REAL codec/dimensions/avcC.
        // Hardcoding avc1.64001F / 1080×1920 fails on sources with a different
        // H.264 profile/level or resolution ("a key frame is required after
        // configure()… fill out the description field"). mediabunny parses it
        // correctly; fall back to the hand-rolled MP4Box extraction if it fails.
        let videoDecoderConfig: any = null;
        try {
          const vInput = new Input({ source: new BlobSource(new Blob([arrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
          const vTrack = await vInput.getPrimaryVideoTrack();
          if (vTrack) videoDecoderConfig = await vTrack.getDecoderConfig();
        } catch (cfgErr) { console.warn('[VideoDecoder carousel] mediabunny config failed, falling back to MP4Box:', cfgErr); }

        if (!videoDecoderConfig) {
          let description: Uint8Array | undefined;
          // @ts-ignore
          if (typeof MP4BoxFile.getSampleDescription === 'function') {
            // @ts-ignore
            const descs = MP4BoxFile.getSampleDescription(videoTrackId);
            // @ts-ignore
            if (descs?.[0]) description = descs[0].avcC?.config || descs[0].avcC;
          }
          if (!description) {
            try {
              // @ts-ignore
              const stsd = MP4BoxFile.getTrackById(videoTrackId)?.mdia?.minf?.stbl?.stsd;
              const entry = stsd?.entries?.[0];
              if (entry?.avcC?.config?.length > 0) description = new Uint8Array(entry.avcC.config);
              else if (typeof entry?.avcC?.subarray === 'function') description = entry.avcC.subarray();
              else if (typeof entry?.avcC?.start !== 'undefined' && entry?.avcC?.size) description = new Uint8Array(arrayBuffer, entry.avcC.start + 8, entry.avcC.size - 8);
            } catch { /* ignore */ }
          }
          videoDecoderConfig = { codec: 'avc1.64001F', codedWidth: 1080, codedHeight: 1920, description };
        }

        // @ts-ignore
        decoder.configure(videoDecoderConfig);

        for (let i = 0; i < videoSamples.length; i++) {
          if (signal.aborted) { decoder.close(); throw new Error('Cancelled'); }
          const vs = videoSamples[i];
          // @ts-ignore
          await decoder.decode(new EncodedVideoChunk({ type: vs.isKeyframe ? 'key' : 'delta', timestamp: vs.timestamp * 1_000_000, data: vs.data }));
          emit(0.1 + (i / videoSamples.length) * 0.2, 'Decoding video...');
        }
        await decoder.flush();
        decoder.close();

        emit(0.3, 'Preparing output...');

        const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
        const videoSource = new VideoSampleSource({ codec: 'avc', bitrate: QUALITY_HIGH });
        output.addVideoTrack(videoSource);

        let audioSource: any = null;
        let audioPackets: any[] = [];
        let audioDecoderConfigForExport: any = null;

        if (audioSamples.length > 0 && !mutedRef.current) {
          try {
            const input = new Input({ source: new BlobSource(new Blob([arrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
            const audioTrack = await input.getPrimaryAudioTrack();
            if (audioTrack) {
              audioDecoderConfigForExport = await audioTrack.getDecoderConfig();
              audioSource = new EncodedAudioPacketSource('aac');
              output.addAudioTrack(audioSource);
              const sink = new EncodedPacketSink(audioTrack);
              for await (const packet of sink.packets()) audioPackets.push(packet);
              const firstTs = audioPackets[0]?.timestamp || 0;
              for (const p of audioPackets) p.timestamp -= firstTs;
              audioPackets = audioPackets.filter((p: any) => p.timestamp >= clipStart && p.timestamp < clipEnd);
              if (audioPackets.length > 0) {
                const firstTrim = audioPackets[0].timestamp;
                for (const p of audioPackets) p.timestamp -= firstTrim;
              }
            }
          } catch (e) { console.error('[carousel audio]', e); }
        }

        emit(0.35, 'Rendering frames...');
        await output.start();

        const offscreen = new OffscreenCanvas(W, H);

        for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
          if (signal.aborted) { await output.finalize(); throw new Error('Cancelled'); }

          const targetTs = frameIdx * EXPORT_FRAME_DURATION + clipStart;
          let sourceFrame = decodedFrames[0];
          for (const f of decodedFrames) {
            if (f.timestamp <= targetTs) sourceFrame = f;
            else break;
          }

          const vw = sourceFrame.frame.displayWidth;
          const vh = sourceFrame.frame.displayHeight;
          drawCanvas(
            null,
            imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current,
            settingsRef.current,
            offscreen,
            { source: sourceFrame.frame, vw, vh },
          );

          // Output timeline is 0-based (the audio above was shifted to start at 0
          // after trimming). targetTs is SOURCE time (clipStart-based) used only to
          // pick the right source frame — the written sample must start at 0 so the
          // trimmed video and audio stay in sync.
          const sample = new VideoSample(offscreen, { timestamp: targetTs - clipStart, duration: EXPORT_FRAME_DURATION });
          await videoSource.add(sample);
          sample.close();
          emit(0.35 + (frameIdx / totalFrames) * 0.55, `Rendering frame ${frameIdx + 1}/${totalFrames}`);
        }

        for (const { frame } of decodedFrames) frame.close();

        if (audioSource && audioPackets.length > 0) {
          for (let i = 0; i < audioPackets.length; i++) {
            await audioSource.add(audioPackets[i], i === 0 ? { decoderConfig: audioDecoderConfigForExport } : undefined);
          }
        }

        emit(0.95, 'Finalizing...');
        await output.finalize();

        const buffer = output.target.buffer;
        if (!buffer) throw new Error('No buffer received from output');

        const blob = new Blob([buffer], { type: 'video/mp4' });
        const status = await sendToPhonedeck(blob, `carousel-${Date.now()}.mp4`);
        setVideoExportStatus(status);
        setTimeout(() => setVideoExportStatus(''), 5000);

        emit(1, 'Done!');

      } catch (error) {
        if (error instanceof Error && error.message !== 'Cancelled') {
          console.error('[carousel video export]', error);
          setVideoExportStatus(`Error: ${error.message}`);
          onRecordingStateChangeRef.current?.({ isRecording: false, recProgress: 0, recStatus: `Error: ${error.message}` });
          setTimeout(() => setVideoExportStatus(''), 3000);
        }
      } finally {
        setIsVideoExporting(false);
        setVideoExportProgress(0);
        setVideoExportStatus('');
        onRecordingStateChangeRef.current?.({ isRecording: false, recProgress: 0, recStatus: '' });
        videoExportAbortRef.current = null;
      }
    }
    startVideoExportRef.current = startVideoExport;

    useImperativeHandle(ref, () => ({
      async startDownload() {
        if (chartVideoModeRef.current) {
          await startChartVideoExportRef.current();
          return;
        }
        if (videoModeRef.current) {
          await startVideoExportRef.current();
          return;
        }
        const EXPORT_SCALE = 4;
        const hiCanvas = document.createElement('canvas');
        hiCanvas.width = W * EXPORT_SCALE;
        hiCanvas.height = H * EXPORT_SCALE;
        // Pause animation loop for stable frame capture in video mode
        if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
        drawCanvas(
          cachedImgRef.current,
          imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current,
          settingsRef.current,
          hiCanvas,
        );
        await new Promise(r => setTimeout(r, 30));
        hiCanvas.toBlob(async blob => {
          if (!blob) return;
          const status = await sendToPhonedeck(blob, `carousel-${Date.now()}.png`);
          setVideoExportStatus(status);
          setTimeout(() => setVideoExportStatus(''), 5000);
        }, 'image/png');
      },
      zoomIn() {
        const n = Math.min(8, imgScaleRef.current * 1.25);
        imgScaleRef.current = n; setImgScale(n); onScaleChange?.(n); redraw(cachedImgRef.current);
      },
      zoomOut() {
        const n = Math.max(0.2, imgScaleRef.current / 1.25);
        imgScaleRef.current = n; setImgScale(n); onScaleChange?.(n); redraw(cachedImgRef.current);
      },
      setZoom(s: number) {
        const n = Math.max(0.2, Math.min(8, s));
        imgScaleRef.current = n; setImgScale(n); onScaleChange?.(n); redraw(cachedImgRef.current);
      },
      resetTransform() {
        imgOffsetRef.current  = { x: 0, y: 0 };
        imgScaleRef.current   = 1; setImgScale(1); onScaleChange?.(1);
        imgSrcCropRef.current = null;
        redraw(cachedImgRef.current);
      },
      cancelExport() { videoExportAbortRef.current?.abort(); },
      enterCropMode() { startCropMode(); },
      toggleSplit() { runBgRemovalRef.current('split'); },
      toggleBlur()  { runBgRemovalRef.current('blur');  },
      play()  { const v = videoRef.current; if (v) { v.muted = mutedRef.current; v.play(); } },
      pause() { videoRef.current?.pause(); },
      seekTo(t: number) { if (videoRef.current) videoRef.current.currentTime = t; },
      setMuted(m: boolean) { mutedRef.current = m; if (videoRef.current) videoRef.current.muted = m; },
      setTrimRange(start: number, end: number) {
        trimStartRef.current = start;
        trimEndRef.current   = end;
      },
      resetTrim() {
        trimStartRef.current = 0;
        trimEndRef.current   = Infinity;
      },
      resetBox() {
        imgOffsetRef.current = { x: 0, y: 0 };
        imgScaleRef.current  = 1; setImgScale(1); onScaleChange?.(1);
        redraw(null);
      },
      centerBox() {
        imgOffsetRef.current = { x: 0, y: 0 };
        redraw(null);
      },
      getVideoElement() { return videoRef.current; },
      getTrimState() {
        const dur = videoRef.current?.duration ?? 0;
        return {
          trimStart: trimStartRef.current,
          trimEnd:   trimEndRef.current === Infinity ? dur : trimEndRef.current,
          duration:  dur,
          muted:     mutedRef.current,
        };
      },
    }), [redraw, onScaleChange, drawCanvas]);

    function startCropMode() {
      const img = cachedImgRef.current;
      if (!img) return;
      const savedCrop = imgSrcCropRef.current;

      // Save current state so Escape can restore it
      cropEntryStateRef.current = {
        crop: imgSrcCropRef.current,
        ox: imgOffsetRef.current.x,
        oy: imgOffsetRef.current.y,
        sc: imgScaleRef.current,
      };

      // Show full original image while in crop mode
      imgSrcCropRef.current = null;
      imgOffsetRef.current  = { x: 0, y: 0 };
      imgScaleRef.current   = 1;
      setImgScale(1);
      onScaleChange?.(1);
      redraw(img);

      // Position handles at the committed crop, or full canvas if none
      if (savedCrop) {
        const baseScale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        const renderX   = (W - img.naturalWidth  * baseScale) / 2;
        const renderY   = (H - img.naturalHeight * baseScale) / 2;
        const px  = Math.max(0, (renderX + savedCrop.sx * baseScale) * DISPLAY_SCALE);
        const py  = Math.max(0, (renderY + savedCrop.sy * baseScale) * DISPLAY_SCALE);
        const pw  = Math.min(CAROUSEL_PREVIEW_W - px, savedCrop.sw * baseScale * DISPLAY_SCALE);
        const ph  = Math.min(PREVIEW_H - py, savedCrop.sh * baseScale * DISPLAY_SCALE);
        const nr  = { x: px, y: py, w: Math.max(10, pw), h: Math.max(10, ph) };
        cropRectRef.current = nr;
        setCropRect(nr);
      } else {
        const full = { x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: PREVIEW_H };
        cropRectRef.current = full;
        setCropRect(full);
      }
      setIsCropMode(true);
    }

    function applyCrop() {
      const img = cachedImgRef.current;
      if (!img) { setIsCropMode(false); return; }

      const r = cropRectRef.current;
      const cx = r.x / DISPLAY_SCALE;  // canvas pixels
      const cy = r.y / DISPLAY_SCALE;
      const cw = r.w / DISPLAY_SCALE;
      const ch = r.h / DISPLAY_SCALE;

      // Current image source region (natural px)
      const prev = imgSrcCropRef.current;
      const srcX = prev?.sx ?? 0;
      const srcY = prev?.sy ?? 0;
      const srcW = prev?.sw ?? img.naturalWidth;
      const srcH = prev?.sh ?? img.naturalHeight;

      // Current draw parameters
      const imgOx      = imgOffsetRef.current.x;
      const imgOy      = imgOffsetRef.current.y;
      const imgSc      = imgScaleRef.current;
      const coverBase  = Math.max(W / srcW, H / srcH);
      const effScale   = coverBase * imgSc;   // canvas-px per source-px
      const renderW    = srcW * effScale;
      const renderH    = srcH * effScale;
      const renderX    = (W - renderW) / 2 + imgOx;
      const renderY    = (H - renderH) / 2 + imgOy;

      // Map canvas crop rect → source image natural coords
      const rawL = srcX + (cx      - renderX) / renderW * srcW;
      const rawT = srcY + (cy      - renderY) / renderH * srcH;
      const rawR = srcX + (cx + cw - renderX) / renderW * srcW;
      const rawB = srcY + (cy + ch - renderY) / renderH * srcH;

      // Clamp to current source bounds
      const newSx = Math.max(srcX,        rawL);
      const newSy = Math.max(srcY,        rawT);
      const newSw = Math.max(1, Math.min(srcX + srcW, rawR) - newSx);
      const newSh = Math.max(1, Math.min(srcY + srcH, rawB) - newSy);

      // Adjust imgScale/imgOffset so the visual stays exactly the same
      // after the source dimensions change from (srcW×srcH) to (newSw×newSh).
      // New coverBase uses the new source dims; imgSc is scaled to compensate.
      const newCoverBase = Math.max(W / newSw, H / newSh);
      const newImgSc     = effScale / newCoverBase;
      // Offset shifts because the "center of the draw" moves when source dims change
      const newImgOx     = imgOx + effScale * ((newSw - srcW) / 2 + (newSx - srcX));
      const newImgOy     = imgOy + effScale * ((newSh - srcH) / 2 + (newSy - srcY));

      imgSrcCropRef.current     = { sx: newSx, sy: newSy, sw: newSw, sh: newSh };
      imgScaleRef.current       = newImgSc;
      imgOffsetRef.current      = { x: newImgOx, y: newImgOy };
      cropEntryStateRef.current = null;
      setImgScale(newImgSc);
      onScaleChange?.(newImgSc);

      const full = { x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: PREVIEW_H };
      cropRectRef.current = full;
      setCropRect(full);
      setCropLock('free');
      redraw(cachedImgRef.current);
      setIsCropMode(false);
    }

    // Dynamic overlay positions — mirror the canvas logo positions exactly
    const padXPv      = Math.round((32 + settings.contentPadding * 0.64) * DISPLAY_SCALE);
    const slotFwPv    = CAROUSEL_PREVIEW_W - 2 * padXPv;
    const aboveHLTop  = Math.max(0, blockTopPv - LOGO_PH - settings.aboveLogoGap);
    const subSlotTop  = PREVIEW_H - LOGO_PH - padXPv;
    const slotPosArr: React.CSSProperties[] = [
      { top: padXPv,     left: padXPv },
      { top: aboveHLTop, left: padXPv },
      { top: subSlotTop, left: padXPv },
    ];
    // Slot visibility: inverted mode flips which slot is drag-only vs always-visible
    const hasBottomContent = !!(
      slots[2] ||
      settings.dividerSlots?.[2] ||
      settings.tagSlots?.[2] ||
      settings.quoteSlots?.[2] ||
      settings.tagZoneSlots?.slice(6).some(Boolean) ||
      settings.zoneLogoSlots?.slice(6).some(Boolean) ||
      settings.quoteZoneSlots?.slice(6).some(Boolean) ||
      settings.swipeZoneSlots?.slice(6).some(Boolean)
    );
    const hasTopContent = !!(
      slots[0] ||
      settings.dividerSlots?.[0] ||
      settings.tagSlots?.[0] ||
      settings.quoteSlots?.[0] ||
      settings.tagZoneSlots?.slice(0, 3).some(Boolean) ||
      settings.zoneLogoSlots?.slice(0, 3).some(Boolean) ||
      settings.quoteZoneSlots?.slice(0, 3).some(Boolean) ||
      settings.swipeZoneSlots?.slice(0, 3).some(Boolean)
    );
    const showTopSlotOverlay    = invertedSlots ? (isDraggingElement || hasTopContent) : true;
    const showMiddleSlotOverlay = !invertedSlots;
    const showBottomSlotOverlay = invertedSlots ? true : (isDraggingElement || hasBottomContent);
    const showSlotOverlay       = [showTopSlotOverlay, showMiddleSlotOverlay, showBottomSlotOverlay];

    const blurLayerActive = settings.bgBlurEnabled && !!fgMaskSrc;

    return (
      <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div
        ref={wrapperRef}
        style={{
          width: CAROUSEL_PREVIEW_W, height: PREVIEW_H,
          position: 'relative', flexShrink: 0, overflow: 'hidden',
          cursor: (imageSrc || videoSrc) ? (isDragging ? 'grabbing' : 'grab') : 'default',
        }}
        onMouseDown={e => {
          if (!imageSrc && !videoSrc) return;
          // While editing text, don't let a click on the photo pan the background —
          // the slide should stay put so you can work on the text.
          if (richEditTargetRef.current) return;
          if ((e.target as Element).closest('[data-carousel-slot]')) return;
          if ((e.target as Element).closest('[data-crop-handle]')) return;
          e.preventDefault();
          dragStartRef.current = { mx: e.clientX, my: e.clientY, ox: imgOffsetRef.current.x, oy: imgOffsetRef.current.y };
          setIsDragging(true);
        }}
      >
        {/* Layers panel — left of canvas, only in blur-layer mode */}
        {!staticMode && blurLayerActive && (
          <LayersPanel
            layers={settings.layerOrder ?? ['background', 'circle', 'circle2', 'subject']}
            onChange={layers => onSettingsChange?.({ layerOrder: layers })}
          />
        )}

        <canvas
          ref={canvasRef} width={W} height={H}
          style={{ width: CAROUSEL_PREVIEW_W, height: PREVIEW_H, display: 'block', pointerEvents: 'none' }}
        />

        {/* Hidden video element — only mounted in video mode for frame capture.
            Not autoplay/muted: playback is driven by the video controller so it
            plays WITH sound (a muted autoplay preview would always be silent). */}
        {videoSrc && (
          <video key={videoSrc} ref={videoRef} src={videoSrc}
            style={{ display: 'none' }} loop playsInline crossOrigin="anonymous"
            onLoadedData={() => redraw(null)}
          />
        )}

        {/* Interactive overlays — hidden in staticMode */}
        {!staticMode && <>

        {/* Logo placeholder slots — overlay-only, not part of the canvas bitmap */}
        {Array.from({ length: 3 }, (_, i) => {
          if (!showSlotOverlay[i]) return null;
          const isOpen     = openSlot === i;
          const alignRight = false;
          const inputId    = `logo-${instanceId}-${i}`;

          const slotStyle: React.CSSProperties = {
            position: 'absolute',
            width:    slotFwPv,
            height:   LOGO_PH,
            zIndex:   isOpen ? 50 : 2,
            ...slotPosArr[i],
          };

          return (
            <div
              key={i}
              ref={el => { slotContainerRefs.current[i] = el; }}
              style={slotStyle}
              data-carousel-slot=""
              onDragOver={e => {
                e.preventDefault();
                setDragOverSlot(i);
                const isDiv = e.dataTransfer.types.includes('application/carousel-element-type/divider');
                setIsDividerDrag(isDiv);
                if (!isDiv) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const t = rect.width / 3;
                  setDragOverZone(x < t ? 'left' : x < t * 2 ? 'center' : 'right');
                }
              }}
              onDragEnter={e => {
                e.preventDefault();
                setDragOverSlot(i);
                setIsDividerDrag(e.dataTransfer.types.includes('application/carousel-element-type/divider'));
              }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverSlot(null);
                  setDragOverZone(null);
                  setIsDividerDrag(false);
                }
              }}
              onDrop={e => {
                e.preventDefault();
                setDragOverSlot(null);
                setDragOverZone(null);
                setIsDividerDrag(false);
                try {
                  const d: SidebarElementData = JSON.parse(e.dataTransfer.getData('application/carousel-element'));
                  if (d.type === 'tag' && d.text && d.style) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const t = rect.width / 3;
                    const zone: 'left' | 'center' | 'right' = x < t ? 'left' : x < t * 2 ? 'center' : 'right';
                    selectTagZone(i, zone, d.text, d.style);
                  } else if (d.type === 'logo') {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const t = rect.width / 3;
                    const zone: 'left' | 'center' | 'right' = x < t ? 'left' : x < t * 2 ? 'center' : 'right';
                    selectBrandLogoZone(i, zone);
                  }
                  else if (d.type === 'quote' && d.id) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const t = rect.width / 3;
                    const zone: 'left' | 'center' | 'right' = x < t ? 'left' : x < t * 2 ? 'center' : 'right';
                    selectQuoteZone(i, zone, d.id);
                  } else if (d.type === 'swipe' && d.swipeStyle) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const t = rect.width / 3;
                    const zone: 'left' | 'center' | 'right' = x < t ? 'left' : x < t * 2 ? 'center' : 'right';
                    selectSwipeZone(i, zone, d.swipeStyle);
                  }
                  else if (d.type === 'divider' && d.id) {
                    // Clear ALL slot content — divider overrides everything
                    const imgSlot = slotsRef.current[i];
                    if (imgSlot?.type === 'image') URL.revokeObjectURL(imgSlot.url);
                    logoImgsRef.current[i] = null;
                    subImgRefsArr.current[i] = null;
                    const nextSlots = [...slotsRef.current] as (SlotContent | null)[];
                    nextSlots[i] = null;
                    slotsRef.current = nextSlots;
                    setSlots(nextSlots);
                    const cur       = [...(settingsRef.current.dividerSlots   ?? Array(3).fill(null))];
                    const curSub    = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
                    const curTag    = [...(settingsRef.current.tagSlots        ?? Array(6).fill(null))];
                    const curQuo    = [...(settingsRef.current.quoteSlots      ?? Array(6).fill(null))];
                    const curLogoRow = [...(settingsRef.current.logoRowSlots   ?? Array(3).fill(null))];
                    cur[i] = d.id; curSub[i] = null; curTag[i] = null; curQuo[i] = null; curLogoRow[i] = null;
                    settingsRef.current = { ...settingsRef.current, dividerSlots: cur, dividerSubSlots: curSub, tagSlots: curTag, quoteSlots: curQuo, logoRowSlots: curLogoRow };
                    onSettingsChange?.({ dividerSlots: cur, dividerSubSlots: curSub, tagSlots: curTag, quoteSlots: curQuo, logoRowSlots: curLogoRow });
                  }
                  onSlotDrop?.(i, d);
                } catch {}
              }}
            >
              {/* File input — always in DOM */}
              <input
                id={inputId}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { handleLogoFile(i, e); setOpenSlot(null); }}
              />

              {/* Divider drag overlay — covers any existing content, always on top */}
              {dragOverSlot === i && isDividerDrag && (
                <div className="absolute inset-0 rounded ring-2 ring-inset ring-white/70 bg-white/10 animate-pulse pointer-events-none z-20" />
              )}

              {/* Slot content — divider takes full row; uploaded image takes full row; otherwise per-zone independent cells */}
              {(() => {
                const imgSlot     = slots[i];
                const dividerSlot = settings.dividerSlots?.[i] ?? null;

                const RemoveBtn = ({ onRemove }: { onRemove: () => void }) => (
                  <button onClick={onRemove}
                    className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-black/80 border border-zinc-600 text-zinc-300 text-[9px] flex items-center justify-center hover:bg-red-900/90 hover:border-red-600 transition-colors leading-none z-10"
                  >×</button>
                );

                // Divider — occupies the entire row
                if (dividerSlot) {
                  const cbounds = getSubZoneCanvasBounds(dividerSlot, 0, 0, slotFwPv / DISPLAY_SCALE, LOGO_PH / DISPLAY_SCALE);
                  const szB = cbounds ? {
                    x: Math.round(cbounds.x * DISPLAY_SCALE),
                    y: Math.round(cbounds.y * DISPLAY_SCALE),
                    w: Math.round(cbounds.w * DISPLAY_SCALE),
                    h: Math.round(cbounds.h * DISPLAY_SCALE),
                  } : null;
                  const subContent  = settings.dividerSubSlots?.[i] ?? null;
                  const isSubFilled = !!subContent || subSlotFilled[i];
                  const isSubOpen   = openSubSlot === i;
                  const subInputId = `logo-sub-${instanceId}-${i}`;
                  return (
                    <div className="relative w-full h-full overflow-visible">
                      <RemoveBtn onRemove={() => {
                        const cur = [...(settingsRef.current.dividerSlots ?? Array(3).fill(null))];
                        cur[i] = null;
                        const curSub = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
                        curSub[i] = null;
                        onSettingsChange?.({ dividerSlots: cur, dividerSubSlots: curSub });
                      }} />
                      <input id={subInputId} type="file" accept="image/*" className="hidden"
                        onChange={e => { handleSubSlotFile(i, e); setOpenSubSlot(null); }} />
                      {szB && (
                        <button
                          ref={el => { subSlotBtnRefs.current[i] = el; }}
                          onClick={() => {
                            setOpenSlot(null);
                            setShowSubCustom(false);
                            if (openSubSlot === i) {
                              setOpenSubSlot(null);
                              setSubDropdownPos(null);
                            } else {
                              const btn = subSlotBtnRefs.current[i];
                              if (btn) {
                                const r = btn.getBoundingClientRect();
                                setSubDropdownPos({ x: r.left, y: r.bottom + 4 });
                              }
                              setOpenSubSlot(i);
                            }
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setSubDragOverSlot(i); }}
                          onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setSubDragOverSlot(i); }}
                          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSubDragOverSlot(null); }}
                          onDrop={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSubDragOverSlot(null);
                            try {
                              const d: SidebarElementData = JSON.parse(e.dataTransfer.getData('application/carousel-element'));
                              if (d.type === 'tag' && d.text && d.style) selectSubTag(i, d.text, d.style);
                              else if (d.type === 'logo') selectSubBrandLogo(i);
                              else if (d.type === 'swipe' && d.swipeStyle) selectSubSwipe(i, d.swipeStyle);
                            } catch {}
                          }}
                          style={{ position: 'absolute', left: szB.x, top: szB.y, width: szB.w, height: szB.h }}
                          className={`rounded transition-all ${
                            subDragOverSlot === i
                              ? 'ring-2 ring-inset ring-white/70 bg-white/15'
                              : isSubOpen
                              ? 'ring-2 ring-inset ring-white/60 bg-white/10'
                              : isSubFilled
                              ? 'hover:ring-1 hover:ring-inset hover:ring-white/35 hover:bg-white/8'
                              : 'ring-1 ring-inset ring-dashed ring-white/25 hover:ring-white/50 hover:bg-white/10'
                          }`}
                        />
                      )}
                    </div>
                  );
                }

                // Uploaded image — occupies the entire row
                if (imgSlot) {
                  const OBJ_POS    = ['top left','top center','top right','bottom left','bottom center','bottom right'] as const;
                  const FLEX_ALIGN = ['flex-start','center','flex-end','flex-start','center','flex-end'] as const;
                  const FLEX_JUST  = ['flex-start','center','flex-end','flex-start','center','flex-end'] as const;
                  return (
                    <div
                      className="relative w-full h-full flex"
                      style={{ alignItems: FLEX_ALIGN[i % 3], justifyContent: FLEX_JUST[i % 3], flexDirection: i < 3 ? 'column' : 'column-reverse' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgSlot.url} alt="" className="w-full h-full object-contain" style={{ objectPosition: OBJ_POS[i], opacity: (settings.logoOpacity ?? 100) / 100 }} />
                      <button
                        onClick={() => removeSlot(i)}
                        className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-black/80 border border-zinc-600 text-zinc-300 text-[9px] flex items-center justify-center hover:bg-red-900/90 hover:border-red-600 transition-colors leading-none z-10"
                      >×</button>
                    </div>
                  );
                }

                // Per-zone independent cells — each zone can hold a tag, logo, or quote independently
                return (
                  <>
                    <div className="absolute inset-0 flex gap-px">
                      {ZONES.map((zone, zi) => {
                        const fi          = i * 3 + zi;
                        const zoneTag     = settings.tagZoneSlots?.[fi]   ?? null;
                        const zoneLogo    = settings.zoneLogoSlots?.[fi]  ?? false;
                        const zoneQuote   = settings.quoteZoneSlots?.[fi] ?? null;
                        // Legacy slots — shown in the zone that matches their saved alignment
                        const legTagAlign  = (settings.tagSlotAligns?.[i]  ?? 'center') as 'left'|'center'|'right';
                        const legLogoAlign = (settings.logoSlotAligns?.[i] ?? 'center') as 'left'|'center'|'right';
                        const legTag       = settings.tagSlots?.[i]   ?? null;
                        const legQuote     = settings.quoteSlots?.[i]  ?? null;
                        const hasLegTag    = !!legTag   && legTagAlign  === zone;
                        const hasLegLogo   = !!(settingsRef.current.logoSlotAligns?.[i]) && legLogoAlign === zone && logoImgsRef.current[i] != null;
                        const hasLegQuote  = !!legQuote && legLogoAlign === zone;
                        const zoneSwipe    = settings.swipeZoneSlots?.[fi] ?? null;
                        const hasFilled    = !!zoneTag || zoneLogo || !!zoneQuote || !!zoneSwipe || hasLegTag || hasLegLogo || hasLegQuote;

                        if (hasFilled) {
                          return (
                            <div key={zone} className="relative flex-1 h-full">
                              <button
                                onClick={() => {
                                  if (zoneTag || zoneLogo || zoneQuote || zoneSwipe) removeZoneSlot(i, zone);
                                  else removeSlot(i);
                                }}
                                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/80 border border-zinc-600 text-zinc-300 text-[9px] flex items-center justify-center hover:bg-red-900/90 hover:border-red-600 transition-colors leading-none z-10"
                              >×</button>
                            </div>
                          );
                        }

                        return (
                          <button
                            key={zone}
                            onClick={() => {
                              pendingSlotZoneRef.current = zone;
                              if (openSlot === i) {
                                setOpenSlot(null);
                                setSlotDropdownPos(null);
                              } else {
                                const container = slotContainerRefs.current[i];
                                if (container) {
                                  const r = container.getBoundingClientRect();
                                  setSlotDropdownPos({ x: r.left, y: r.bottom + 4 });
                                }
                                setOpenSlot(i);
                              }
                            }}
                            className={`flex-1 h-full rounded-sm transition-colors ${
                              dragOverSlot === i && !isDividerDrag && dragOverZone === zone
                                ? 'bg-white/25 ring-2 ring-inset ring-white/60'
                                : dragOverSlot === i && !isDividerDrag
                                ? 'bg-white/8 ring-1 ring-inset ring-white/20'
                                : isDraggingElement
                                ? 'bg-white/5 ring-1 ring-inset ring-white/15 pointer-events-none'
                                : 'hover:bg-white/8 hover:ring-1 hover:ring-inset hover:ring-white/20'
                            }`}
                          />
                        );
                      })}
                    </div>

                  </>
                );
              })()}
            </div>
          );
        })}

        {/* ── Rich text edit overlays ── */}
        {(() => {
          const headFontDef_ = CAROUSEL_FONTS.find(f => f.label === settings.fontLabel)    ?? CAROUSEL_FONTS[0];
          const subFontDef_  = CAROUSEL_FONTS.find(f => f.label === settings.subFontLabel) ?? CAROUSEL_FONTS[0];
          const richW     = CAROUSEL_PREVIEW_W - 2 * padXPv;
          const headFsPv  = Math.round(settings.fontSize    * DISPLAY_SCALE);
          const subFsPv   = Math.round(settings.subFontSize * DISPLAY_SCALE);
          const headLhM   = 1.0 + (settings.lHeight    / 100) * 1.2;
          const subLhM    = 1.0 + (settings.subLHeight / 100) * 1.2;
          const headLsPv  = ((settings.lSpacing    / 100) * 20 * DISPLAY_SCALE).toFixed(2);
          const subLsPv   = ((settings.subLSpacing / 100) * 20 * DISPLAY_SCALE).toFixed(2);
          const headTopPv = blockTopPv;
          const subTopPv  = blockTopPv + headBlockHPv + gapPv;

          function saveSpans(el: HTMLElement, isHead: boolean) {
            const spans = htmlToSpans(el);
            const newText = spans.map(s => s.text).join('');
            const hasCustomStyle = spans.some(s => s.color || s.bold || s.italic);
            onSettingsChange?.(isHead
              ? { headlineSpans: hasCustomStyle ? spans : null }
              : { subSpans:      hasCustomStyle ? spans : null });
            if (isHead && newText !== headline)    onHeadlineChange?.(newText);
            if (!isHead && newText !== subheadline) onSubheadlineChange?.(newText);
          }

          const editStyle = (top: number, fs: number, fontFamily: string, fw: number | string, fi: boolean, lh: number, ls: string, align: CarouselTextAlign, minH: number): React.CSSProperties => ({
            position:     'absolute',
            top,
            left:         padXPv,
            width:        richW,
            minHeight:    Math.max(minH, headFsPv),
            fontSize:     fs,
            fontFamily,
            fontWeight:   fw,
            fontStyle:    fi ? 'italic' : 'normal',
            color:        '#ffffff',
            lineHeight:   lh,
            letterSpacing: `${ls}px`,
            textAlign:    align === 'justify' ? 'left' : align,
            background:   'rgba(255,255,255,0.05)',
            outline:      '1px dashed rgba(255,255,255,0.35)',
            outlineOffset: '3px',
            borderRadius: 2,
            whiteSpace:   'pre-wrap',
            wordBreak:    'break-word',
            caretColor:   '#fff',
            zIndex:       10,
            boxSizing:    'border-box',
            padding:      0,
          });

          return (
            <>
              {/* Click targets for entering rich text mode */}
              {!richEditTarget && headline.trim() && headBlockHPv > 0 && (
                <div
                  data-carousel-slot=""
                  title="Click to style text"
                  onClick={() => setRichEditTarget('headline')}
                  style={{
                    position: 'absolute',
                    top: headTopPv, left: padXPv,
                    width: richW, height: headBlockHPv,
                    cursor: 'text', zIndex: 4,
                  }}
                />
              )}
              {!richEditTarget && subheadline.trim() && subBlockHPv > 0 && (
                <div
                  data-carousel-slot=""
                  title="Click to style text"
                  onClick={() => setRichEditTarget('sub')}
                  style={{
                    position: 'absolute',
                    top: subTopPv, left: padXPv,
                    width: richW, height: subBlockHPv,
                    cursor: 'text', zIndex: 4,
                  }}
                />
              )}

              {/* ContentEditable for headline */}
              {richEditTarget === 'headline' && (
                <div
                  ref={richEditRef}
                  key="rich-head"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  data-carousel-slot=""
                  style={editStyle(headTopPv, headFsPv, headFontDef_.css, settings.fontWeight, settings.italic, headLhM, headLsPv, settings.textAlign, headBlockHPv)}
                  onBlur={e => { saveSpans(e.currentTarget, true); setRichEditTarget(null); }}
                  onKeyDown={e => { if (e.key === 'Escape') setRichEditTarget(null); }}
                />
              )}

              {/* ContentEditable for subheadline */}
              {richEditTarget === 'sub' && (
                <div
                  ref={richEditRef}
                  key="rich-sub"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  data-carousel-slot=""
                  style={editStyle(subTopPv, subFsPv, subFontDef_.css, settings.subFontWeight, settings.subItalic, subLhM, subLsPv, settings.subTextAlign, subBlockHPv)}
                  onBlur={e => { saveSpans(e.currentTarget, false); setRichEditTarget(null); }}
                  onKeyDown={e => { if (e.key === 'Escape') setRichEditTarget(null); }}
                />
              )}

              {/* Floating toolbar — shows when text is selected in contentEditable */}
              {toolbarPos && richEditTarget && (
                <div
                  data-carousel-slot=""
                  onMouseDown={e => e.preventDefault()}
                  style={{
                    position:     'absolute',
                    top:          Math.max(4, toolbarPos.top),
                    left:         toolbarPos.left,
                    zIndex:       20,
                    display:      'flex',
                    alignItems:   'center',
                    gap:          3,
                    padding:      '5px 7px',
                    background:   'rgba(18,18,18,0.96)',
                    border:       '1px solid rgba(255,255,255,0.14)',
                    borderRadius: 9,
                    backdropFilter: 'blur(10px)',
                    boxShadow:    '0 4px 14px rgba(0,0,0,0.55)',
                  }}
                >
                  {/* Colour swatches */}
                  {RICH_COLORS.map(c => (
                    <button
                      key={c}
                      onMouseDown={e => { e.preventDefault(); document.execCommand('foreColor', false, c); }}
                      style={{
                        width: 13, height: 13, borderRadius: '50%',
                        background: c, border: '1px solid rgba(255,255,255,0.25)',
                        cursor: 'pointer', flexShrink: 0, padding: 0,
                      }}
                      title={c}
                    />
                  ))}
                  {/* Custom colour */}
                  <label
                    style={{ position: 'relative', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }}
                    title="Custom colour"
                    onMouseDown={() => {
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0 && richEditRef.current?.contains(sel.anchorNode)) {
                        savedSelRef.current = sel.getRangeAt(0).cloneRange();
                      }
                    }}
                  >
                    <div style={{
                      width: 13, height: 13, borderRadius: '50%',
                      background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      pointerEvents: 'none',
                    }} />
                    <input
                      type="color"
                      style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                      onChange={e => {
                        const hex = (e.target as HTMLInputElement).value;
                        const savedRange = savedSelRef.current;
                        savedSelRef.current = null;
                        if (!richEditRef.current || !savedRange) return;
                        richEditRef.current.focus();
                        setTimeout(() => {
                          const sel = window.getSelection();
                          sel?.removeAllRanges();
                          sel?.addRange(savedRange);
                          document.execCommand('foreColor', false, hex);
                        }, 0);
                      }}
                    />
                  </label>

                  {/* Separator */}
                  <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.18)', margin: '0 2px' }} />

                  {/* Bold */}
                  <button
                    onMouseDown={e => { e.preventDefault(); document.execCommand('bold'); }}
                    style={{ width: 22, height: 22, background: 'none', border: 'none', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', borderRadius: 4, padding: 0 }}
                    title="Bold"
                  >B</button>

                  {/* Italic */}
                  <button
                    onMouseDown={e => { e.preventDefault(); document.execCommand('italic'); }}
                    style={{ width: 22, height: 22, background: 'none', border: 'none', color: '#fff', fontStyle: 'italic', fontSize: 12, cursor: 'pointer', borderRadius: 4, padding: 0 }}
                    title="Italic"
                  >I</button>

                  {/* Separator */}
                  <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.18)', margin: '0 2px' }} />

                  {/* Clear formatting */}
                  <button
                    onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat'); }}
                    style={{ width: 22, height: 22, background: 'none', border: 'none', color: '#a1a1aa', fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: 0 }}
                    title="Clear formatting"
                  >✕</button>
                </div>
              )}
            </>
          );
        })()}

        {/* ── Circle placeholder (rectMode) — sits between top-3 and bottom-3 tag slots ── */}
        {/* ── Circle placeholders — hidden in video mode and for a chart background ── */}
        {!videoSrc && !chartBg && (rectMode ? [0] : [0, 1]).map(ci => {
          const RECT_GAP    = 8;
          const _bandTop    = padXPv + LOGO_PH + RECT_GAP;
          const _bandBottom = aboveHLTop - RECT_GAP;
          const _bandH      = Math.max(0, _bandBottom - _bandTop);
          if (rectMode) {
            // Keep band ref in sync for canvas drawRect
            rectBandRef.current = { top: _bandTop, bottom: _bandBottom, left: padXPv, right: CAROUSEL_PREVIEW_W - padXPv };
          }
          const circleSrc       = circleSrcs[ci];
          // No on-canvas placeholder: the circle only appears once an image has been
          // uploaded/pasted from its settings section. Nothing to drop into otherwise.
          if (!circleSrc) return null;
          const circlePos       = circlePoses[ci];
          const circleRadius    = circleRadii[ci];
          const circleElRef     = ci === 0 ? circleEl0Ref : circleEl1Ref;
          const editMode        = circleImgEditModes[ci];
          const isImgDragging   = activeImgDragCircle === ci;
          const defaultX        = rectMode ? Math.round(CAROUSEL_PREVIEW_W / 2 + 50) : (ci === 0 ? Math.round(CAROUSEL_PREVIEW_W / 4) : Math.round(CAROUSEL_PREVIEW_W * 3 / 4));
          const defaultCy       = rectMode ? Math.round((_bandTop + _bandBottom) / 2) : (padXPv + LOGO_PH + aboveHLTop) / 2;
          // When the background-blur layer is active, the canvas draws an
          // un-positioned circle at the canvas vertical center (H/2), NOT the
          // upper slot midpoint the overlay uses elsewhere. Match that here so the
          // dashed drag outline lines up with the drawn circle before it's moved.
          const defaultCyForMode = (blurLayerActive && !rectMode) ? Math.round(PREVIEW_H / 2) : defaultCy;
          const circleCxPv      = circlePos?.x ?? defaultX;
          const circleCyPv      = circlePos?.y ?? defaultCyForMode;
          const r               = circleRadius;
          const d               = r * 2;
          const bw              = ci === 0 ? settings.circleBorderWidth   : settings.circle2BorderWidth;
          const bo              = ci === 0 ? settings.circleBorderOpacity : settings.circle2BorderOpacity;
          const bc              = ci === 0 ? settings.circleBorderColor   : settings.circle2BorderColor;
          const cssBW           = Math.max(1, Math.round(bw * DISPLAY_SCALE));
          const boxShadowVal    = (!blurLayerActive && circleSrc && bw > 0 && bo > 0)
            ? `0 0 0 ${cssBW}px ${hexToRgba(bc, bo / 100)}`
            : '';
          const handleOffset    = r * 0.707;
          return (
            <React.Fragment key={ci}>
              {/* Circle element */}
              <div
                ref={circleElRef}
                data-carousel-slot=""
                onMouseDown={e => {
                  if (!circleSrc) return;
                  e.preventDefault();
                  if (editMode) {
                    circleImgDragStart.current = { mx: e.clientX, my: e.clientY, ox: circleImgOffsetsArr.current[ci].x, oy: circleImgOffsetsArr.current[ci].y };
                    setActiveImgDragCircle(ci);
                  } else {
                    const cx = circlePosRefsArr.current[ci]?.x ?? defaultX;
                    const cy = circlePosRefsArr.current[ci]?.y ?? defaultCy;
                    circleDragStart.current = { mx: e.clientX, my: e.clientY, cx, cy };
                    setActiveDragCircle(ci);
                  }
                }}
                style={{
                  position: 'absolute',
                  left: circleCxPv - r, top: circleCyPv - r,
                  width: d, height: d,
                  borderRadius: '50%',
                  zIndex: 3,
                  cursor: circleSrc ? (editMode ? (isImgDragging ? 'grabbing' : 'grab') : 'move') : 'default',
                  outline: circleSrc && (editMode || blurLayerActive) ? '2px dashed rgba(255,255,255,0.5)' : undefined,
                  outlineOffset: '3px',
                  ...(boxShadowVal ? { boxShadow: boxShadowVal } : {}),
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={circleSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '50%', pointerEvents: 'none', visibility: blurLayerActive ? 'hidden' : 'visible' }} />
                {!editMode && (
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => {
                      // Clearing routes through settings (the source of truth); the
                      // sync effect then empties circleSrcs and removes the circle.
                      onSettingsChange?.(ci === 0 ? { circleImageSrc: null } : { circle2ImageSrc: null });
                      circlePosRefsArr.current[ci]    = null;
                      setCirclePoses(prev => { const n = [...prev]; n[ci] = null; return n; });
                      circleRadsArr.current[ci]        = 90;
                      setCircleRadii(prev => { const n = [...prev]; n[ci] = 90; return n; });
                      circleImgOffsetsArr.current[ci]  = { x: 0, y: 0 };
                      circleImgScalesArr.current[ci]   = 1;
                    }}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 border border-zinc-600 text-zinc-300 text-[10px] flex items-center justify-center hover:bg-red-900/90 hover:border-red-600 transition-colors leading-none z-10"
                  >×</button>
                )}
              </div>

              {/* Edit / Done toolbar */}
              {circleSrc && (
                <div data-carousel-slot="" style={{ position: 'absolute', left: circleCxPv, top: circleCyPv + r + 5, transform: 'translateX(-50%)', display: 'flex', gap: 3, zIndex: 10 }}>
                  {editMode ? (
                    <button onMouseDown={e => e.stopPropagation()} onClick={() => setCircleImgEditModes(prev => { const n=[...prev]; n[ci]=false; return n; })}
                      style={{ padding: '2px 9px', background: '#fff', border: 'none', borderRadius: 4, color: '#000', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Done</button>
                  ) : (
                    <button onMouseDown={e => e.stopPropagation()} onClick={() => setCircleImgEditModes(prev => { const n=[...prev]; n[ci]=true; return n; })}
                      style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 4, color: 'rgba(255,255,255,0.8)', fontSize: 9, cursor: 'pointer' }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
                        <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
                      </svg>
                      Edit
                    </button>
                  )}
                </div>
              )}

              {/* Resize handle SE */}
              {circleSrc && !editMode && (
                <div data-carousel-slot="" onMouseDown={e => {
                  e.stopPropagation(); e.preventDefault();
                  const cx = circlePosRefsArr.current[ci]?.x ?? defaultX;
                  const cy = circlePosRefsArr.current[ci]?.y ?? defaultCy;
                  circleResizeStart.current = { cx, cy };
                  setActiveResizeCircle(ci);
                }} title="Drag to resize"
                  style={{ position: 'absolute', left: circleCxPv + handleOffset - 5, top: circleCyPv + handleOffset - 5, width: 10, height: 10, background: '#fff', border: '1.5px solid rgba(0,0,0,0.4)', borderRadius: 3, cursor: 'nwse-resize', zIndex: 10 }}
                />
              )}

              {/* Zoom handle SW */}
              {circleSrc && !editMode && (
                <div data-carousel-slot="" onMouseDown={e => {
                  e.stopPropagation(); e.preventDefault();
                  circleZoomDragStart.current = { my: e.clientY, scale: circleImgScalesArr.current[ci] };
                  setActiveZoomDragCircle(ci);
                }} title="Drag up to zoom in, down to zoom out"
                  style={{ position: 'absolute', left: circleCxPv - handleOffset - 5, top: circleCyPv + handleOffset - 5, width: 10, height: 10, background: '#a3e635', border: '1.5px solid rgba(0,0,0,0.4)', borderRadius: 3, cursor: 'ns-resize', zIndex: 10 }}
                />
              )}
            </React.Fragment>
          );
        })}

        {/* ── Crop overlay canvas (drawn on top of main canvas) ── */}
        <canvas
          ref={cropOverlayRef}
          width={CAROUSEL_PREVIEW_W}
          height={PREVIEW_H}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4, display: isCropMode ? 'block' : 'none' }}
        />

        {/* ── Crop handles ── */}
        {isCropMode && (() => {
          const HS = 8;
          const { x, y, w, h } = cropRect;
          const handles = [
            { id: 'nw', cx: x,     cy: y,     cur: 'nwse-resize' },
            { id: 'n',  cx: x+w/2, cy: y,     cur: 'ns-resize'   },
            { id: 'ne', cx: x+w,   cy: y,     cur: 'nesw-resize'  },
            { id: 'e',  cx: x+w,   cy: y+h/2, cur: 'ew-resize'    },
            { id: 'se', cx: x+w,   cy: y+h,   cur: 'nwse-resize'  },
            { id: 's',  cx: x+w/2, cy: y+h,   cur: 'ns-resize'    },
            { id: 'sw', cx: x,     cy: y+h,   cur: 'nesw-resize'  },
            { id: 'w',  cx: x,     cy: y+h/2, cur: 'ew-resize'    },
          ];
          return handles.map(hd => (
            <div
              key={hd.id}
              data-crop-handle=""
              onMouseDown={e => {
                e.stopPropagation(); e.preventDefault();
                cropActiveHandle.current = hd.id;
                cropDragStart.current = { mx: e.clientX, my: e.clientY, rect: { ...cropRectRef.current } };
              }}
              style={{
                position: 'absolute',
                left: hd.cx - HS / 2,
                top:  hd.cy - HS / 2,
                width: HS, height: HS,
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.35)',
                borderRadius: 2,
                cursor: hd.cur,
                zIndex: 15,
              }}
            />
          ));
        })()}

        {/* ── Crop toolbar ── */}
        {isCropMode && (
          <div
            data-crop-handle=""
            style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5, zIndex: 16 }}
          >
            {/* Frame-aspect snap + lock (4:5 on IG, 15:17 on X) */}
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                if (cropLock === '4:5') { setCropLock('free'); return; }
                const { x, y, w, h } = cropRectRef.current;
                const AR = W / H;
                let nx = x, ny = y, nw = w, nh = w / AR;
                if (nh > PREVIEW_H) { nh = h; nw = h * AR; nx = x + (w - nw) / 2; }
                else { ny = y + (h - nh) / 2; }
                const nr = { x: Math.round(Math.max(0, nx)), y: Math.round(Math.max(0, ny)), w: Math.round(nw), h: Math.round(nh) };
                cropRectRef.current = nr; setCropRect(nr); drawCropOverlay(nr);
                setCropLock('4:5');
              }}
              style={{
                padding: '3px 9px',
                background: cropLock === '4:5' ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.65)',
                border: '1px solid rgba(255,255,255,0.35)',
                borderRadius: 5,
                color: cropLock === '4:5' ? '#000' : 'rgba(255,255,255,0.85)',
                fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3,
              }}
            >{platform === 'x' ? '15:17' : '4:5'}</button>
            {/* Reset */}
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                // Clear committed crop — full original image will show
                imgSrcCropRef.current = null;
                imgOffsetRef.current  = { x: 0, y: 0 };
                imgScaleRef.current   = 1;
                setImgScale(1);
                onScaleChange?.(1);
                redraw(cachedImgRef.current);
                const full = { x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: PREVIEW_H };
                cropRectRef.current = full; setCropRect(full); drawCropOverlay(full);
              }}
              style={{
                padding: '3px 9px', background: 'rgba(0,0,0,0.65)',
                border: '1px solid rgba(255,255,255,0.25)', borderRadius: 5,
                color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 500, cursor: 'pointer',
              }}
            >Reset</button>
            {/* Done */}
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => applyCrop()}
              style={{
                padding: '3px 12px', background: '#fff',
                border: 'none', borderRadius: 5,
                color: '#000', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >Done</button>
          </div>
        )}

        </>}

      </div>

      {!staticMode && <>

      {/* Quote picker modal */}
      {showQuotePicker !== null && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowQuotePicker(null); }}
        >
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-4" style={{ width: 380, maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-zinc-200">Choose a quote mark</span>
              <button onClick={() => setShowQuotePicker(null)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Single marks */}
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">Single</p>
            <div className="grid grid-cols-5 gap-1.5 mb-4">
              {QUOTE_STYLES.map(qs => (
                <button
                  key={qs.id}
                  onClick={() => { selectQuoteZone(showQuotePicker!, pendingSlotZoneRef.current, qs.id); setShowQuotePicker(null); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-500 hover:bg-zinc-800 transition-colors group"
                >
                  <svg viewBox={qs.viewBox.join(' ')} style={{ width: 30, height: 30, fill: '#ffffff' }}>
                    {qs.paths.map((d, pi) => <path key={pi} d={d} />)}
                  </svg>
                  <span className="text-[8px] text-zinc-500 group-hover:text-zinc-300 transition-colors text-center leading-tight">{qs.label}</span>
                </button>
              ))}
            </div>

            {/* Paired marks (open + close) */}
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">Paired open + close</p>
            <div className="grid grid-cols-5 gap-1.5">
              {QUOTE_STYLES_PAIRED.map(qs => {
                const [vbX, vbY, vbW, vbH] = qs.viewBox;
                const gapVB = vbW * 0.15;
                const closeTransform = `translate(${vbX + vbW + gapVB},${vbY}) rotate(180,${vbW / 2},${vbH / 2}) translate(${-vbX},${-vbY})`;
                return (
                  <button
                    key={qs.id}
                    onClick={() => { selectQuoteZone(showQuotePicker!, pendingSlotZoneRef.current, qs.id); setShowQuotePicker(null); }}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-500 hover:bg-zinc-800 transition-colors group"
                  >
                    <svg viewBox={`${vbX} ${vbY} ${vbW * 2 + gapVB} ${vbH}`} style={{ width: 52, height: 26, fill: '#ffffff' }}>
                      {/* Opening */}
                      <g>
                        {qs.paths.map((d, pi) => <path key={pi} d={d} />)}
                      </g>
                      {/* Closing (180° flip) */}
                      <g transform={closeTransform}>
                        {qs.paths.map((d, pi) => <path key={'c' + pi} d={d} />)}
                      </g>
                    </svg>
                    <span className="text-[8px] text-zinc-500 group-hover:text-zinc-300 transition-colors text-center leading-tight">{qs.label.replace(' ❝…❞', '')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Main slot dropdown — portalled to body so it is never clipped by canvas overflow */}
      {openSlot !== null && slotDropdownPos !== null && typeof document !== 'undefined' && createPortal(
        (() => {
          const si = openSlot;
          const slotInputId = `logo-${instanceId}-${si}`;
          return (
            <div
              data-slot-dropdown=""
              style={{ position: 'fixed', left: slotDropdownPos.x, top: slotDropdownPos.y, width: 220, zIndex: 9999 }}
              className="bg-zinc-950 border border-zinc-700 rounded-xl shadow-2xl py-1"
              onMouseDown={e => e.stopPropagation()}
            >
              {brandLogoSrc && (
                <button
                  onClick={() => { selectBrandLogoZone(si, pendingSlotZoneRef.current); setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={brandLogoSrc} alt="" className="w-5 h-5 object-contain rounded shrink-0" />
                  Brand Kit Logo
                </button>
              )}
              <label
                htmlFor={slotInputId}
                onClick={() => { setOpenSlot(null); setSlotDropdownPos(null); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload image…
              </label>
              <div className="border-t border-zinc-800 mt-1 pt-1">
                <span className="block px-3 py-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Tags</span>
                <div className="px-2 pb-1 flex flex-wrap gap-1">
                  {TAG_PRESETS.map(preset => {
                    const presetStyle = { ...defaultTagStyle(), ...preset.initStyle };
                    return (
                      <button
                        key={preset.id}
                        onClick={() => { selectTagZone(si, pendingSlotZoneRef.current, preset.label, presetStyle); setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); }}
                        style={{
                          backgroundColor: presetStyle.bgOpacity > 0 ? presetStyle.bgColor : 'transparent',
                          border: presetStyle.borderWidth > 0 ? `${presetStyle.borderWidth}px solid ${presetStyle.borderColor}` : '1px solid #52525b',
                          color: presetStyle.textColor,
                          borderRadius: presetStyle.cornerRadius,
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold transition-opacity hover:opacity-80"
                      >{preset.label}</button>
                    );
                  })}
                </div>
                {showCustom ? (
                  <div className="px-2 pb-2 flex gap-1.5">
                    <input
                      autoFocus type="text" value={customTagText}
                      onChange={e => setCustomTagText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && customTagText.trim()) {
                          selectTagZone(si, pendingSlotZoneRef.current, customTagText.trim(), defaultTagStyle());
                          setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); setCustomTagText('');
                        }
                        if (e.key === 'Escape') { setShowCustom(false); setCustomTagText(''); }
                      }}
                      placeholder="Tag text…"
                      className="flex-1 bg-zinc-800 border border-zinc-700 text-white text-xs rounded px-2 py-1 outline-none focus:border-zinc-500 min-w-0"
                    />
                    <button
                      onClick={() => {
                        if (!customTagText.trim()) return;
                        selectTagZone(si, pendingSlotZoneRef.current, customTagText.trim(), defaultTagStyle());
                        setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); setCustomTagText('');
                      }}
                      className="px-2 py-1 rounded bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors shrink-0"
                    >Add</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCustom(true)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Custom tag…
                  </button>
                )}
              </div>
              <div className="border-t border-zinc-800 mt-1 pt-1">
                <span className="block px-3 py-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Quotation</span>
                <button
                  onClick={() => { setShowQuotePicker(si); setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z"/>
                  </svg>
                  Add quote mark…
                </button>
              </div>
              <div className="border-t border-zinc-800 mt-1 pt-1">
                <span className="block px-3 py-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Swipe</span>
                {SWIPE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => { selectSwipeZone(si, pendingSlotZoneRef.current, preset.style); setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); }}
                    className="flex items-center w-full px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <div style={{ overflow: 'visible', width: '100%' }}>
                      <SwipePreviewMini style={preset.style} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })(),
        document.body
      )}

      {/* Sub-slot dropdown — portalled to body so it escapes all overflow/z-index constraints */}
      {openSubSlot !== null && subDropdownPos !== null && typeof document !== 'undefined' && createPortal(
        (() => {
          const si = openSubSlot;
          const subInputId = `logo-sub-${instanceId}-${si}`;
          const subContent = settings.dividerSubSlots?.[si] ?? null;
          return (
            <div
              style={{ position: 'fixed', left: subDropdownPos.x, top: subDropdownPos.y, minWidth: 196, zIndex: 9999 }}
              className="bg-zinc-950 border border-zinc-700 rounded-xl shadow-2xl py-1"
              onMouseDown={e => e.stopPropagation()}
            >
              {brandLogoSrc && (
                <button
                  onClick={() => { selectSubBrandLogo(si); setOpenSubSlot(null); setSubDropdownPos(null); setShowSubCustom(false); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={brandLogoSrc} alt="" className="w-5 h-5 object-contain rounded shrink-0" />
                  Brand Kit Logo
                </button>
              )}
              <label
                htmlFor={subInputId}
                onClick={() => { setOpenSubSlot(null); setSubDropdownPos(null); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload image…
              </label>
              <div className="border-t border-zinc-800 mt-1 pt-1">
                <span className="block px-3 py-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Tags</span>
                <div className="px-2 pb-1 flex flex-wrap gap-1">
                  {TAG_PRESETS.map(preset => {
                    const ps = { ...defaultTagStyle(), ...preset.initStyle };
                    return (
                      <button
                        key={preset.id}
                        onClick={() => { selectSubTag(si, preset.label, ps); setOpenSubSlot(null); setSubDropdownPos(null); setShowSubCustom(false); }}
                        style={{
                          backgroundColor: ps.bgOpacity > 0 ? ps.bgColor : 'transparent',
                          border: ps.borderWidth > 0 ? `${ps.borderWidth}px solid ${ps.borderColor}` : '1px solid #52525b',
                          color: ps.textColor,
                          borderRadius: ps.cornerRadius,
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold transition-opacity hover:opacity-80"
                      >{preset.label}</button>
                    );
                  })}
                </div>
                {showSubCustom ? (
                  <div className="px-2 pb-2 flex gap-1.5">
                    <input
                      autoFocus type="text" value={customTagText}
                      onChange={e => setCustomTagText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && customTagText.trim()) {
                          selectSubTag(si, customTagText.trim(), defaultTagStyle());
                          setOpenSubSlot(null); setSubDropdownPos(null); setShowSubCustom(false); setCustomTagText('');
                        }
                        if (e.key === 'Escape') { setShowSubCustom(false); setCustomTagText(''); }
                      }}
                      placeholder="Tag text…"
                      className="flex-1 bg-zinc-800 border border-zinc-700 text-white text-xs rounded px-2 py-1 outline-none focus:border-zinc-500 min-w-0"
                    />
                    <button
                      onClick={() => {
                        if (!customTagText.trim()) return;
                        selectSubTag(si, customTagText.trim(), defaultTagStyle());
                        setOpenSubSlot(null); setSubDropdownPos(null); setShowSubCustom(false); setCustomTagText('');
                      }}
                      className="px-2 py-1 rounded bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors shrink-0"
                    >Add</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSubCustom(true)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Custom tag…
                  </button>
                )}
              </div>
              {subContent && (
                <div className="border-t border-zinc-800 mt-1 pt-1">
                  <button
                    onClick={() => { clearSubSlot(si); setOpenSubSlot(null); setSubDropdownPos(null); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Remove content
                  </button>
                </div>
              )}
            </div>
          );
        })(),
        document.body
      )}

      </>}

      </>
    );
  }
);

// Memoized so one card's state change (or an unrelated parent setState during the
// mount burst — scale / bg-layer / recording-state / another card's settings)
// doesn't re-render (and redraw) all four canvases. Only DATA props are compared;
// the callback props are intentionally ignored — the component mirrors them into
// refs (or they close over a constant entry id + stable setters), so a changed
// callback identity never needs a re-render. This is the main fix for the
// several-seconds jank when the editor first opens.
const CANVAS_DATA_PROPS: (keyof CarouselCanvasProps)[] = [
  'imageSrc', 'videoSrc', 'chartBg', 'headline', 'subheadline', 'settings',
  'brandLogoSrc', 'invertedSlots', 'platform', 'rectMode', 'isDraggingElement', 'staticMode',
];
function canvasPropsEqual(a: CarouselCanvasProps, b: CarouselCanvasProps): boolean {
  for (const k of CANVAS_DATA_PROPS) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

export default React.memo(CarouselCanvas, canvasPropsEqual);
