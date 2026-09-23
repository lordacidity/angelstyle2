// Pure scheduling logic for Hyper Attention pushes — no fetch, no Date.now()
// baked in as a default so it's trivially testable. Kept apart from
// hyperattention.ts (the I/O) so the slot-picking rule can be reasoned about
// and tested on its own.

import type { HAPostType, HAQueueItem } from './hyperattention';

export interface SlotRequest {
  accountId: string;
  postType: HAPostType;
}

export interface ResolvedSlot extends SlotRequest {
  scheduledFor: string; // ISO-8601
  /** Set when Auto had to push this slot out further than the caller might
   *  expect — e.g. every day this week already has 2 for this account. */
  warning?: string;
}

const MAX_POSTS_PER_DAY = 2;
/** How far Auto is willing to walk forward looking for an open day before
 *  giving up and flagging the slot instead of scheduling it. */
const MAX_LOOKAHEAD_DAYS = 30;

function utcDateKey(iso: string): string {
  return iso.slice(0, 10); // ISO-8601 dates sort/compare as strings
}

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** For each requested (accountId, postType) pair, find the earliest UTC day
 *  that account has fewer than MAX_POSTS_PER_DAY posts already counted
 *  (queued or posted — a failed post never went out, so it doesn't hold a
 *  slot). Requests are resolved in order and reserve their day immediately,
 *  so several requests for the same account in one batch land on different
 *  days rather than colliding. `now` is injectable for tests. */
export function computeAutoSlots(
  requests: SlotRequest[],
  existingQueue: HAQueueItem[],
  now: Date = new Date(),
): ResolvedSlot[] {
  // dayCounts[accountId][YYYY-MM-DD] = posts already on that day.
  const dayCounts = new Map<string, Map<string, number>>();
  for (const item of existingQueue) {
    if (item.status === 'failed') continue;
    const byDay = dayCounts.get(item.accountId) ?? new Map<string, number>();
    const key = utcDateKey(item.scheduledFor);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
    dayCounts.set(item.accountId, byDay);
  }

  const results: ResolvedSlot[] = [];
  for (const req of requests) {
    const byDay = dayCounts.get(req.accountId) ?? new Map<string, number>();
    dayCounts.set(req.accountId, byDay);

    let chosen: Date | null = null;
    for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset++) {
      const candidate = offset === 0 ? now : addDaysUtc(now, offset);
      const key = utcDateKey(candidate.toISOString());
      if ((byDay.get(key) ?? 0) < MAX_POSTS_PER_DAY) {
        chosen = candidate;
        byDay.set(key, (byDay.get(key) ?? 0) + 1);
        break;
      }
    }

    if (chosen) {
      results.push({ ...req, scheduledFor: chosen.toISOString() });
    } else {
      // Every day in the lookahead window is full — fall back to "now" and
      // flag it; the API's own 400 is the real backstop, but a caller showing
      // the Preview should not be surprised by a scheduling failure.
      results.push({
        ...req,
        scheduledFor: now.toISOString(),
        warning: `This account has no open day in the next ${MAX_LOOKAHEAD_DAYS} days — Hyper Attention will likely reject this slot.`,
      });
    }
  }
  return results;
}

/** Manual mode: the same `scheduledFor` for every requested pair, with a
 *  non-blocking warning on any (account, day) that's already at the cap. */
export function checkManualSlots(
  requests: SlotRequest[],
  scheduledFor: string,
  existingQueue: HAQueueItem[],
): ResolvedSlot[] {
  const dayCounts = new Map<string, number>();
  for (const item of existingQueue) {
    if (item.status === 'failed') continue;
    if (utcDateKey(item.scheduledFor) !== utcDateKey(scheduledFor)) continue;
    dayCounts.set(item.accountId, (dayCounts.get(item.accountId) ?? 0) + 1);
  }
  // Requests for the same account on this manual day also count against each
  // other, in order.
  const pending = new Map<string, number>();
  return requests.map((req) => {
    const already = (dayCounts.get(req.accountId) ?? 0) + (pending.get(req.accountId) ?? 0);
    pending.set(req.accountId, (pending.get(req.accountId) ?? 0) + 1);
    return already >= MAX_POSTS_PER_DAY
      ? { ...req, scheduledFor, warning: `This account already has ${MAX_POSTS_PER_DAY} post(s) on ${utcDateKey(scheduledFor)} — Hyper Attention will likely reject this.` }
      : { ...req, scheduledFor };
  });
}
