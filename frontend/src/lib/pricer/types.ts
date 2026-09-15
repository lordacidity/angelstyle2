// What the pricer's server-sent-event stream carries (the emit() calls in pipeline.js's runPipeline) and what
// /api/pricer/config returns. Client-safe: no server imports. The page (PricerSection) renders these shapes.

export type PricerStep = 'bio' | 'social' | 'news' | 'industry' | 'final';
export type AnalystKey = 'social' | 'news' | 'industry';
export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface PricerConfig {
  count: number;                                              // people in the master list
  models: { fast: string; social: string; judge: string };
  creditsPerUsd: number | null;
  newsWindowDays: number;
}

export interface Source { title: string; uri: string }
export interface Evidence { label: string; value: string; note: string }

export interface BioData {
  identified: boolean;
  canonical_name: string;
  aliases: string[];
  search_contexts: string[];
  industry: string;
  subindustry: string;
  one_line: string;
  bio: string;
  searched: boolean;
  attempts: number;
  sources: Source[];
  queries: string[];
  model: string;
  industry_known: boolean;
}

export interface AnalystData {
  price: number;
  confidence: Confidence;
  tier: string;
  rationale: string;
  evidence: Evidence[];
  searched?: boolean;
  attempts?: number;
  sources?: Source[];
  queries?: string[];
  model?: string;
  // social
  formula?: string;
  searches?: number;
  // news
  source?: 'google-news' | 'web';
  feed?: { query: string; in_window: number; capped: boolean; days: number; obituaries_dropped: number };
  // industry
  peers_total?: number;
  peers_with_lines?: number;
  peer_prices?: { high: number; low: number } | null;
}

export interface AnalystError { error: string; searched?: boolean; attempts?: number }
export type AnalystResult = AnalystData | AnalystError;
export const isAnalystError = (r: AnalystResult | undefined): r is AnalystError => !!r && 'error' in r;

export interface FinalData {
  price: number;
  base_price: number;
  online_celebrity: boolean;
  online_celebrity_note: string;
  discount_pct: number;
  tier: string;
  judge_tier: string;
  confidence: 'high' | 'medium' | 'low';
  weights: Record<AnalystKey, number>;
  anchors: AnalystKey[];
  one_band_rule_applied: boolean;
  rationale: string;
  model: string;
  price_credits: number | null;
}

export interface InfoEvent {
  existing: { name: string; industry: string; subindustry: string; listed_price: number; price: number } | null;
  priced_before: { priced_at: string; canonical_name: string; final_price: number; times: number } | null;
}

export type StepEvent =
  | { step: PricerStep; status: 'running'; note?: string }
  | { step: PricerStep; status: 'error'; error: string }
  | { step: 'bio'; status: 'done'; data: BioData }
  | { step: AnalystKey; status: 'done'; data: AnalystData }
  | { step: 'final'; status: 'done'; data: FinalData };

export interface PricerRun {
  startedAt?: string;
  finishedAt?: string;
  input: { name: string; hint?: string };
  models?: PricerConfig['models'];
  bio?: BioData;
  analysts: Partial<Record<AnalystKey, AnalystResult>>;
  final?: FinalData;
}

export interface DoneEvent { logged: boolean; run: PricerRun }
export interface PipelineErrorEvent { message: string }

// What /api/pricer/photos returns: free-to-use photos of the person, for the Pricer's photo panel (PricerPhotos).
export interface PricerPhoto {
  id: string;
  source: 'Wikimedia Commons' | 'Openverse';
  provider?: string;        // Openverse only: where the photo actually lives (flickr, …)
  title: string;
  thumb: string;            // ~400px wide, for the grid
  full: string;             // up to 1280px wide, what the crop is cut from
  width: number;            // of the original file
  height: number;
  license: string;          // "CC BY-SA 4.0", "CC0", "Public domain"
  licenseUrl: string;
  creator: string;
  page: string;             // the file's own page, where the licence can be checked
}
export interface PhotosResponse { query: string; photos: PricerPhoto[]; errors: { wikimedia?: string; openverse?: string } }
