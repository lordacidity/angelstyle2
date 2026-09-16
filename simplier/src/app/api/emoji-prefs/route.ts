// Emoji preferences — the custom "@" alias + pinned state for each emoji, stored
// in Railway. GET returns the sparse list of customised emoji; PUT upserts one.
// The table self-creates + self-seeds on first request (the three historic pins).

import { NextRequest, NextResponse } from 'next/server';
import { listEmojiPrefs, upsertEmojiPref, isUnified, normalizeAlias } from '@/lib/emoji-prefs-db';

export const runtime = 'nodejs'; // pg doesn't run on Edge
export const dynamic = 'force-dynamic'; // never cache — prefs change live

export async function GET() {
  try {
    return NextResponse.json(await listEmojiPrefs());
  } catch (err) {
    console.error('[emoji-prefs GET]', err);
    return NextResponse.json({ error: 'failed to load emoji prefs' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      unified?: unknown;
      alias?: unknown;
      pinned?: unknown;
    };

    if (!isUnified(body.unified)) {
      return NextResponse.json({ error: 'unified must be a hex codepoint string' }, { status: 400 });
    }

    const patch: { alias?: string; pinned?: boolean } = {};
    if (body.alias !== undefined) patch.alias = normalizeAlias(body.alias);
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== 'boolean') {
        return NextResponse.json({ error: 'pinned must be a boolean' }, { status: 400 });
      }
      patch.pinned = body.pinned;
    }

    const row = await upsertEmojiPref(body.unified, patch);
    return NextResponse.json(row);
  } catch (err) {
    console.error('[emoji-prefs PUT]', err);
    return NextResponse.json({ error: 'failed to save emoji pref' }, { status: 500 });
  }
}
