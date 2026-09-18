// News trending: fresh stories from the approved outlets whose headlines name
// somebody on Pauv, newest first — nobody searched for, everybody looked for.
//   GET /api/news/trending?window=24h   (24h, 6h or 1h)
//
// What Vids 2's "Choose by news" opens on. The reading, the name matching and
// the AI's check are lib/news/trending.
import { NextRequest, NextResponse } from 'next/server';
import { isTrendWindow, trendingNews } from '@/lib/news/trending';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const w = req.nextUrl.searchParams.get('window');
  try {
    return NextResponse.json(await trendingNews(isTrendWindow(w) ? w : '24h'));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
