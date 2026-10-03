// /api/aiden/data — the whole log in one read: places, firms, people, events
// (with who was at each), links, rounds (with the firms in each), goals and notes.
import { NextRequest, NextResponse } from 'next/server';
import { aidenLocked, isAidenUnlocked } from '@/lib/aiden-auth';
import { readSnapshot } from '@/lib/aiden-db';

// pg can't run on the Edge runtime; pin to Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  try {
    return NextResponse.json(await readSnapshot());
  } catch (err) {
    console.error('[aiden data]', err);
    return NextResponse.json({ error: 'failed to load' }, { status: 500 });
  }
}
