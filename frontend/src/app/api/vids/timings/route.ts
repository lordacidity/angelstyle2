// /api/vids/timings — how long each Download took, and on what.
//
//   POST { totalMs, stages, device }  one video, as the page saw it land
//                                     (lib/vids2/timing)
//   GET  ?limit=                      the last few hundred, newest first
//
// Nothing reads these but a person: they are what says whether a phone's wait
// is the recordings, the words or the render, and whether a change moved it.
// POST is in the clipper allowlist (middleware); GET answers there too, and
// carries nothing but numbers and a browser's description of itself.
import { NextRequest, NextResponse } from 'next/server';
import { CLIPPERS } from '@/lib/clipping';
import { addRenderTiming, errMessage, listRenderTimings } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A flat object of numbers, strings and booleans, cut to size: what a page
 *  says about itself is taken as said, but not at any length. */
function flat(v: unknown, maxKeys: number): Record<string, number | string | boolean> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, number | string | boolean> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, maxKeys)) {
    const key = k.slice(0, 40);
    if (typeof x === 'number' && Number.isFinite(x)) out[key] = Math.round(x * 100) / 100;
    else if (typeof x === 'boolean') out[key] = x;
    else if (typeof x === 'string') out[key] = x.slice(0, 300);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const totalMs = typeof body.totalMs === 'number' && body.totalMs >= 0 && body.totalMs < 3_600_000 ? body.totalMs : null;
  const stages = flat(body.stages, 30);
  const device = flat(body.device, 20);
  if (totalMs == null || !stages || !device) return NextResponse.json({ error: 'totalMs, stages and device are all needed' }, { status: 400 });
  try {
    await addRenderTiming({ app: CLIPPERS ? 'clippers' : 'studio', totalMs, stages, device });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[vids timings POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const limit = Math.min(1000, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 200));
  try {
    return NextResponse.json(await listRenderTimings(limit));
  } catch (err) {
    console.error('[vids timings GET]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
