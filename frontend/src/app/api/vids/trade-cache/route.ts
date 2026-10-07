// /api/vids/trade-cache — Pauv trade recordings, kept.
//
// The trade recording is drawn in the browser (components/trade/trade-video),
// frame by frame, and on a phone that is a long wait before the video itself
// can be rendered. It is the same recording for everybody who makes a video
// on the same person, the same way, in the same theme — so the first one
// drawn is kept here and the rest are handed it (lib/vids2/trade-cache).
//
// Kept for good: the price on it is the price the day it was drawn, and a
// video is watched weeks after it is made anyway. TRADE_CACHE_VERSION in the
// client is in the key, so a change to how the recording looks starts again.
//
//   GET  ?key=       -> { url, person, seconds, beats, sizeBytes } | 404
//   POST { key }     -> { path, url }   where to PUT a recording just drawn
//   PUT  { key, path, person, seconds, beats, sizeBytes }   it is up: keep it
//
// In the clipper allowlist (middleware): the clipper page reads and writes it.
import { NextRequest, NextResponse } from 'next/server';
import { errMessage, getTradeCache, isTradeCachePath, putTradeCache, signUpload, tradeCachePath } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `v<n>|<name>|up|down|light|dark|<zoom>` — see tradeCacheKey in the client. */
const isKey = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 200 && /^v\d+\|[^|]{1,120}\|(up|down)\|(light|dark)\|[a-z]{1,12}$/.test(v);

const isStretch = (v: unknown): boolean => {
  const s = v as { start?: unknown; end?: unknown } | null;
  return !!s && typeof s.start === 'number' && typeof s.end === 'number' && Number.isFinite(s.start) && Number.isFinite(s.end);
};
const isBeats = (v: unknown): boolean => {
  const b = v as Record<string, unknown> | null;
  return !!b && ['searching', 'analyzing', 'trading', 'confirming'].every((k) => isStretch(b[k]));
};

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (!isKey(key)) return NextResponse.json({ error: 'bad key' }, { status: 400 });
  try {
    const row = await getTradeCache(key);
    return row ? NextResponse.json(row) : NextResponse.json({ error: 'not kept' }, { status: 404 });
  } catch (err) {
    console.error('[vids trade-cache GET]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { key?: unknown };
  if (!isKey(body.key)) return NextResponse.json({ error: 'bad key' }, { status: 400 });
  try {
    // Somebody got there first: nothing to send.
    if (await getTradeCache(body.key)) return NextResponse.json({ error: 'already kept' }, { status: 409 });
    return NextResponse.json(await signUpload(tradeCachePath()));
  } catch (err) {
    console.error('[vids trade-cache POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const person = typeof body.person === 'string' ? body.person.trim().slice(0, 120) : '';
  const seconds = typeof body.seconds === 'number' && body.seconds > 0 && body.seconds < 600 ? body.seconds : 0;
  const sizeBytes = typeof body.sizeBytes === 'number' && body.sizeBytes > 0 ? body.sizeBytes : 0;
  if (!isKey(body.key) || !isTradeCachePath(body.path) || !person || !seconds || !isBeats(body.beats)) {
    return NextResponse.json({ error: 'key, path, person, seconds and beats are all needed' }, { status: 400 });
  }
  try {
    const kept = await putTradeCache({ key: body.key, path: body.path, person, seconds, beats: body.beats, sizeBytes });
    return NextResponse.json({ ok: true, kept });
  } catch (err) {
    console.error('[vids trade-cache PUT]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
