'use client';

import { useState, useEffect, useRef } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import { CANVAS_W, CANVAS_H, VIDEO_TARGET_W } from '../constants';
import type { Box } from '../types';

// Provisional box on metadata load — a width-fitted, centered rect. The canvas
// immediately re-runs its intelligent auto-fit via onPlaced(), so this is just a
// sane starting value (and avoids a flash before that runs in the same tick).
function calcVideoBox(vw: number, vh: number, currentBrand: string): Box {
  if (currentBrand === 'clean') {
    const scale = CANVAS_W / vw;
    const drawH = vh * scale;
    return { x: 0, y: (CANVAS_H - drawH) / 2, w: CANVAS_W, h: drawH };
  }
  const scale = Math.min(VIDEO_TARGET_W / vw, CANVAS_H / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  return { x: (CANVAS_W - drawW) / 2, y: (CANVAS_H - drawH) / 2, w: drawW, h: drawH };
}

interface UseVideoLoadingParams {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSrc: string;
  brand: string;
  rowNumber: number;
  videoId?: string;
  boxRef: MutableRefObject<Box>;
  setBox: (b: Box) => void;
  videoOffsetRef: MutableRefObject<{ x: number; y: number }>;
  videoScaleRef: MutableRefObject<number>;
  setVideoScale: (s: number) => void;
  onVideoError?: () => void;
  // Called right after the box is (re)placed, so the canvas can run its
  // intelligent auto-fit with full knowledge of header/CTA/top-anchor.
  onPlaced?: () => void;
}

export function useVideoLoading({
  videoRef, videoSrc, brand, rowNumber, videoId,
  boxRef, setBox, videoOffsetRef, videoScaleRef, setVideoScale, onVideoError,
  onPlaced,
}: UseVideoLoadingParams) {
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);

  // Keep the latest onPlaced callable without re-firing the load effects.
  const onPlacedRef = useRef(onPlaced);
  onPlacedRef.current = onPlaced;

  // Recalculate box on brand change (for already-loaded video)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const b = calcVideoBox(video.videoWidth, video.videoHeight, brand);
    boxRef.current = b;
    setBox(b);
    videoOffsetRef.current = { x: 0, y: 0 };
    videoScaleRef.current = 1;
    setVideoScale(1);
    onPlacedRef.current?.();
  }, [brand]);

  // Set box and duration on metadata load
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleLoadedMetadata = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      console.log('[Row ' + (rowNumber + 1) + '] Video loaded successfully:', { videoId, vw, vh });
      if (vw && vh) {
        const b = calcVideoBox(vw, vh, brand);
        boxRef.current = b;
        setBox(b);
        videoOffsetRef.current = { x: 0, y: 0 };
        videoScaleRef.current = 1;
        setVideoScale(1);
        onPlacedRef.current?.();
      }
      const dur = isFinite(video.duration) ? video.duration : 0;
      setVideoDuration(dur);
      setTrimStart(0);
      setTrimEnd(dur);
      trimStartRef.current = 0;
      trimEndRef.current = dur;
      setCurrentTime(0);
    };
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [videoSrc, brand]);

  // Load new video src. Valid sources are either a local upload (blob: URL) or a
  // proxied remote video (/api/proxy?url=…). Bail on anything else: an empty src,
  // or a proxy URL whose url= param is empty (nothing fetched yet).
  useEffect(() => {
    const isLocalBlob = videoSrc.startsWith('blob:');
    const isProxiedRemote = videoSrc.includes('url=') && !videoSrc.endsWith('url=');
    if (!videoSrc || (!isLocalBlob && !isProxiedRemote)) {
      setIsVideoLoading(false);
      return;
    }
    console.log('[Row ' + (rowNumber + 1) + '] Video source changed:', videoId);
    setVideoError(null);
    setIsVideoLoading(true);

    const video = videoRef.current;
    if (!video) { setIsVideoLoading(false); return; }

    video.pause();
    video.removeAttribute('src');
    video.load();
    video.src = videoSrc;

    const handleLoadedData = () => { if (video.readyState >= 2) setIsVideoLoading(false); };
    const handleError = () => setIsVideoLoading(false);

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('error', handleError);

    const timeoutId = setTimeout(() => {
      if (video.readyState < 2) {
        console.error('[Row ' + (rowNumber + 1) + '] Video timeout:', videoId);
        setVideoError('Video failed to load. The video URL may be invalid.');
        setIsVideoLoading(false);
        onVideoError?.();
      }
    }, 120000);

    return () => {
      clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
    };
  }, [videoSrc]);

  return {
    isVideoLoading, videoError, setVideoError,
    videoDuration, trimStart, trimEnd, setTrimStart, setTrimEnd,
    currentTime, setCurrentTime, trimStartRef, trimEndRef,
  };
}
