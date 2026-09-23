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
  scheduledFor: string;
  status: 'queued' | 'posted' | 'failed';
  platform: HAPlatform;
  postType: HAPostType | null;
  slideshowId: string | null;
  videoId: string | null;
  audioUrl: string | null;
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
