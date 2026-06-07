import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Proxy external images so the canvas can drawImage() without CORS tainting.
// Only fetches image/* content types; rejects anything else.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  try {
    new URL(url); // validate
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*;q=0.8',
      },
    });

    const ct = upstream.headers.get('Content-Type') ?? '';
    if (!upstream.ok || (!ct.startsWith('image/') && !ct.startsWith('application/octet'))) {
      return NextResponse.json({ error: 'not an image' }, { status: 502 });
    }

    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': ct.startsWith('image/') ? ct : 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[image-proxy]', err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
