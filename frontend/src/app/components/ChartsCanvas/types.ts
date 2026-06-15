import type { MutableRefObject } from 'react';

// Legacy types kept for unused helper files in this directory
export type Handle = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br' | 'move';
export interface Box { x: number; y: number; w: number; h: number }
export interface RecordingState { isRecording: boolean; recProgress: number; recStatus: string }
export interface VideoTrimState { trimStart: number; trimEnd: number; duration: number; includeEdit: boolean; videoScale: number; blockTopPct: number }
export interface SparkPoint { value: number; timestamp: number }
export interface MarketData {
  name: string; ticker: string; photo_url: string | null; industry: string | null;
  subcategory: string | null; sparkline?: SparkPoint[] | null;
  size?: 'large' | 'small' | 'bio'; ctaCategory?: 'artists' | 'athletes';
  price: { usd: number | null; lifetimeChangePct: number | null };
}

export interface ChartsMarket {
  id: string;
  name: string;
  ticker: string;
  photo_url: string | null;
  industry: string | null;
  price?: { usd: number | null; lifetimeChangePct?: number | null } | null;
  sparkline?: SparkPoint[];
}

export interface ChartsCanvasProps {
  overlayCaption: string;
  markets: [ChartsMarket | null, ChartsMarket | null];
  overrideNames?: [string, string];
  rowNumber?: number;
  onRecordingStateChange?: (state: { isRecording: boolean; recProgress: number; recStatus: string }) => void;
  audioUrl?: string;        // proxy URL for the audio track
  audioDurationMs?: number; // total audio duration in ms — drives GROW_MS and CYCLE_MS
  speed?: number;           // playback multiplier (1 = normal, 2 = 2×, 3 = 3×) — shortens the clip
  startTrimPct?: number;    // 0–0.9 fraction of the leading data span to skip (cuts a flat intro)
}

export interface ChartsCanvasRef {
  startDownload: () => Promise<string | void>;
  cancelExport: () => void;
  replay: () => void;
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
  getTrimState: () => { trimStart: number; trimEnd: number; duration: number; includeEdit: boolean; videoScale: number; blockTopPct: number };
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
