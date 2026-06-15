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

export interface ChartsImageCanvasProps {
  market: ChartsImageMarket | null;
  overrideName?: string;
  overrideIndustry?: string;
  direction?: ChartsImageDirection;
  noiseLevel?: ChartsImageNoiseLevel;
  aspectRatio?: CanvasAspectRatio;
}

export interface ChartsImageCanvasRef {
  exportPng: () => void;
}
