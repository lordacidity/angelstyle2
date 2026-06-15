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

export interface ChartsImageCanvasProps {
  market: ChartsImageMarket | null;
  overrideName?: string;
  overrideIndustry?: string;
  overridePct?: string;    // signed number string e.g. "-5.2" or "3.1"; empty = use calculated
  overrideRaw?: string;    // signed number string e.g. "-0.32" or "0.15"; empty = use calculated
  aspectRatio?: CanvasAspectRatio;
}

export interface ChartsImageCanvasRef {
  exportPng: () => void;
}
