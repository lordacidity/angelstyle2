// Save the editable fields for one AI-Prompt slot — the topic text (autosave on
// blur) and/or its athlete/artist category. The overview is written by the
// /generate sub-route, not here.

import { NextRequest, NextResponse } from 'next/server';
import { updatePrompt, isPromptCategory } from '@/lib/ai-prompts-db';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { topic?: unknown; category?: unknown };

    const patch: { topic?: string; category?: 'athlete' | 'artist' } = {};
    if (body.topic !== undefined) {
      if (typeof body.topic !== 'string') {
        return NextResponse.json({ error: 'topic must be a string' }, { status: 400 });
      }
      patch.topic = body.topic;
    }
    if (body.category !== undefined) {
      if (!isPromptCategory(body.category)) {
        return NextResponse.json({ error: 'category must be "athlete" or "artist"' }, { status: 400 });
      }
      patch.category = body.category;
    }

    const row = await updatePrompt(id, patch);
    if (!row) return NextResponse.json({ error: 'prompt not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[ai-prompts PATCH]', err);
    return NextResponse.json({ error: 'failed to save' }, { status: 500 });
  }
}
