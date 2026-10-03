// /api/aiden/context — the whole log as text (GET): the same brief the chat
// reads before every answer. For a reader that wants the network in one piece
// without walking the JSON.
import { NextRequest, NextResponse } from 'next/server';
import { aidenLocked, isAidenUnlocked } from '@/lib/aiden-auth';
import { buildAidenContext } from '@/lib/aiden-context';
import { readSnapshot } from '@/lib/aiden-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  try {
    const snap = await readSnapshot();
    return NextResponse.json({
      text: buildAidenContext(snap),
      counts: {
        places: snap.places.length,
        firms: snap.firms.length,
        people: snap.people.length,
        events: snap.events.length,
        links: snap.links.length,
        rounds: snap.rounds.length,
        goals: snap.goals.length,
        notes: snap.notes.length,
      },
    });
  } catch (err) {
    console.error('[aiden context]', err);
    return NextResponse.json({ error: 'failed to load' }, { status: 500 });
  }
}
