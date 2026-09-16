// /api/vids/recipes/:code — a build by its code: read it back to put it on the
// stage (GET), note the library row a saved one became (PATCH { videoId }), or
// drop one whose export was cancelled before it became a file (DELETE). The
// code is taken in any case and with anything around it, the way it would be
// read off a file name.
import { NextRequest, NextResponse } from 'next/server';
import { deleteRecipe, errMessage, getRecipe, isUuid, linkRecipeVideo } from '@/lib/vids-db';
import { parseRecipeCode } from '@/lib/vids-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

const badCode = () =>
  NextResponse.json({ error: 'A code is six letters and numbers, like K7Q4M2.' }, { status: 400 });

export async function GET(_req: NextRequest, { params }: Ctx) {
  const code = parseRecipeCode((await params).code);
  if (!code) return badCode();
  try {
    const recipe = await getRecipe(code);
    if (!recipe) return NextResponse.json({ error: `No build has the code ${code}.` }, { status: 404 });
    return NextResponse.json(recipe);
  } catch (err) {
    console.error('[vids recipes GET]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const code = parseRecipeCode((await params).code);
  if (!code) return badCode();
  const body = (await req.json().catch(() => ({}))) as { videoId?: unknown };
  const videoId = body.videoId == null ? null : body.videoId;
  if (videoId !== null && !isUuid(videoId)) {
    return NextResponse.json({ error: 'videoId must be a video id or null' }, { status: 400 });
  }
  try {
    const recipe = await linkRecipeVideo(code, videoId);
    if (!recipe) return NextResponse.json({ error: `No build has the code ${code}.` }, { status: 404 });
    return NextResponse.json(recipe);
  } catch (err) {
    console.error('[vids recipes PATCH]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const code = parseRecipeCode((await params).code);
  if (!code) return badCode();
  try {
    const ok = await deleteRecipe(code);
    if (!ok) return NextResponse.json({ error: `No build has the code ${code}.` }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[vids recipes DELETE]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
