// POST /api/hyperattention/push — the Publish panel's one call, in both its
// modes:
//   dryRun: true   — resolve the schedule and hand it back for the Preview
//                     grid. No media import, no /queue call: nothing happens
//                     on the Hyper Attention side yet.
//   dryRun: false   — import the video by URL, resolve the schedule again
//                     (queue state can't have moved between Preview and
//                     Confirm in practice, but re-resolving is cheap and
//                     correct either way), and batch every post into one
//                     POST /queue call.
//
// Studio-only: absent from middleware.ts's CLIPPER_API allowlist, so this
// 404s on the pauv.io/clipping build no matter what the client sends.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  HyperAttentionError, importMediaFromUrl, listQueue, queuePosts,
  type HAPostType, type QueuePostInput,
} from '@/lib/hyperattention';
import { checkManualSlots, computeAutoSlots, type SlotRequest } from '@/lib/hyperattention-schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Schema = z.object({
  // Optional in dryRun — Preview only resolves the schedule, it never
  // imports media, so the client doesn't need to have uploaded anything yet.
  videoUrl: z.string().url().optional(),
  videoName: z.string().min(1).optional(),
  accountIds: z.array(z.string().min(1)).min(1, 'pick at least one account'),
  postTypes: z.array(z.enum(['reel', 'story'])).min(1, 'pick at least one post type'),
  mode: z.enum(['auto', 'manual']),
  scheduledFor: z.string().datetime().optional(),
  caption: z.string().optional(),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
    }
    const { videoUrl, videoName, accountIds, postTypes, mode, scheduledFor, caption, dryRun } = parsed.data;
    if (mode === 'manual' && !scheduledFor) {
      return NextResponse.json({ error: 'scheduledFor is required in manual mode' }, { status: 400 });
    }
    if (!dryRun && (!videoUrl || !videoName)) {
      return NextResponse.json({ error: 'videoUrl and videoName are required to queue (only optional for dryRun previews)' }, { status: 400 });
    }

    // Every (account, postType) pair, in a stable order so Auto's day-by-day
    // reservation lands the same way in Preview and in the real Confirm.
    const requests: SlotRequest[] = [];
    for (const accountId of accountIds) {
      for (const postType of postTypes as HAPostType[]) {
        requests.push({ accountId, postType });
      }
    }

    // One /queue fetch per distinct account, merged for the scheduler.
    const existingQueue = (
      await Promise.all(accountIds.map((accountId) => listQueue({ accountId, status: 'queued,posted' })))
    ).flat();

    const slots = mode === 'auto'
      ? computeAutoSlots(requests, existingQueue)
      : checkManualSlots(requests, scheduledFor!, existingQueue);

    if (dryRun) {
      return NextResponse.json({ slots });
    }

    // Guarded above: !dryRun requires both to be present.
    const media = await importMediaFromUrl(videoUrl!, videoName!);
    const items: QueuePostInput[] = slots.map((s) => ({
      accountId: s.accountId,
      scheduledFor: s.scheduledFor,
      postType: s.postType,
      videoId: media.id,
      ...(caption ? { caption } : {}),
    }));
    const result = await queuePosts(items);
    return NextResponse.json({ posts: result.posts, requestId: result.requestId, slots });
  } catch (err) {
    if (err instanceof HyperAttentionError) {
      return NextResponse.json(
        { error: err.message, requestId: err.requestId, details: err.details },
        { status: err.status },
      );
    }
    console.error('[hyperattention push POST]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
