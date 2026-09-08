// GET /api/vids — the whole library (folders + videos) in one shot. Small enough
// to send whole; the client builds the tree itself.
import { NextResponse } from 'next/server';
import { errMessage, listLibrary } from '@/lib/vids-db';

// pg can't run on the Edge runtime; pin to Node.
export const runtime = 'nodejs';
// Never cache — the library is shared and changes constantly.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listLibrary());
  } catch (err) {
    console.error('[vids GET]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
