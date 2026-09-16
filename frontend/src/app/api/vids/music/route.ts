// PATCH /api/vids/music { url, label?, degen? } — call a song something else,
// or mark it degen (or back to just a song). The audio library names its
// tracks in code; the name given here is kept in the database and stands in
// for that wherever the library is listed (see listTrackNames in vids-db and
// /api/charts/list-audio), so it is the name on Build's Sound rail, in the
// charts and carousel pickers, and on the Clippers page alike. A build exported
// after this writes the new name down.
//
// Degen is set from the Music page. Either field can come alone; one that
// isn't sent is left as it was.
import { NextRequest, NextResponse } from 'next/server';
import { errMessage, setTrackDegen, setTrackName } from '@/lib/vids-db';
import { trackExists } from '@/lib/audio-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TRACK_LABEL = 120;

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !trackExists(url)) return NextResponse.json({ error: 'no song at that url' }, { status: 404 });
  const hasLabel = 'label' in body;
  const hasDegen = 'degen' in body;
  if (!hasLabel && !hasDegen) return NextResponse.json({ error: 'label or degen required' }, { status: 400 });
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, MAX_TRACK_LABEL) : '';
  if (hasLabel && !label) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 });
  const degen = body.degen;
  if (hasDegen && typeof degen !== 'boolean') return NextResponse.json({ error: 'degen must be true or false' }, { status: 400 });
  try {
    if (hasLabel) await setTrackName(url, label);
    if (typeof degen === 'boolean') await setTrackDegen(url, degen);
    return NextResponse.json({ url, ...(hasLabel ? { label } : {}), ...(hasDegen ? { degen } : {}) });
  } catch (err) {
    console.error('[vids music PATCH]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
