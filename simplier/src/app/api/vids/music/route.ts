// PATCH /api/vids/music { url, label } — call a song something else. The
// audio library names its tracks in code; the name given here is kept in the
// database and stands in for that wherever the library is listed (see
// listTrackNames in vids-db and /api/charts/list-audio), so it is the name on
// Build's Sound rail, in the charts and carousel pickers, and on the Clippers
// page alike. A build exported after this writes the new name down.
import { NextRequest, NextResponse } from 'next/server';
import { errMessage, setTrackName } from '@/lib/vids-db';
import { trackExists } from '@/lib/audio-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TRACK_LABEL = 120;

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !trackExists(url)) return NextResponse.json({ error: 'no song at that url' }, { status: 404 });
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, MAX_TRACK_LABEL) : '';
  if (!label) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 });
  try {
    await setTrackName(url, label);
    return NextResponse.json({ url, label });
  } catch (err) {
    console.error('[vids music PATCH]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
