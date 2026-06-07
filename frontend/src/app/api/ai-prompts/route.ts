// List the 15 AI-Prompt topic slots (with their saved overviews) from Railway.
// The table self-creates + self-seeds on first read, so a fresh DB returns 15
// blank rows.

import { NextResponse } from 'next/server';
import { listPrompts } from '@/lib/ai-prompts-db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await listPrompts());
  } catch (err) {
    console.error('[ai-prompts GET]', err);
    return NextResponse.json({ error: 'failed to load prompts' }, { status: 500 });
  }
}
