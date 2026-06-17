import { NextRequest, NextResponse } from 'next/server';
// @ts-expect-error — no @types package for google-trends-api
import googleTrends from 'google-trends-api';
import { getCachedTrends, saveTrends } from '@/lib/trends-db';

export const runtime = 'nodejs'; // pg + Railway connection needs the Node runtime

interface TimelinePoint {
  time: string;
  value: number[];
  formattedTime: string;
}

type Point = { timestamp: number; value: number };

// Stable per-term seed (same LCG-friendly hash the charts code uses elsewhere).
function termSeed(term: string): number {
  return (term.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0) || 1;
}

// Densify the monthly series: between each consecutive pair, drop `perGap`
// points on the straight line connecting them, then nudge each one up or down by
// a random 5–10% of its value. Bounded and simple — unlike the old
// segment-scaled "arc" wiggle, the deviation never compounds on volatile data
// nor blows a small-movement chart up into a wall of spikes (the chart auto-
// scales its y-axis to the data, so any oversized wiggle fills the whole frame).
// Seeded LCG (no Math.random) so the shape is stable across requests/redraws.
function densifySeries(points: Point[], seed: number, perGap = 2): Point[] {
  if (points.length < 2) return points;

  let rng = (seed >>> 0) || 1;
  const nextRand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };

  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    out.push(a);

    for (let j = 1; j <= perGap; j++) {
      const f    = j / (perGap + 1);
      const base = a.value + (b.value - a.value) * f; // straight line a → b
      const pct  = 0.05 + nextRand() * 0.05;          // 5–10%
      const dir  = nextRand() < 0.5 ? -1 : 1;         // up or down
      const value = Math.max(0, Math.min(100, base * (1 + dir * pct)));
      out.push({ timestamp: Math.round(a.timestamp + (b.timestamp - a.timestamp) * f), value });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// SerpAPI's google_trends engine returns the same interest-over-time series
// google-trends-api scrapes, but through a paid API that doesn't get
// rate-limited / CAPTCHA-walled. Used only as a fallback when the free scrape
// fails. Returns null when no key is configured so the caller can surface the
// original rate-limit error instead.
async function fetchFromSerpApi(term: string): Promise<Point[] | null> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_trends');
  url.searchParams.set('q', term);
  url.searchParams.set('data_type', 'TIMESERIES');
  url.searchParams.set('date', 'all'); // 2004 → present, matches the scrape's range
  url.searchParams.set('api_key', key);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`serpapi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    error?: string;
    interest_over_time?: { timeline_data?: Array<{ timestamp?: string; values?: Array<{ extracted_value?: number; value?: string }> }> };
  };
  if (json.error) throw new Error(`serpapi: ${json.error}`);

  const timeline = json.interest_over_time?.timeline_data ?? [];
  const points: Point[] = timeline
    .map((p) => ({
      timestamp: parseInt(p.timestamp ?? '0', 10) * 1000,
      value: p.values?.[0]?.extracted_value ?? parseInt(p.values?.[0]?.value ?? '0', 10) ?? 0,
    }))
    .filter((p) => p.timestamp > 0);

  if (!points.length) throw new Error('serpapi: no data returned');
  return points;
}

// Cache layers, all keyed by term (lowercased):
//   1. in-process Map  — hot, per-process, survives until restart (24 h TTL)
//   2. Railway Postgres — persistent across restarts/deploys (TRENDS_CACHE_TTL_DAYS, default 30 d)
//   3. network pull     — free scrape → paid SerpAPI fallback
// The persistent layer is what keeps us off SerpAPI for terms we've already
// pulled. Stores RAW upstream points; densification is applied on read.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DB_TTL_MS    = (Number(process.env.TRENDS_CACHE_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;

const cache    = new Map<string, { points: Point[]; at: number }>();
const inflight = new Map<string, Promise<Point[]>>();

// Build the client-facing response from RAW points: drop 2 seeded points
// between each monthly pair (~270 → ~810) so the line reads granular/organic.
// Done on read so tuning densification never requires busting the persistent cache.
function respond(rawPoints: Point[], seedKey: string, tag: string) {
  const points = densifySeries(rawPoints, termSeed(seedKey));
  return NextResponse.json(points, {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400', 'X-Cache': tag },
  });
}

export async function GET(req: NextRequest) {
  const term = req.nextUrl.searchParams.get('term')?.trim();
  if (!term) return NextResponse.json({ error: 'term required' }, { status: 400 });
  // ?refresh=1 forces a fresh upstream pull, bypassing both caches (and writing
  // the result through). Use it to re-pull a term whose data went stale.
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';

  const key = term.toLowerCase();

  if (!refresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return respond(hit.points, key, 'HIT');
  }

  // Deduplicate in-flight requests for the same term
  if (inflight.has(key)) {
    try {
      const points = await inflight.get(key)!;
      return respond(points, key, 'INFLIGHT');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimited = msg.includes('429') || msg.includes('Too Many') || msg.includes('captcha') || msg.includes('CAPTCHA') || msg.includes('<html') || msg.includes('Unexpected token');
      return NextResponse.json({ error: isRateLimited ? 'rate_limited' : msg.slice(0, 200) }, { status: isRateLimited ? 429 : 500 });
    }
  }

  // Track where the owning request ultimately sourced the data, for the X-Cache
  // tag. (In-flight followers always report 'INFLIGHT' above.)
  let servedFrom = 'network';

  const fetchPromise = (async () => {
    // ── Layer 2: persistent Railway cache ───────────────────────────────────
    // Wrapped so a missing/unreachable DB degrades to a normal network pull
    // rather than breaking trends entirely.
    if (!refresh) {
      try {
        const cached = await getCachedTrends(key, DB_TTL_MS);
        if (cached) {
          servedFrom = 'db';
          cache.set(key, { points: cached, at: Date.now() });
          return cached;
        }
      } catch (dbErr: unknown) {
        console.warn(`[trends] db read failed for ${key}:`, (dbErr instanceof Error ? dbErr.message : String(dbErr)).slice(0, 200));
      }
    }

    // ── Layer 3: network pull (free scrape → paid SerpAPI fallback) ─────────
    let points: Point[];
    let source = 'scrape';
    try {
      const cookie = process.env.GOOGLE_TRENDS_COOKIE;
      const raw: string = await googleTrends.interestOverTime({
        keyword:   term,
        startTime: new Date('2004-01-01'),
        endTime:   new Date(),
        ...(cookie ? { cookie } : {}),
      });

      // Google returns HTML when rate-limited / serving a CAPTCHA
      if (raw.trimStart().startsWith('<')) {
        throw new Error('rate_limited');
      }

      // The library may or may not strip the )]}' XSSI prefix
      const json = raw.startsWith(")]}'\n") || raw.startsWith(")]}'")
        ? raw.slice(raw.indexOf('\n') + 1)
        : raw;

      const parsed   = JSON.parse(json) as { default: { timelineData: TimelinePoint[] } };
      const timeline = parsed?.default?.timelineData ?? [];
      if (!timeline.length) throw new Error('no data returned');

      points = timeline.map((p: TimelinePoint) => ({
        timestamp: parseInt(p.time, 10) * 1000,
        value:     p.value[0],
      }));
    } catch (primaryErr: unknown) {
      // Free scrape failed (usually rate-limited / CAPTCHA). Fall back to
      // SerpAPI's paid google_trends engine if a key is configured.
      const fallback = await fetchFromSerpApi(term).catch((serpErr: unknown) => {
        const sm = serpErr instanceof Error ? serpErr.message : String(serpErr);
        console.error(`[trends] serpapi fallback failed for ${term}:`, sm.slice(0, 200));
        return null;
      });
      if (!fallback) throw primaryErr; // surface the original error (e.g. rate_limited)
      console.warn(`[trends] ${term}: primary scrape failed, served via SerpAPI fallback`);
      points = fallback;
      source = 'serpapi';
    }

    // Write through: hot cache now, persist to Railway in the background so a
    // slow/failed DB write never delays or fails the response.
    cache.set(key, { points, at: Date.now() });
    saveTrends(key, points, source).catch((e: unknown) => {
      console.warn(`[trends] db save failed for ${key}:`, (e instanceof Error ? e.message : String(e)).slice(0, 200));
    });

    return points;
  })();

  inflight.set(key, fetchPromise);
  // Suppress unhandledRejection — callers await inside try/catch
  fetchPromise.catch(() => {}).finally(() => inflight.delete(key));

  try {
    const points = await fetchPromise;
    return respond(points, key, servedFrom === 'db' ? 'DB' : refresh ? 'REFRESH' : 'MISS');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trends] ${term}:`, msg.slice(0, 300));
    const isRateLimited =
      msg === 'rate_limited' ||
      msg.includes('429') || msg.includes('Too Many') ||
      msg.includes('captcha') || msg.includes('CAPTCHA');
    if (isRateLimited) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
