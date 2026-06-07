import { NextRequest, NextResponse } from 'next/server';
// @ts-expect-error — no @types package for google-trends-api
import googleTrends from 'google-trends-api';

interface TimelinePoint {
  time: string;            // Unix seconds as string
  value: number[];         // [0-100]
  formattedTime: string;
}

export async function GET(req: NextRequest) {
  const term = req.nextUrl.searchParams.get('term')?.trim();
  if (!term) return NextResponse.json({ error: 'term required' }, { status: 400 });

  try {
    const raw: string = await googleTrends.interestOverTime({
      keyword: term,
      startTime: new Date('2004-01-01'),
      endTime:   new Date(),
    });

    const parsed = JSON.parse(raw) as { default: { timelineData: TimelinePoint[] } };
    const timeline = parsed?.default?.timelineData ?? [];

    if (!timeline.length) {
      return NextResponse.json({ error: 'no data returned' }, { status: 404 });
    }

    const points = timeline.map((p: TimelinePoint) => ({
      timestamp: parseInt(p.time, 10) * 1000, // seconds → ms
      value:     p.value[0],                   // 0-100
    }));

    return NextResponse.json(points, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trends] ${term}:`, msg.slice(0, 300));
    // Google returns an HTML block page when rate-limiting — JSON.parse throws on the "<html" token
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
