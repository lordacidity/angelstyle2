// Studio video export → Phonedeck Incoming. That's the entire job of this
// route now: take the rendered mp4 bytes and forward them as a multipart
// upload to Phonedeck's /api/upload. The "reel catalogue" archive happens
// downstream on the Phonedeck side — per phone, on actual push — so files are
// catalogued by distribution event, not by export event.
//
// Body = raw video bytes. Query: ?name= = desired (pre-extension) filename.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Override via env if Phonedeck is on a different host/port. Default matches
// the local dev setup (server/src/config.ts → PHONEDECK_PORT=8080).
const PHONEDECK_URL = process.env.PHONEDECK_URL ?? 'http://localhost:8080';

function safeName(raw: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70)
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'export';
}

export async function POST(req: NextRequest) {
  try {
    const rawName = new URL(req.url).searchParams.get('name') ?? 'export';
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: 'empty body' }, { status: 400 });
    }

    const filename = `${safeName(rawName)}.mp4`;

    // Forward to Phonedeck. multer handles dedupe ("foo (1).mp4") on its end
    // and the IncomingWatcher picks the file up + pushes a live SSE update.
    const form = new FormData();
    const blob = new Blob([buf], { type: 'video/mp4' });
    form.append('files', blob, filename);
    const r = await fetch(`${PHONEDECK_URL}/api/upload`, { method: 'POST', body: form });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return NextResponse.json({ error: `phonedeck ${r.status}: ${detail}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, filename });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
