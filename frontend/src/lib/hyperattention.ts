// Hyper Attention Partner API client — server-side only. The key
// (HYPERATTENTION_API_KEY) never reaches the browser: every function here is
// called from a Next.js route handler, never from client code.
// https://app.hyperattention.ai/api/openapi
//
// Reads: 500/min, writes: 100/min. On 429 we wait out Retry-After and retry
// once; a 500 gets one blind retry too, per the API's own guidance. Anything
// else (400/401/403/404, or a second failure) surfaces as a HyperAttentionError
// carrying requestId + details[] so a caller can report it usefully.

const BASE_URL = 'https://app.hyperattention.ai/api/partner';

export class HyperAttentionError extends Error {
  status: number;
  requestId: string | null;
  details: Array<{ field?: string; message?: string }>;
  constructor(message: string, status: number, requestId: string | null, details: Array<{ field?: string; message?: string }> = []) {
    super(message);
    this.name = 'HyperAttentionError';
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
  requestId?: string;
  details?: Array<{ field?: string; message?: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function haFetch<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const key = process.env.HYPERATTENTION_API_KEY;
  if (!key) throw new Error('HYPERATTENTION_API_KEY not set');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (res.status === 429 && attempt === 0) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '1');
    await sleep(Math.max(1, retryAfter) * 1000);
    return haFetch<T>(path, init, attempt + 1);
  }
  if (res.status === 500 && attempt === 0) {
    return haFetch<T>(path, init, attempt + 1);
  }

  const json = (await res.json().catch(() => ({}))) as ErrorBody & Record<string, unknown>;
  if (!res.ok) {
    const message = json.message ?? json.error ?? `hyperattention ${res.status}`;
    throw new HyperAttentionError(message, res.status, json.requestId ?? null, json.details ?? []);
  }
  return json as T;
}

export type HAAccountStatus = 'configuring' | 'sent_to_warmup' | 'warming_up' | 'active' | 'paused' | 'burned';
export type HAPlatform = 'tiktok' | 'instagram';
export type HAPostType = 'reel' | 'feed' | 'story' | 'carousel';

export interface HAAccount {
  id: string;
  status: HAAccountStatus;
  platform: HAPlatform;
  username: string | null;
  productName: string | null;
  productDescription: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listAccounts(): Promise<HAAccount[]> {
  const r = await haFetch<{ accounts: HAAccount[] }>('/accounts');
  return r.accounts;
}

export interface HAMedia {
  id: string;
  name: string;
  url: string;
  thumbnail: string | null;
  sourceUrl: string;
  fileSize: number | null;
  /** Seconds, when the upload said. */
  duration?: number | null;
  createdAt: string;
}

/** Import a video by URL — no bytes pass through our server; Hyper Attention
 *  fetches `url` itself. */
export async function importMediaFromUrl(url: string, name?: string): Promise<HAMedia> {
  return haFetch<HAMedia>('/media', {
    method: 'POST',
    body: JSON.stringify({ url, ...(name ? { name } : {}) }),
  });
}

export interface HAQueueItem {
  id: string;
  accountId: string;
  /** The account's handle as the queue list gives it. The accounts list is
   *  the surer source; this covers a post on an account since unlinked. */
  accountUsername?: string | null;
  scheduledFor: string;
  status: 'queued' | 'posted' | 'failed';
  platform: HAPlatform;
  postType: HAPostType | null;
  slideshowId: string | null;
  videoId: string | null;
  audioUrl: string | null;
  caption?: string | null;
  createdAt?: string;
}

/** List existing queue entries for one account — the data an "auto-pick the
 *  next open slot" scheduler needs, since Hyper Attention enforces the
 *  2-per-UTC-day cap itself but doesn't expose a "next free slot" endpoint. */
export async function listQueue(params: { accountId?: string; status?: string } = {}): Promise<HAQueueItem[]> {
  const qs = new URLSearchParams();
  if (params.accountId) qs.set('accountId', params.accountId);
  if (params.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await haFetch<{ posts: HAQueueItem[] }>(`/queue${suffix}`);
  return r.posts;
}

export interface QueueListParams {
  accountId?: string;
  /** Comma-separated: 'queued,posted'. Every status when left out. */
  status?: string;
  limit?: number;
  cursor?: string;
}

/** One page of the queue, and the cursor for the page after it. */
export async function listQueuePage(params: QueueListParams = {}): Promise<{ posts: HAQueueItem[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  if (params.accountId) qs.set('accountId', params.accountId);
  if (params.status) qs.set('status', params.status);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await haFetch<{ posts: HAQueueItem[]; nextCursor?: string | null }>(`/queue${suffix}`);
  return { posts: r.posts ?? [], nextCursor: r.nextCursor ?? null };
}

/** The whole queue — every status unless narrowed — a hundred a page (the
 *  API's most), up to `maxPages` of them. What the Hyper Attention section
 *  watches. */
export async function listQueueAll(params: Omit<QueueListParams, 'limit' | 'cursor'> = {}, maxPages = 5): Promise<HAQueueItem[]> {
  const out: HAQueueItem[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await listQueuePage({ ...params, limit: 100, cursor });
    out.push(...page.posts);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

/** Cancel a queued post. Hyper Attention refuses one already posted or
 *  failed, and says so. */
export async function cancelQueued(id: string): Promise<void> {
  await haFetch<unknown>(`/queue/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** The media library on their side — every video imported for a post — a
 *  hundred a page, newest first, up to `maxPages`. */
export async function listMedia(maxPages = 2): Promise<HAMedia[]> {
  const out: HAMedia[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const r = await haFetch<{ media: HAMedia[]; nextCursor?: string | null }>(`/media?${qs}`);
    out.push(...(r.media ?? []));
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return out;
}

/** One tracked account's counts, from the Stats add-on. */
export interface HAStatsAccount {
  id: string;
  platform: HAPlatform;
  handle: string;
  nickname: string | null;
  followers: number;
  likes: number;
  totalViews: number;
  videoCount: number;
  lastRefreshedAt: string | null;
}

/** Followers, likes and views per tracked account. Needs the Stats API
 *  add-on on the plan: without it the call is a 403, which a caller should
 *  show in place rather than fail on. */
export async function listStatsAccounts(): Promise<HAStatsAccount[]> {
  const r = await haFetch<{ accounts: HAStatsAccount[] }>('/stats/accounts');
  return r.accounts ?? [];
}

export interface QueuePostInput {
  accountId: string;
  scheduledFor: string;
  postType?: HAPostType;
  videoId?: string;
  slideshowId?: string;
  caption?: string;
  audioUrl?: string;
}

/** Always batches — the API asks callers to send one POST /queue per batch
 *  rather than one call per post. */
export async function queuePosts(items: QueuePostInput[]): Promise<{ posts: HAQueueItem[]; requestId: string }> {
  return haFetch<{ posts: HAQueueItem[]; requestId: string }>('/queue', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}
