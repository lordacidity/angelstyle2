// /api/aiden/ingest — write to the log by NAME (POST).
//
// Made for Parvis and anything else that writes from outside the page and so
// knows names, not ids. One request can carry a whole batch:
//
//   {
//     "places": [{ "name": "SF" }],
//     "firms":  [{ "name": "Sequoia", "kind": "vc", "place": "SF", "notes": "..." }],
//     "people": [{ "name": "Jane Doe", "title": "Partner", "firm": "Sequoia",
//                  "place": "SF", "warmth": "warm", "tags": ["seed"], "bio": "..." }],
//     "links":  [{ "a": "Jane Doe", "b": "John Roe", "kind": "friend", "note": "..." }],
//     "events": [{ "kind": "email", "title": "...", "summary": "...",
//                  "happenedAt": "2026-09-29", "firm": "Sequoia", "place": "SF",
//                  "people": ["Jane Doe", { "name": "John Roe", "role": "host" }],
//                  "followUpAt": "2026-10-06" }],
//     "goals":  [{ "title": "...", "body": "...", "dueAt": "2026-12-01" }],
//     "notes":  [{ "title": "...", "body": "..." }]
//   }
//
// Every name is found or made, and the batch lands whole or not at all. How
// names are matched, and what counts as the same event sent twice, is written
// up where it is done: `ingest` in lib/aiden-db.
import { NextRequest, NextResponse } from 'next/server';
import { aidenLocked, isAidenUnlocked } from '@/lib/aiden-auth';
import { AidenBusyError, AidenInputError, ingest } from '@/lib/aiden-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  try {
    return NextResponse.json(await ingest(await req.json().catch(() => ({}))));
  } catch (err) {
    if (err instanceof AidenInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // One batch at a time (lib/aiden-db). This one was never started.
    if (err instanceof AidenBusyError) {
      return NextResponse.json({ error: err.message, busy: true }, { status: 409 });
    }
    console.error('[aiden ingest]', err);
    return NextResponse.json({ error: 'failed to save' }, { status: 500 });
  }
}
