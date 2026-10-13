// /api/ai-persona/saved/:id
//
//   PATCH { name?, action? }  -> rename a saved scene, or rewrite the sentence
//                      saying what happens in it. Its name is also what sorts
//                      it: one with "trading" in it is a Trading scene, one
//                      with "end" an End, anything else a Hook (sceneKind).
//   DELETE          -> the saved scene and its files. Scenes already made from
//                      it carry their own copies and stay as they are.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { deleteSaved, updateSaved } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
import { MAX_NAME_CHARS, cleanAction } from '@/lib/aipersona/types';
import { isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const GONE = 'That saved scene no longer exists.';

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { name?: string; action?: string } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_CHARS) : '';
    if (!name) return refuse('The name cannot be empty.');
    patch.name = name;
  }
  if (body.action !== undefined) patch.action = cleanAction(body.action);
  if (patch.name === undefined && patch.action === undefined) return refuse('Nothing to update.');
  try {
    const saved = await updateSaved(id, patch);
    return saved ? NextResponse.json(saved) : refuse(GONE, 404);
  } catch (err) {
    return fail('saved PATCH', err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  try {
    return (await deleteSaved(id)) ? NextResponse.json({ ok: true }) : refuse(GONE, 404);
  } catch (err) {
    return fail('saved DELETE', err);
  }
}
