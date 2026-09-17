// News photos: thumbnails for the side column's headlines, one per headline:
// Pauv people and stock scenes (see lib/news/free-photos.ts).
//   POST /api/news/photos/thumbs  { outlet, headlines, name? }  →  ThumbPhotosResponse
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { thumbPhotos } from '@/lib/news/free-photos';
import { isOutletId } from '@/lib/news/outlets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  outlet: z.string().refine(isOutletId),
  headlines: z.array(z.string().max(300)).max(16),
  /** The page's own subject, kept out of the random people. */
  name: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'An outlet and its headlines are required.' }, { status: 400 });
  const { outlet, headlines, name } = parsed.data;
  if (!isOutletId(outlet)) return NextResponse.json({ error: 'Unknown outlet.' }, { status: 400 });
  try {
    return NextResponse.json(await thumbPhotos(outlet, headlines, name));
  } catch (err) {
    return NextResponse.json({ error: `Thumbnail search failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
