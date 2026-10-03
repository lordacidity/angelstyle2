// /api/aiden/:entity — add a row (POST).
// :entity is one of places | firms | people | events | links | rounds | goals | notes,
// checked against the allowlist. Reads come whole, from /api/aiden/data.
import { NextRequest, NextResponse } from 'next/server';
import { aidenLocked, isAidenUnlocked } from '@/lib/aiden-auth';
import { AidenInputError, createRow } from '@/lib/aiden-db';
import { isAidenEntity } from '@/lib/aiden-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  const { entity } = await params;
  if (!isAidenEntity(entity)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    return NextResponse.json(await createRow(entity, await req.json().catch(() => ({}))));
  } catch (err) {
    if (err instanceof AidenInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[aiden POST]', err);
    return NextResponse.json({ error: 'failed to save' }, { status: 500 });
  }
}
