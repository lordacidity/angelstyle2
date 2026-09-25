// GET /api/hyperattention/overview — everything the Hyper Attention section
// watches, in one call: the accounts on the key, every post queued onto them
// (queued, posted and failed alike), the videos uploaded to Hyper Attention,
// and — when the plan has the Stats add-on — each account's follower and view
// counts. Studio-only: absent from middleware.ts's CLIPPER_API allowlist, so it
// 404s on the pauv.io/clipping build. Never forwards the key to the client.
//
// Accounts and the queue are the section; the call fails if either does. The
// media list and the stats are extras, so either coming back 403 (a key
// without media:read, a plan without the Stats add-on) is reported in place
// rather than taking the page down.
import { NextResponse } from 'next/server';
import {
  HyperAttentionError, listAccounts, listMedia, listQueueAll, listStatsAccounts,
} from '@/lib/hyperattention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET() {
  try {
    const [accounts, queue, media, stats] = await Promise.all([
      listAccounts(),
      listQueueAll({}, 5),
      listMedia(2).then((m) => ({ items: m, error: null as string | null }))
        .catch((e) => ({ items: null, error: reason(e) })),
      listStatsAccounts().then((s) => ({ accounts: s, error: null as string | null }))
        .catch((e) => ({ accounts: null, error: reason(e) })),
    ]);
    return NextResponse.json({ accounts, queue, media, stats, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof HyperAttentionError) {
      return NextResponse.json(
        { error: err.message, requestId: err.requestId, details: err.details },
        { status: err.status },
      );
    }
    console.error('[hyperattention overview GET]', err);
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }
}
