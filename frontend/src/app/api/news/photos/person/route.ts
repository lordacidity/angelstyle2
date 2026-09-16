// News photos: free photos of the person searched, best first, with where
// their face is (see lib/news/free-photos.ts).
//   POST /api/news/photos/person  { name }  →  PersonPhotosResponse
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { personPhotos } from '@/lib/news/free-photos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const parsed = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
  try {
    return NextResponse.json(await personPhotos(parsed.data.name));
  } catch (err) {
    return NextResponse.json({ error: `Photo search failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
