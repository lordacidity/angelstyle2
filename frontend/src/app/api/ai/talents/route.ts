// Pauv's roster with prices — everyone listed, for the pages that open on it
// (the AI persona and carousel pickers, the trade recording, the Vids 2
// search box). Read once and kept for everybody: lib/talents, on lib/kept.
//   GET /api/ai/talents            the whole roster
//   GET /api/ai/talents?slim=1     names, tickers and the three figures the
//                                  Vids 2 search box sorts on — a tenth of
//                                  the bytes, for a phone
//   &fresh=1                       read it again now
import { NextRequest, NextResponse, after } from 'next/server';
import { getTalents, slimTalent } from '@/lib/talents';

export async function GET(req: NextRequest) {
  const slim = req.nextUrl.searchParams.get('slim') === '1';
  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  try {
    const { value, refresh } = await getTalents(fresh);
    // A stale roster went out just now; the next reader gets a fresh one.
    if (refresh) after(refresh);
    return NextResponse.json(slim ? value.map(slimTalent) : value);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
