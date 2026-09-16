// GET /api/ai-persona/file?url=…&name=… — save the mp3 or the mp4.
//
// The two files live on fal.media, and a browser ignores <a download> across
// origins: the link would open the video in a tab instead of saving it. So the
// bytes come back through here, same-origin, with the filename attached.
//
// Only fal's own hosts are fetched — this is not a general proxy.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function isFalUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && /(^|\.)fal\.(media|ai|run)$/.test(hostname);
  } catch {
    return false;
  }
}

/** Keep it to something a filesystem will take, and keep the extension. */
function safeName(name: string | null, fallback: string): string {
  const cleaned = (name || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return cleaned || fallback;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url is required.' }, { status: 400 });
  if (!isFalUrl(url)) return NextResponse.json({ error: 'Only fal.media files can be fetched here.' }, { status: 403 });

  const upstream = await fetch(url).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json({ error: `fal did not serve that file (${upstream?.status ?? 'no response'}).` }, { status: 502 });
  }

  const name = safeName(req.nextUrl.searchParams.get('name'), 'ai-persona');
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
      'Cache-Control': 'no-store',
    },
  });
}
