// News search: article pages about a name from the approved outlets only.
//   GET /api/news/search?q=Macklemore&outlets=espn,cnn&range=30d
import { NextRequest, NextResponse } from 'next/server';
import { searchApprovedNews, type NewsRange } from '@/lib/news/google-news';
import { OUTLET_IDS, isOutletId } from '@/lib/news/outlets';

export const runtime = 'nodejs';

const RANGES: NewsRange[] = ['1d', '7d', '30d', 'any'];

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ error: 'Type a name to search for.' }, { status: 400 });
  const outlets = (req.nextUrl.searchParams.get('outlets') ?? '').split(',').filter(isOutletId);
  const rangeParam = req.nextUrl.searchParams.get('range') as NewsRange | null;
  const range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : '30d';
  try {
    const hits = await searchApprovedNews(q, outlets.length ? outlets : OUTLET_IDS, range);
    return NextResponse.json({ hits });
  } catch (err) {
    return NextResponse.json({ error: `Search failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
