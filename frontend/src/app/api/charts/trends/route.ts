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
    // 429 from Google — bubble up so the client can show a fallback
    if (msg.includes('429') || msg.includes('Too Many')) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
