export interface SparkPoint { value: number; timestamp: number }

export interface ChartsImageMarket {
  id: string;
  name: string;
  ticker: string;
  photo_url: string | null;
  industry: string | null;
  price?: { usd: number | null; lifetimeChangePct?: number | null } | null;
  sparkline?: SparkPoint[];
}

export type CanvasAspectRatio = 'portrait' | 'ppt';

// Direction of the headline change. 'up' = green / positive, 'down' = red / negative.
// The magnitude is a seeded random 5–15% per ticker; the raw $ change is derived from it.
export type ChartsImageDirection = 'up' | 'down';

// How much synthetic volatility to add to the chart line. 'none' = clean (default).
export type ChartsImageNoiseLevel = 'none' | 'small' | 'med' | 'large';

// 'image' = static PNG card. 'video' = the line animates in (drawing left→right
// with a leading head dot) and exports as an MP4 with the same animation, the
// same way the Charts (artist) feature records its chart.
export type ChartsImageSubMode = 'image' | 'video';

export interface ChartsImageCanvasProps {
  market: ChartsImageMarket | null;
  overrideName?: string;
  overrideIndustry?: string;
  direction?: ChartsImageDirection;
  noiseLevel?: ChartsImageNoiseLevel;
  aspectRatio?: CanvasAspectRatio;
  // Video mode
  subMode?: ChartsImageSubMode;
  speed?: number;                 // 1/2/3 — divides the grow window (faster draw-in)
  audioUrl?: string;              // optional narration track muxed into the export
  onRecordingStateChange?: (s: { isRecording: boolean; recProgress: number; recStatus: string }) => void;
}

export interface ChartsImageCanvasRef {
  exportPng: () => void;
  // Record the reveal animation to an MP4 (video sub-mode).
  startVideoExport: () => Promise<void>;
  // Restart the reveal animation from t=0 (preview).
  replay: () => void;
}
