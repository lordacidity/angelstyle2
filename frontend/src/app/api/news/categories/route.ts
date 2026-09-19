// What the category box suggests: every industry Pauv files people under and
// every finer grain beneath it, with how many are in each.
//   GET /api/news/categories
//
// Read off the roster itself (lib/news/pauv-people, kept an hour), so the box
// can never offer a category nobody is in, and can say how thin one is —
// "Cycling · 7" — before anybody types it and finds out the hard way.
import { NextResponse } from 'next/server';
import { newsCategories } from '@/lib/news/categories';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ categories: await newsCategories() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
