import type { MutableRefObject } from 'react';

export type Handle = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br' | 'move';

export interface Box { x: number; y: number; w: number; h: number }

export interface RecordingState {
  isRecording: boolean;
  recProgress: number;
  recStatus: string;
}

export interface VideoTrimState {
  trimStart: number;
  trimEnd: number;
  duration: number;
  includeEdit: boolean;
  videoScale: number;
  blockTopPct: number;
}

export interface TikTokCanvasProps {
  videoSrc: string;
  videoId?: string;
  rowNumber?: number;
  onVideoError?: () => void;
  /** 'pauv' = Twitter/X header template, 'clean' = caption-only template */
  brand?: 'pauv' | 'clean';
  overlayLogoSrc?: string;
  overlayDisplayName?: string;
  overlayHandle?: string;
  overlayVerified?: boolean;
  overlayCaption?: string;
  marketData?: MarketData | null;
  onRecordingStateChange?: (state: RecordingState) => void;
}

export interface TikTokCanvasRef {
  // Resolves to the Phonedeck upload filename when the render reached the
  // Incoming folder (so the caller can map it back to a board row), else void.
  startDownload: () => Promise<string | void>;
  cancelExport: () => void;
  play: () => void;
  pause: () => void;
  seekTo: (t: number) => void;
  setTrimRange: (start: number, end: number) => void;
  resetTrim: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setZoom: (scale: number) => void;
  resetBox: () => void;
  centerBox: () => void;
  setBlockTopPct: (pct: number) => void;
  setIncludeEdit: (v: boolean) => void;
  getVideoElement: () => HTMLVideoElement | null;
  getTrimState: () => VideoTrimState;
}

export interface SparkPoint { value: number; timestamp: number }

export interface MarketData {
  name: string;
  ticker: string;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  sparkline?: SparkPoint[] | null;
  /** CTA size: 'large' = full row, 'small' = one-line, 'bio' = just the "pauv.com
   *  to trade" link (no market row). Defaults to 'large'. */
  size?: 'large' | 'small' | 'bio';
  price: {
    usd: number | null;
    lifetimeChangePct: number | null;
  };
}

export interface DrawHeaderOptions {
  ctx: CanvasRenderingContext2D;
  cx: number;
  cy: number;
  cw: number;
  overlayCaption: string;
  overlayLogoSrc: string;
  overlayDisplayName: string;
  overlayHandle: string;
  overlayVerified: boolean;
  logoImgRef: MutableRefObject<HTMLImageElement | null>;
  verifiedImgRef: MutableRefObject<HTMLImageElement | null>;
}
