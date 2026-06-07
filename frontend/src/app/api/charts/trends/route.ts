import { NextRequest, NextResponse } from 'next/server';
// @ts-expect-error — no @types package for google-trends-api
import googleTrends from 'google-trends-api';

interface TimelinePoint {
  time: string;
  value: number[];
  formattedTime: string;
}

// In-process cache — survives for the lifetime of the server process.
// Keyed by term (lowercased). TTL: 1 hour.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { points: Array<{ timestamp: number; value: number }>; at: number }>();

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

  try {
    // Set GOOGLE_TRENDS_COOKIE in your .env to a valid Google cookie string
    // (copy from DevTools → Application → Cookies → google.com while logged in).
    // Without it requests are anonymous and rate-limited quickly.
    const cookie = process.env.GOOGLE_TRENDS_COOKIE;

    const raw: string = await googleTrends.interestOverTime({
      keyword:   term,
      startTime: new Date('2004-01-01'),
      endTime:   new Date(),
      ...(cookie ? { cookie } : {}),
    });

    if (!raw.startsWith(')]}\'')) {
      console.warn(`[trends] unexpected raw prefix for "${term}":`, raw.slice(0, 200));
    }

    const parsed = JSON.parse(raw) as { default: { timelineData: TimelinePoint[] } };
    const timeline = parsed?.default?.timelineData ?? [];

    if (!timeline.length) {
      return NextResponse.json({ error: 'no data returned' }, { status: 404 });
    }

    const points = timeline.map((p: TimelinePoint) => ({
      timestamp: parseInt(p.time, 10) * 1000,
      value:     p.value[0],
    }));

    cache.set(key, { points, at: Date.now() });

    return NextResponse.json(points, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trends] ${term}:`, msg.slice(0, 300));
    const isRateLimited =
      msg.includes('429') || msg.includes('Too Many') ||
      msg.includes('captcha') || msg.includes('CAPTCHA') ||
      msg.includes('<html') || msg.includes('Unexpected token');
    if (isRateLimited) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
