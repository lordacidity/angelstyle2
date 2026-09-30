// /api/aiden/:entity/:id — edit a row (PATCH) or delete it (DELETE).
import { NextRequest, NextResponse } from 'next/server';
import { aidenLocked, isAidenUnlocked } from '@/lib/aiden-auth';
import { AidenInputError, deleteRow, isUuid, updateRow } from '@/lib/aiden-db';
import { isAidenEntity } from '@/lib/aiden-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ entity: string; id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  const { entity, id } = await params;
  if (!isAidenEntity(entity) || !isUuid(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const ok = await updateRow(entity, id, await req.json().catch(() => ({})));
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AidenInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[aiden PATCH]', err);
    return NextResponse.json({ error: 'failed to save' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  const { entity, id } = await params;
  if (!isAidenEntity(entity) || !isUuid(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const ok = await deleteRow(entity, id);
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[aiden DELETE]', err);
    return NextResponse.json({ error: 'failed to delete' }, { status: 500 });
  }
}
