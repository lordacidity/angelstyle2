import { NextRequest, NextResponse } from 'next/server';
// @ts-expect-error — no @types package for google-trends-api
import googleTrends from 'google-trends-api';

interface TimelinePoint {
  time: string;
  value: number[];
  formattedTime: string;
}

// In-process cache — survives for the lifetime of the server process.
// Keyed by term (lowercased). TTL: 24 hours (trends data moves slowly).
const CACHE_TTL_MS   = 24 * 60 * 60 * 1000;

const cache    = new Map<string, { points: Array<{ timestamp: number; value: number }>; at: number }>();
const inflight = new Map<string, Promise<Array<{ timestamp: number; value: number }>>>();

export async function GET(req: NextRequest) {
  const term = req.nextUrl.searchParams.get('term')?.trim();
  if (!term) return NextResponse.json({ error: 'term required' }, { status: 400 });

  const key = term.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.points, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600', 'X-Cache': 'HIT' },
    });
  }

  // Deduplicate in-flight requests for the same term
  if (inflight.has(key)) {
    try {
      const points = await inflight.get(key)!;
      return NextResponse.json(points, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400', 'X-Cache': 'INFLIGHT' } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimited = msg.includes('429') || msg.includes('Too Many') || msg.includes('captcha') || msg.includes('CAPTCHA') || msg.includes('<html') || msg.includes('Unexpected token');
      return NextResponse.json({ error: isRateLimited ? 'rate_limited' : msg.slice(0, 200) }, { status: isRateLimited ? 429 : 500 });
    }
  }

  const fetchPromise = (async () => {
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

    const points = timeline.map((p: TimelinePoint) => ({
      timestamp: parseInt(p.time, 10) * 1000,
      value:     p.value[0],
    }));

    cache.set(key, { points, at: Date.now() });
    return points;
  })();

  inflight.set(key, fetchPromise);
  // Suppress unhandledRejection — callers await inside try/catch
  fetchPromise.catch(() => {}).finally(() => inflight.delete(key));

  try {
    const points = await fetchPromise;
    return NextResponse.json(points, {
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
    });
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
