// GET /api/hyperattention/accounts — the accounts the Publish panel picks
// from. Studio-only: this route is deliberately absent from middleware.ts's
// CLIPPER_API allowlist, so it 404s on the pauv.io/clipping build regardless
// of what the UI does. Never forwards the Hyper Attention key to the client.
import { NextResponse } from 'next/server';
import { listAccounts } from '@/lib/hyperattention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const accounts = await listAccounts();
    // Vids 2 only ever produces a single vertical video (never a slideshow),
    // so a TikTok account — which the API says omits postType entirely — has
    // nothing to pick here yet. Scope to Instagram until that changes.
    const instagram = accounts.filter((a) => a.platform === 'instagram');
    return NextResponse.json({ accounts: instagram });
  } catch (err) {
    console.error('[hyperattention accounts GET]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
