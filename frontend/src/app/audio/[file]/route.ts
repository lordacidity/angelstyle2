// GET /audio/<track-custom-….mp3> — a song added on the Music page, which is in
// the Vids bucket rather than public/audio (see lib/audio-library). Next serves
// public/ before any dynamic route, so the songs that ship with the app never
// reach this; only a name that isn't on disk does, and it is sent on to the
// bucket. So every song keeps the one address, /audio/<file>, that its name,
// its degen mark and its clipper switch are all keyed by.
//
// It goes to a signed URL, not the public one: the public URL's CDN keeps a
// song for five minutes whatever the query says, so a song trimmed in place
// kept playing (and showing in the trim editor) as it was before, while the
// next trim was cut from the new file.
import { NextRequest, NextResponse } from 'next/server';
import { trackFileOf } from '@/lib/audio-library';
import { errMessage, freshUrl, musicObject } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const file = trackFileOf(`/audio/${(await params).file}`);
  if (!file) return new NextResponse('Not found', { status: 404 });
  let url: string;
  try {
    url = await freshUrl(musicObject(file));
  } catch (err) {
    console.error('[audio]', errMessage(err));
    return new NextResponse('Not found', { status: 404 });
  }
  // Not cached: a trim in place writes over the same name.
  return NextResponse.redirect(url, { status: 307, headers: { 'cache-control': 'no-store' } });
}
