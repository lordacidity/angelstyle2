// Ported from pauv-the-app/app/api/markets/batch-history/route.ts
import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const WINDOW_MS: Record<string, number> = {
  '1h':  1 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const BUCKET_MS: Record<string, number> = {
  '1h':  30 * 1000,
  '24h': 15 * 60 * 1000,
  '7d':  60 * 60 * 1000,
  '30d': 4 * 60 * 60 * 1000,
  'all': 60 * 60 * 1000,
};

const DOWNSAMPLE_THRESHOLD = 240;
const RAW_ROW_LIMIT = 20000;

interface HistoryRow {
  market_id: string;
  price_after_cents: number | null;
  price_after_microusdc: number | string | null;
  created_at: string;
}

interface PricePoint { price: number; timestamp: string }

function sbFetch(url: string) {
  return fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    cache: 'no-store',
  });
}

function rowToUsd(row: HistoryRow): number | null {
  if (row.price_after_microusdc != null) {
    const n = Number(row.price_after_microusdc);
    if (Number.isFinite(n)) return n / 1_000_000;
  }
  if (row.price_after_cents != null) return row.price_after_cents / 100;
  return null;
}

function downsample(points: PricePoint[], bucketMs: number): PricePoint[] {
  const buckets = new Map<number, PricePoint>();
  for (const p of points) {
    const ms = new Date(p.timestamp).getTime();
    const bucket = Math.floor(ms / bucketMs) * bucketMs;
    buckets.set(bucket, p);
  }
  return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const slugsRaw = searchParams.get('slugs') ?? '';
  const window   = searchParams.get('window') ?? '30d';

  const slugs = slugsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
  if (!slugs.length) return NextResponse.json({});

  try {
    const pUrl = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
    pUrl.searchParams.set('select', 'id,ticker');
    pUrl.searchParams.set('ticker', `in.(${slugs.join(',')})`);
    const pRes = await sbFetch(pUrl.toString());
    if (!pRes.ok) return NextResponse.json({});
    const profiles: { id: string; ticker: string }[] = await pRes.json();
    if (!profiles.length) return NextResponse.json({});

    const profileIds = profiles.map(p => p.id);
    const idToTicker = new Map(profiles.map(p => [p.id, p.ticker]));

    const hUrl = new URL(`${SUPABASE_URL}/rest/v1/market_price_history`);
    hUrl.searchParams.set('select', 'market_id,price_after_cents,price_after_microusdc,created_at');
    hUrl.searchParams.set('market_id', `in.(${profileIds.join(',')})`);
    hUrl.searchParams.set('order', 'created_at.asc');
    hUrl.searchParams.set('limit', String(RAW_ROW_LIMIT));
    if (window in WINDOW_MS) {
      const cutoff = new Date(Date.now() - WINDOW_MS[window]!).toISOString();
      hUrl.searchParams.set('created_at', `gte.${cutoff}`);
    }

    const hRes = await sbFetch(hUrl.toString());
    if (!hRes.ok) return NextResponse.json({});
    const rows: HistoryRow[] = await hRes.json();
    const bucketMs = BUCKET_MS[window] ?? BUCKET_MS['30d']!;

    const byMarket = new Map<string, PricePoint[]>();
    for (const row of rows) {
      const price = rowToUsd(row);
      if (price == null) continue;
      const list = byMarket.get(row.market_id) ?? [];
      list.push({ price, timestamp: row.created_at });
      byMarket.set(row.market_id, list);
    }

    const result: Record<string, PricePoint[]> = {};
    for (const [marketId, pts] of byMarket) {
      const ticker = idToTicker.get(marketId);
      if (!ticker) continue;
      result[ticker] = pts.length > DOWNSAMPLE_THRESHOLD ? downsample(pts, bucketMs) : pts;
    }

    // Fallback flat line for markets with no history
    const missingIds = profileIds.filter(id => !byMarket.has(id));
    if (missingIds.length) {
      const fUrl = new URL(`${SUPABASE_URL}/rest/v1/markets`);
      fUrl.searchParams.set('select', 'profile_id,latest_price_cents,latest_price_microusdc');
      fUrl.searchParams.set('profile_id', `in.(${missingIds.join(',')})`);
      const fRes = await sbFetch(fUrl.toString());
      if (fRes.ok) {
        const fRows: { profile_id: string; latest_price_cents: number | null; latest_price_microusdc: number | string | null }[] = await fRes.json();
        const now = new Date().toISOString();
        for (const row of fRows) {
          const ticker = idToTicker.get(row.profile_id);
          if (!ticker) continue;
          const price = row.latest_price_microusdc != null
            ? Number(row.latest_price_microusdc) / 1_000_000
            : (row.latest_price_cents ?? 0) / 100;
          result[ticker] = [{ price, timestamp: now }];
        }
      }
    }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (err) {
    console.error('[batch-history]', err);
    return NextResponse.json({});
  }
}
