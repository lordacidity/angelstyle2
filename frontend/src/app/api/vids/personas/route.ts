// POST /api/vids/personas { name, degen, startId?, topAId?, topBId? } — create a
// persona, the Start + Top A + Top B bundle a build picks in one go. The three clip
// ids are optional so a persona can be named first and filled in as its uploads
// land. Degen is not: whoever makes a persona says whether it is degen.
import { NextRequest, NextResponse } from 'next/server';
import { createPersona, errMessage, type PersonaPatch } from '@/lib/vids-db';
import { readParts } from './parts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (typeof body.degen !== 'boolean') {
    return NextResponse.json({ error: 'say whether the persona is degen (degen: true or false)' }, { status: 400 });
  }

  const patch: PersonaPatch = { degen: body.degen };
  const bad = readParts(body, patch);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    return NextResponse.json(await createPersona(name, patch));
  } catch (err) {
    console.error('[vids personas POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
