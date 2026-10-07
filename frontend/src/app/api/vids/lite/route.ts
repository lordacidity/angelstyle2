// GET /api/vids/lite — which clips have a lighter copy, and how big each is.
// For scripts/make-lite.mjs: the library does not say (the Studio is always
// handed a clip's own file), and the script has to know what it has done.
// The Studio's alone: not in the clipper allowlist (middleware).
import { NextResponse } from 'next/server';
import { errMessage, listLite } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listLite());
  } catch (err) {
    console.error('[vids lite GET]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
