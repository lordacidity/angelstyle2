// /api/ai-persona/personas
//
//   GET                       -> everything the front screen shows: the personas,
//                                each with its saved videos, and the scenes
//                                still in progress
//   POST { name, photoPath }  -> a new persona. The photo is already in the
//                                bucket: the browser put it there on a signed
//                                URL from POST /api/ai-persona/upload.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { createPersona, getLibrary, isPhotoPath } from '@/lib/aipersona/db';
import { fail, refuse } from '@/lib/aipersona/respond';
import { MAX_NAME_CHARS } from '@/lib/aipersona/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getLibrary());
  } catch (err) {
    return fail('personas GET', err);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_CHARS) : '';
  if (!name) return refuse('A character needs a name.');
  if (!isPhotoPath(body.photoPath)) return refuse('A character needs a photo.');
  try {
    return NextResponse.json(await createPersona(name, body.photoPath));
  } catch (err) {
    return fail('personas POST', err);
  }
}
