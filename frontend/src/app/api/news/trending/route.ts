// News trending: fresh stories from the approved outlets whose headlines name
// somebody on Pauv, newest first — nobody searched for, everybody looked for.
//   GET /api/news/trending?window=24h   (1h, 6h, 24h or 7d)
//
// What Vids 2's "Choose by news" opens on. The reading, the name matching and
// the AI's check are lib/news/trending; the list is kept between readers by
// lib/news/trending-cache, so the read is paid for once and everybody after
// gets it at once. `fresh=1` (the form's ↻) reads it again regardless.
import { NextRequest, NextResponse, after } from 'next/server';
import { isTrendWindow } from '@/lib/news/trending';
import { getTrending } from '@/lib/news/trending-cache';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const w = req.nextUrl.searchParams.get('window');
  // A category somebody typed, put to Google with the headlines rather than
  // used to sift them afterwards — what "Search wider" sends when filtering
  // the list already on the page came up short. Capped because it goes into a
  // search query, and blank means the ordinary list.
  const topic = (req.nextUrl.searchParams.get('topic') ?? '').trim().slice(0, 60);
  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  try {
    const { response, refresh } = await getTrending(isTrendWindow(w) ? w : '24h', topic, fresh);
    // A stale list went out just now; the next reader gets a fresh one. Run
    // once the reply is on its way rather than before it.
    if (refresh) after(refresh);
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
