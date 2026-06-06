'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

import {
  CANVAS_W, CANVAS_H, VIDEO_TARGET_W, DISPLAY_SCALE, MIN_DIM,
  BASE_HEADER_HEIGHT, CAPTION_LINE_HEIGHT, CAPTION_TOP_PADDING, HEADER_PADDING_X,
  BLOCK_TOP_PCT,
} from './constants';
import type { Box, TikTokCanvasProps, TikTokCanvasRef } from './types';
import { drawHeaderOnContext } from './drawing/drawHeader';
import { drawMarketRow, MARKET_ROW_H, MARKET_ROW_H_SMALL, CTA_TOP_GAP, CTA_TOP_GAP_SMALL, CTA_TOP_GAP_BIO, CTA_LINK_AREA_H, CTA_LINK_AREA_H_BIO } from './drawing/drawMarketRow';
import { countCaptionLines, countPauvCaptionLines, CAPTION_EMOJI_SIZE } from './drawing/countCaptionLines';
import { wrapRichText, drawRichLine } from '@/lib/emoji';
import { VideoOverlays } from './ui/VideoOverlays';
import { CanvasHandles } from './ui/CanvasHandles';
import { useVideoLoading } from './hooks/useVideoLoading';
import { usePanZoom } from './hooks/usePanZoom';
import { useDrag } from './hooks/useDrag';
import { useRecording } from './hooks/useRecording';

export type { TikTokCanvasRef, MarketData, SparkPoint } from './types';

// Vertical split of the leftover black space around the block: the space ABOVE
// the block is 1.4 parts to the 2 parts BELOW it (top : bottom = 1.4 : 2).
const TOP_RATIO = 1.4;
const BOTTOM_RATIO = 2;
const TOP_FRAC = TOP_RATIO / (TOP_RATIO + BOTTOM_RATIO); // ≈ 0.4118

export const TikTokCanvas = forwardRef<TikTokCanvasRef, TikTokCanvasProps>(function TikTokCanvas({
  videoSrc,
  videoId,
  rowNumber = 0,
  onVideoError,
  brand = 'pauv',
  overlayLogoSrc = '/templatelogo.png',
  overlayDisplayName = 'Pauv',
  overlayHandle = '@Pauv',
  overlayVerified = true,
  overlayCaption = '',
  marketData = null,
  onRecordingStateChange,
}: TikTokCanvasProps, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const raf = useRef(0);

  const verifiedImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const marketAvatarImgRef = useRef<HTMLImageElement | null>(null);
  const marketAvatarUrlRef = useRef<string | null>(null);
  const pauvLogoImgRef = useRef<HTMLImageElement | null>(null);

  const videoOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const videoScaleRef = useRef<number>(1);
  const [videoScale, setVideoScale] = useState(1);

  const boxRef = useRef<Box>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });

  const [includeEdit, setIncludeEdit] = useState(false);
  const includeEditRef = useRef(false);

  // Vertical position of the block's top edge, as a fraction of canvas height.
  // Editable per video via the "Top %" field in the controls bar.
  const blockTopPctRef = useRef(BLOCK_TOP_PCT);

  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => { logoImgRef.current = null; }, [overlayLogoSrc]);

  // ── Hooks ────────────────────────────────────────────────────────────────────

  const {
    isVideoLoading, videoError, setVideoError,
    videoDuration, trimStart, trimEnd, setTrimStart, setTrimEnd,
    currentTime, setCurrentTime, trimStartRef, trimEndRef,
  } = useVideoLoading({
    videoRef, videoSrc, brand, rowNumber, videoId,
    boxRef, setBox, videoOffsetRef, videoScaleRef, setVideoScale, onVideoError,
    onPlaced: () => anchorBlockTop(),
  });

  usePanZoom({ canvasRef, videoScaleRef, setVideoScale });

  const { startDrag, isDraggingRef } = useDrag({
    boxRef, setBox, videoOffsetRef,
    onResizeEnd: () => repositionBlock(),
  });

  const { isRecording, recProgress, recStatus, startRecording, cancelRecording } = useRecording({
    canvasRef, videoRef, brand, rowNumber, videoId,
    boxRef, videoOffsetRef, videoScaleRef,
    trimStartRef, trimEndRef, includeEditRef,
    logoImgRef, verifiedImgRef,
    overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
    marketData, marketAvatarImgRef, marketAvatarUrlRef, pauvLogoImgRef,
  });

  useImperativeHandle(ref, () => ({
    startDownload: () => (!isRecording ? startRecording() : Promise.resolve()),
    cancelExport: cancelRecording,
    play: () => { const v = videoRef.current; if (v) v.play(); },
    pause: () => { const v = videoRef.current; if (v) v.pause(); },
    seekTo: (t: number) => { const v = videoRef.current; if (v) v.currentTime = t; },
    setTrimRange: (start: number, end: number) => {
      trimStartRef.current = start; trimEndRef.current = end;
      setTrimStart(start); setTrimEnd(end);
    },
    resetTrim: () => {
      trimStartRef.current = 0; trimEndRef.current = videoDuration;
      setTrimStart(0); setTrimEnd(videoDuration);
      const v = videoRef.current; if (v) v.currentTime = 0;
    },
    zoomIn, zoomOut, resetZoom,
    setZoom: (s: number) => { const c = Math.max(0.5, Math.min(3, s)); videoScaleRef.current = c; setVideoScale(c); },
    resetBox,
    centerBox: anchorBlockTop,
    setBlockTopPct: (pct: number) => {
      blockTopPctRef.current = Math.max(0, Math.min(1, pct));
      anchorBlockTop();
    },
    setIncludeEdit: (v: boolean) => { setIncludeEdit(v); includeEditRef.current = v; },
    getVideoElement: () => videoRef.current,
    getTrimState: () => ({ trimStart, trimEnd, duration: videoDuration, includeEdit, videoScale, blockTopPct: blockTopPctRef.current }),
  }), [isRecording, startRecording, cancelRecording, videoDuration, trimStart, trimEnd, includeEdit, videoScale, zoomIn, zoomOut, resetZoom, overlayCaption, brand]);

  const onRecordingStateChangeRef = useRef(onRecordingStateChange);
  useEffect(() => { onRecordingStateChangeRef.current = onRecordingStateChange; });

  useEffect(() => {
    onRecordingStateChangeRef.current?.({ isRecording, recProgress, recStatus });
  }, [isRecording, recProgress, recStatus]);

  // Brand switch changes the video's target width (clean = full-bleed), so re-fit
  // the photo to its natural height at the new width and re-position.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    anchorBlockTop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand]);

  // Caption edits (header grows/shrinks) and CTA size changes (small vs large,
  // marketData) change the chrome height. Re-apply the 1:2 top:bottom split using
  // the current photo size so the block stays balanced without resetting a manual
  // resize. repositionBlock only touches y, so it's safe to run on every change.
  //
  // Depend on a primitive signal derived from marketData (presence + size), not
  // the marketData object itself — the parent rebuilds that object on every
  // render (spread + fresh sparkline array), which would otherwise re-fire this
  // effect every render → setBox → re-render → "Maximum update depth exceeded".
  const marketSignal = marketData ? `m:${marketData.size}` : 'none';
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    repositionBlock();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayCaption, marketSignal]);

  // ── Main draw loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const v = videoRef.current;
    if (!canvas || !v) return;
    const video = v;
    const ctx = canvas.getContext('2d')!;
    let active = true;

    const drawOpts = {
      overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
      logoImgRef, verifiedImgRef,
    };

    // ── Pre-compute caption layout once per effect (caption text doesn't change mid-loop) ──
    const CAPTION_PAD_X   = HEADER_PADDING_X + 43;
    const CAPTION_MAX_W   = CANVAS_W - CAPTION_PAD_X * 2;
    const CAPTION_BOT_OFF = 18;
    const CLEAN_PAD_TOP   = 44;
    const CLEAN_PAD_BOT   = 40;

    // Groups of pre-wrapped lines; null entry = blank user-line (paragraph break)
    const captionGroups: (string[] | null)[] = [];
    if (overlayCaption && brand === 'clean') {
      ctx.font = '400 42px Chirp, "Comic Sans MS", cursive';
      for (const userLine of overlayCaption.split('\n')) {
        if (!userLine) { captionGroups.push(null); continue; }
        captionGroups.push(wrapRichText(ctx, userLine, CAPTION_MAX_W, CAPTION_EMOJI_SIZE));
      }
    }
    const captionLineCount = captionGroups.reduce((n, g) => n + (g === null ? 1 : g.length), 0);
    const captionAreaH = captionLineCount > 0
      ? CLEAN_PAD_TOP + (captionLineCount * CAPTION_LINE_HEIGHT) + CLEAN_PAD_BOT - CAPTION_BOT_OFF
      : 0;

    // Pre-compute pauv header height (depends only on caption, not on box position)
    const pauvHeaderHeight = overlayCaption && brand !== 'clean'
      ? (() => {
          const lines = countPauvCaptionLines(ctx, overlayCaption);
          return BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (lines * CAPTION_LINE_HEIGHT) - CAPTION_BOT_OFF;
        })()
      : BASE_HEADER_HEIGHT;

    // ── Draw loop — throttled to ~10 fps when paused to spare CPU ──────────────
    let lastDrawTime = 0;

    function draw() {
      if (!active) return;
      raf.current = requestAnimationFrame(draw);

      // Throttle to ~10fps when paused and idle; bypass throttle while dragging for smooth 60fps
      if (video.paused && !isDraggingRef.current) {
        const now = performance.now();
        if (now - lastDrawTime < 100) return;
        lastDrawTime = now;
      }

      if (brand === 'clean') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const { x, y, w, h } = boxRef.current;
          const { x: ox, y: oy } = videoOffsetRef.current;

          if (captionGroups.length > 0) {
            const captionAreaY = Math.max(0, y - captionAreaH + 4);
            ctx.font = '400 42px Chirp, "Comic Sans MS", cursive';
            ctx.fillStyle = '#000';
            let cy = captionAreaY + CLEAN_PAD_TOP + CAPTION_LINE_HEIGHT - 10;
            for (let gi = 0; gi < captionGroups.length; gi++) {
              const group = captionGroups[gi];
              const isLastGroup = gi === captionGroups.length - 1;
              if (group === null) { cy += CAPTION_LINE_HEIGHT; continue; }
              for (let wi = 0; wi < group.length; wi++) {
                drawRichLine(ctx, group[wi], CAPTION_PAD_X, cy, CAPTION_EMOJI_SIZE);
                if (wi < group.length - 1) cy += CAPTION_LINE_HEIGHT;
              }
              if (!isLastGroup) cy += CAPTION_LINE_HEIGHT;
            }
          }

          // Cover-fill the box: the box already carries the intended size +
          // aspect, so the video fills it (no black bars), zoom/pan adjust within.
          const cover = Math.max(w / video.videoWidth, h / video.videoHeight) * videoScaleRef.current;
          const drawW = video.videoWidth * cover;
          const drawH = video.videoHeight * cover;
          const dx = x + (w - drawW) / 2 + ox;
          const dy = y + (h - drawH) / 2 + oy;

          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          ctx.drawImage(video, dx, dy, drawW, drawH);
          ctx.restore();
        }
        return;
      }

      // pauv (Twitter/X header template)
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const { x, y, w, h } = boxRef.current;
        const { x: ox, y: oy } = videoOffsetRef.current;

        const headerY = Math.max(0, y - pauvHeaderHeight + 4);
        drawHeaderOnContext({ ctx, cx: 0, cy: headerY, cw: CANVAS_W, ...drawOpts });

        // Cover-fill the box: the box already carries the intended size +
        // aspect, so the video fills it (no black bars), zoom/pan adjust within.
        const cover = Math.max(w / video.videoWidth, h / video.videoHeight) * videoScaleRef.current;
        const drawW = video.videoWidth * cover;
        const drawH = video.videoHeight * cover;
        const dx = x + (w - drawW) / 2 + ox;
        const dy = y + (h - drawH) / 2 + oy;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.drawImage(video, dx, dy, drawW, drawH);
        ctx.restore();

        if (marketData) {
          const arrowPulse = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(2 * Math.PI * performance.now() / 1000 * 0.75));
          drawMarketRow({
            ctx, cx: 0, videoBottomY: y + h, cw: CANVAS_W,
            name: marketData.name,
            subtitle: marketData.industry ?? marketData.subcategory ?? '—',
            photo_url: marketData.photo_url,
            priceUsd: marketData.price.usd,
            lifetimeChangePct: marketData.price.lifetimeChangePct,
            sparkline: marketData.sparkline,
            size: marketData.size ?? 'large',
            ctaCategory: marketData.ctaCategory,
            down: marketData.down,
            avatarImgRef: marketAvatarImgRef,
            lastPhotoUrlRef: marketAvatarUrlRef,
            pauvLogoImgRef,
            arrowOpacity: arrowPulse,
          });
        }
      }
    }

    draw();
    return () => { active = false; cancelAnimationFrame(raf.current); };
  // videoScale intentionally omitted: the draw loop reads videoScaleRef.current directly,
  // so including it would restart the RAF loop on every zoom step causing a visible frame drop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc, overlayDisplayName, overlayHandle, overlayVerified, overlayCaption, brand, overlayLogoSrc, marketData]);

  // ── Interaction handlers ──────────────────────────────────────────────────────

  // Clear any manual pan/zoom and re-run the intelligent auto-fit.
  function resetBox() {
    videoOffsetRef.current = { x: 0, y: 0 };
    videoScaleRef.current = 1;
    setVideoScale(1);
    anchorBlockTop();
  }

  // Height of the header/caption block drawn above the video for the current
  // brand + caption. Mirrors the draw loop so the anchor matches what's painted.
  function computeHeaderHeight(): number {
    const ctx = canvasRef.current?.getContext('2d');
    if (brand === 'clean') {
      if (!overlayCaption || !ctx) return 0;
      const captionLines = countCaptionLines(ctx, overlayCaption);
      if (captionLines <= 0) return 0;
      const CLEAN_PAD_TOP = 44, CLEAN_PAD_BOT = 40, CAPTION_BOT_OFF = 18;
      return CLEAN_PAD_TOP + (captionLines * CAPTION_LINE_HEIGHT) + CLEAN_PAD_BOT - CAPTION_BOT_OFF;
    }
    if (!overlayCaption || !ctx) return BASE_HEADER_HEIGHT;
    const captionLines = countPauvCaptionLines(ctx, overlayCaption);
    const CAPTION_BOTTOM_OFFSET = 35; // keep in sync with drawHeader.ts
    return BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - CAPTION_BOTTOM_OFFSET;
  }

  // Height the CTA (market row) reserves below the video, 0 when there's none.
  function ctaHeight(): number {
    if (!marketData) return 0;
    const size = marketData.size ?? 'large';
    // Bio: no market row, just the (bigger) link tucked under the video.
    if (size === 'bio') return CTA_TOP_GAP_BIO + CTA_LINK_AREA_H_BIO;
    const small = size === 'small';
    const row = small ? MARKET_ROW_H_SMALL : MARKET_ROW_H;
    const topGap = small ? CTA_TOP_GAP_SMALL : CTA_TOP_GAP;
    return row + topGap + CTA_LINK_AREA_H; // gap + row + "Link in bio" line
  }

  // Auto-size + position the crop box so the whole block (header → video → CTA)
  // sits with the black space ABOVE it 1.4 parts to the 2 parts below it
  // (top : bottom = 1.4 : 2). The fixed chrome (header + CTA) is constant, so the
  // leftover black space is CANVAS_H - splitChrome - videoHeight; blockTop is
  // TOP_FRAC of that leftover. The "link in bio" line is intentionally left OUT
  // of splitChrome so it reads as part of the bottom black space, not the block.
  // The video is shown at the template's full width; its height is the natural
  // height at that width, capped to the frame (using the FULL chrome incl. the
  // link line) so nothing is cut off and blockTop never goes negative. The draw
  // loop cover-fills this box, so the frame is always tight around the video — no
  // black bars, no distortion. The header draws at `y - headerHeight + 4`, so
  // y = blockTop + headerHeight - 4 puts the header's top edge exactly at blockTop.
  function anchorBlockTop() {
    const video = videoRef.current;
    const headerHeight = computeHeaderHeight();
    const chrome = headerHeight + ctaHeight();
    // Chrome for the top:bottom split excludes the "link in bio" line.
    const splitChrome = chrome - (marketData ? ((marketData.size ?? 'large') === 'bio' ? CTA_LINK_AREA_H_BIO : CTA_LINK_AREA_H) : 0);

    if (!video || !video.videoWidth || !video.videoHeight) {
      const blockTop = Math.max(0, (CANVAS_H - splitChrome) * TOP_FRAC);
      const b = { ...boxRef.current, y: blockTop + headerHeight - 4 };
      boxRef.current = b;
      setBox({ ...b });
      return;
    }

    const boxW = brand === 'clean' ? CANVAS_W : VIDEO_TARGET_W;
    const naturalH = video.videoHeight * (boxW / video.videoWidth);
    const boxH = Math.max(MIN_DIM, Math.min(naturalH, CANVAS_H - chrome));
    const blockTop = Math.max(0, (CANVAS_H - splitChrome - boxH) * TOP_FRAC);
    const y = blockTop + headerHeight - 4;

    const b = { x: (CANVAS_W - boxW) / 2, y, w: boxW, h: boxH };
    boxRef.current = b;
    setBox({ ...b });
  }

  // Re-apply the 1.4:2 top:bottom split using the CURRENT photo size (unlike
  // anchorBlockTop, which re-fits the photo to its natural height). Used when the
  // chrome changes height — CTA toggled small/large, caption edited — or after a
  // manual resize, so the block re-centers vertically without resetting the size
  // the user just set.
  function repositionBlock() {
    const headerHeight = computeHeaderHeight();
    const chrome = headerHeight + ctaHeight();
    // Chrome for the top:bottom split excludes the "link in bio" line.
    const splitChrome = chrome - (marketData ? ((marketData.size ?? 'large') === 'bio' ? CTA_LINK_AREA_H_BIO : CTA_LINK_AREA_H) : 0);
    const boxH = boxRef.current.h;
    const blockTop = Math.max(0, (CANVAS_H - splitChrome - boxH) * TOP_FRAC);
    const b = { ...boxRef.current, y: blockTop + headerHeight - 4 };
    boxRef.current = b;
    setBox({ ...b });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  }

  function zoomIn() { const n = Math.min(3, videoScaleRef.current + 0.05); videoScaleRef.current = n; setVideoScale(n); }
  function zoomOut() { const n = Math.max(0.5, videoScaleRef.current - 0.05); videoScaleRef.current = n; setVideoScale(n); }
  function resetZoom() { videoScaleRef.current = 1; setVideoScale(1); }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative"
      style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE, overflow: 'visible' }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE }}
        className="block border border-zinc-700 shadow-[0_0_48px_rgba(254,44,85,0.1)]"
      />
      <VideoOverlays isVideoLoading={isVideoLoading} videoError={videoError} />
      <CanvasHandles box={box} onStartDrag={startDrag} />
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        preload="auto"
        loop playsInline
        onPlay={() => {
          setIsPlaying(true);
          const v = videoRef.current;
          if (v && v.currentTime < trimStartRef.current) v.currentTime = trimStartRef.current;
        }}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v) return;
          setCurrentTime(v.currentTime);
          if (trimEndRef.current > 0 && v.currentTime >= trimEndRef.current) {
            v.currentTime = trimStartRef.current;
          }
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v && v.duration > 1) v.currentTime = 1;
        }}
        onError={(e) => {
          const v = e.target as HTMLVideoElement;
          const errorCode = v.error?.code;
          if (!errorCode) return;
          const msgs: Record<number, string> = {
            4: 'Video format not supported. Try refreshing the page.',
            3: 'Video decode error. The file may be corrupted.',
            2: 'Network error. Check your internet connection.',
          };
          setVideoError(msgs[errorCode] ?? 'Failed to load video. The link may be invalid.');
          onVideoError?.();
        }}
        style={{ display: 'none' }}
      />
    </div>
  );
});
