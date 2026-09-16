// POST /api/vids/recipes { build, brief } — write a finished build down under a
// new code, titled by the model. The builder calls it as an export starts, in
// parallel with the render, so the name is ready by the time the file is; a
// render that is then cancelled deletes what it minted (see [code]/route.ts).
import { NextRequest, NextResponse } from 'next/server';
import { createRecipe, errMessage } from '@/lib/vids-db';
import type { VidBuildSpec } from '@/lib/vids-types';
import { CreateRecipeSchema } from './spec';
import { writeTitle } from './title';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const parsed = CreateRecipeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join('.')}` : '';
    return NextResponse.json({ error: `bad build${where}: ${first?.message ?? 'invalid'}` }, { status: 400 });
  }
  const build: VidBuildSpec = parsed.data.build;
  if (!Object.values(build.picks).some(Boolean)) {
    return NextResponse.json({ error: 'nothing in the build to write down' }, { status: 400 });
  }
  try {
    const title = await writeTitle(build, parsed.data.brief);
    return NextResponse.json(await createRecipe(title, build));
  } catch (err) {
    console.error('[vids recipes POST]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
