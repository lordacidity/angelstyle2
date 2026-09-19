// News trending: fresh stories from the approved outlets whose headlines name
// somebody on Pauv, newest first — nobody searched for, everybody looked for.
//   GET /api/news/trending?window=24h   (1h, 6h, 24h or 7d)
//
// What Vids 2's "Choose by news" opens on. The reading, the name matching and
// the AI's check are lib/news/trending.
import { NextRequest, NextResponse } from 'next/server';
import { isTrendWindow, trendingNews } from '@/lib/news/trending';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const w = req.nextUrl.searchParams.get('window');
  // A category somebody typed, put to Google with the headlines rather than
  // used to sift them afterwards — what "Search wider" sends when filtering
  // the list already on the page came up short. Capped because it goes into a
  // search query, and blank means the ordinary list.
  const topic = (req.nextUrl.searchParams.get('topic') ?? '').trim().slice(0, 60);
  try {
    return NextResponse.json(await trendingNews(isTrendWindow(w) ? w : '24h', topic));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
