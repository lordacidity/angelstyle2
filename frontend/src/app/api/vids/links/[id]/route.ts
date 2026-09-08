// PUT /api/vids/links/:id { bottomBIds: string[] } — the Bottom Bs that follow
// on from this Bottom A, replaced as a set. The reply is the pairs as they now
// stand for that Bottom A (ids that weren't clips are dropped, not refused).
import { NextRequest, NextResponse } from 'next/server';
import { errMessage, isUuid, setLinks } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** More than a Bottom A could sensibly lead on to — a guard, not a design. */
const MAX_LINKS = 500;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = body.bottomBIds;
  if (!Array.isArray(raw) || raw.length > MAX_LINKS || !raw.every(isUuid)) {
    return NextResponse.json({ error: 'bottomBIds must be a list of video ids' }, { status: 400 });
  }
  try {
    const links = await setLinks(id, raw);
    if (!links) return NextResponse.json({ error: 'video not found' }, { status: 404 });
    return NextResponse.json(links);
  } catch (err) {
    console.error('[vids links PUT]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
