export interface SparkPoint { value: number; timestamp: number }

export interface ChartsImageMarket {
  id: string;
  name: string;
  ticker: string;
  photo_url: string | null;
  industry: string | null;
  sparkline?: SparkPoint[];
}

export interface ChartsImageCanvasProps {
  market: ChartsImageMarket | null;
  overrideName?: string;
}

export interface ChartsImageCanvasRef {
  exportPng: () => void;
}
