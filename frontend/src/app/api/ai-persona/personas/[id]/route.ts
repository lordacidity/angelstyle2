// /api/ai-persona/personas/:id
//
//   PATCH { name?, photoPath? }  -> rename, or swap the character photo — the
//                                   two things a persona has
//   DELETE                       -> the persona, its photo and its videos
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { deletePersona, isPhotoPath, updatePersona } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
import { MAX_NAME_CHARS } from '@/lib/aipersona/types';
import { isUuid } from '@/lib/vids-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: { name?: string; photoPath?: string } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_CHARS) : '';
    if (!name) return refuse('The name cannot be empty.');
    patch.name = name;
  }
  if (body.photoPath !== undefined) {
    if (!isPhotoPath(body.photoPath)) return refuse('That is not an uploaded character photo.');
    patch.photoPath = body.photoPath;
  }
  if (!patch.name && !patch.photoPath) return refuse('Nothing to update.');

  try {
    const persona = await updatePersona(id, patch);
    return persona ? NextResponse.json(persona) : refuse('That character no longer exists.', 404);
  } catch (err) {
    return fail('personas PATCH', err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return refuse('bad id');
  try {
    return (await deletePersona(id)) ? NextResponse.json({ ok: true }) : refuse('That character no longer exists.', 404);
  } catch (err) {
    return fail('personas DELETE', err);
  }
}
