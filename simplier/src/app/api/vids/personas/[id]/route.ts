// /api/vids/personas/:id — rename, re-point a part, say what the bundle is
// showing, or put it on offer to the clippers (PATCH { name?, startId?,
// topAId?, topBId?, context?, clipable? }), or delete the bundle (DELETE).
// Deleting drops only the persona; its clips stay in the Persona folder as
// unassigned footage.
import { NextRequest, NextResponse } from 'next/server';
import { deletePersona, errMessage, isUuid, updatePersona, type PersonaPatch } from '@/lib/vids-db';
import { readClipablePatch, readContextPatch } from '@/lib/vids-types';
import { readParts } from '../parts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: PersonaPatch = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    patch.name = name;
  }
  const bad = readParts(body, patch);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  readContextPatch(body, patch);
  readClipablePatch(body, patch);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }
  try {
    const persona = await updatePersona(id, patch);
    if (!persona) return NextResponse.json({ error: 'persona not found' }, { status: 404 });
    return NextResponse.json(persona);
  } catch (err) {
    console.error('[vids personas PATCH]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    const ok = await deletePersona(id);
    if (!ok) return NextResponse.json({ error: 'persona not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[vids personas DELETE]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
