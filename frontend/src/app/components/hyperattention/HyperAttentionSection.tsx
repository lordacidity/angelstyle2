'use client';

// Hyper Attention (Studio > Hyper Attention) — the accounts on the key and
// everything queued onto them, in one place to watch. Vids 2's Publish panel
// is where a render is sent; this is where it can be seen going out: which
// account, when, and whether it went. Studio-only, like the panel: the page
// is not in middleware.ts's clipper list, and neither are its routes.
//
// One read, /api/hyperattention/overview, brings the accounts, the whole
// queue, their media library and (with the add-on) the stats. It runs when
// the section is opened, again every minute while it is on show — a post
// going out changes its row — and on Refresh. Their WebSocket would be
// sooner, but it wants the key in its URL, and the key never reaches the
// browser.
//
// The one thing that writes: Cancel on a queued post, which asks first.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { withBase } from '@/lib/clipping';
import { formatSize } from '../../hooks/usePhonedeck';
import type { HAAccount, HAAccountStatus, HAMedia, HAQueueItem, HAStatsAccount } from '@/lib/hyperattention';
import { SpinnerIcon } from '@/lib/icons';

interface Overview {
  accounts: HAAccount[];
  queue: HAQueueItem[];
  media: { items: HAMedia[] | null; error: string | null };
  stats: { accounts: HAStatsAccount[] | null; error: string | null };
  fetchedAt: string;
}

type PostStatus = HAQueueItem['status'];
type PostFilter = 'all' | PostStatus;

const ACCOUNT_STATUS: Record<HAAccountStatus, { label: string; tint: string }> = {
  configuring: { label: 'Configuring', tint: 'border-zinc-700 text-zinc-400' },
  sent_to_warmup: { label: 'Sent to warmup', tint: 'border-amber-900 text-amber-400' },
  warming_up: { label: 'Warming up', tint: 'border-amber-800 text-amber-300' },
  active: { label: 'Active', tint: 'border-emerald-800 text-emerald-400' },
  paused: { label: 'Paused', tint: 'border-sky-900 text-sky-400' },
  burned: { label: 'Burned', tint: 'border-red-900 text-red-400' },
};

const POST_STATUS: Record<PostStatus, { label: string; tint: string }> = {
  queued: { label: 'Queued', tint: 'border-sky-900 text-sky-400' },
  posted: { label: 'Posted', tint: 'border-emerald-800 text-emerald-400' },
  failed: { label: 'Failed', tint: 'border-red-900 text-red-400' },
};

const PLATFORM: Record<HAAccount['platform'], string> = { instagram: 'Instagram', tiktok: 'TikTok' };
const POST_TYPE: Record<string, string> = { reel: 'Reel', story: 'Story', feed: 'Feed', carousel: 'Carousel' };

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-zinc-500';
const CARD = 'rounded-lg border border-zinc-800 bg-zinc-950';

/** 'Sep 24, 3:05 PM' — the reader's clock, not UTC. */
function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

/** 'in 2h', '3d ago', 'now'. */
function relative(iso: string, now: number): string {
  const delta = new Date(iso).getTime() - now;
  if (!Number.isFinite(delta)) return '';
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  if (minutes < 1) return 'now';
  const span = minutes < 60 ? `${minutes}m` : hours < 48 ? `${hours}h` : `${days}d`;
  return delta > 0 ? `in ${span}` : `${span} ago`;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const count = (n: number) => n.toLocaleString();

function Badge({ label, tint }: { label: string; tint: string }) {
  return <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium ${tint}`}>{label}</span>;
}

/** What one account has going: how many posts in each state, the next one
 *  due and the last one that went. */
interface Tally { queued: number; posted: number; failed: number; next: string | null; last: string | null }
const emptyTally = (): Tally => ({ queued: 0, posted: 0, failed: 0, next: null, last: null });

export function HyperAttentionSection({ active }: { active: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PostFilter>('all');
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  // The moment the relative times are measured from; moves with every read.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(withBase('/api/hyperattention/overview'), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j as Overview);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  // On show: a read now, and one a minute after that until it is left.
  useEffect(() => {
    if (!active) return;
    void load();
    const t = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(t);
  }, [active, load]);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const queue = useMemo(() => data?.queue ?? [], [data]);

  const tallies = useMemo(() => {
    const m = new Map<string, Tally>();
    for (const p of queue) {
      const t = m.get(p.accountId) ?? emptyTally();
      t[p.status]++;
      if (p.status === 'queued' && (!t.next || Date.parse(p.scheduledFor) < Date.parse(t.next))) t.next = p.scheduledFor;
      if (p.status === 'posted' && (!t.last || Date.parse(p.scheduledFor) > Date.parse(t.last))) t.last = p.scheduledFor;
      m.set(p.accountId, t);
    }
    return m;
  }, [queue]);

  const accountName = useCallback((id: string, post?: HAQueueItem) => {
    const a = accounts.find((x) => x.id === id);
    return a?.username ?? post?.accountUsername ?? id;
  }, [accounts]);

  const mediaById = useMemo(() => {
    const m = new Map<string, HAMedia>();
    for (const item of data?.media.items ?? []) m.set(item.id, item);
    return m;
  }, [data]);

  /** Posts per video, for the media list. */
  const usesByVideo = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of queue) if (p.videoId) m.set(p.videoId, (m.get(p.videoId) ?? 0) + 1);
    return m;
  }, [queue]);

  // The queue as shown: narrowed to an account if one is picked, then to a
  // state; what is still to go first, soonest at the top, then what went or
  // failed, newest at the top.
  const scoped = useMemo(
    () => (accountFilter ? queue.filter((p) => p.accountId === accountFilter) : queue),
    [queue, accountFilter],
  );
  const rows = useMemo(() => {
    const list = filter === 'all' ? scoped : scoped.filter((p) => p.status === filter);
    const t = (p: HAQueueItem) => Date.parse(p.scheduledFor);
    return [...list].sort((a, b) => {
      const aq = a.status === 'queued';
      const bq = b.status === 'queued';
      if (aq !== bq) return aq ? -1 : 1;
      return aq ? t(a) - t(b) : t(b) - t(a);
    });
  }, [scoped, filter]);

  const totals = useMemo(() => ({
    queued: scoped.filter((p) => p.status === 'queued').length,
    posted: scoped.filter((p) => p.status === 'posted').length,
    failed: scoped.filter((p) => p.status === 'failed').length,
  }), [scoped]);

  const nextUp = useMemo(() => {
    const due = queue.filter((p) => p.status === 'queued').sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
    return due[0] ?? null;
  }, [queue]);
  const activeAccounts = accounts.filter((a) => a.status === 'active' || a.status === 'paused').length;

  const cancel = async (p: HAQueueItem) => {
    const ok = window.confirm(`Cancel the ${POST_TYPE[p.postType ?? ''] ?? 'post'} to ${accountName(p.accountId, p)} on ${fmtWhen(p.scheduledFor)}? Hyper Attention drops it from the queue.`);
    if (!ok) return;
    setActionError(null);
    setCancelling((s) => new Set(s).add(p.id));
    try {
      const r = await fetch(withBase(`/api/hyperattention/queue/${encodeURIComponent(p.id)}`), { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  };

  const filters: { id: PostFilter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: scoped.length },
    { id: 'queued', label: 'Queued', n: totals.queued },
    { id: 'posted', label: 'Posted', n: totals.posted },
    { id: 'failed', label: 'Failed', n: totals.failed },
  ];

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="flex shrink-0 items-center gap-4 border-b border-zinc-900 px-6 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Hyper Attention</h1>
          <p className="text-xs text-zinc-500">
            The accounts on the key, and everything queued onto them from Vids 2: which account, when, and whether it went. Read again every minute while this page is open.
          </p>
        </div>
        {data && (
          <span className="shrink-0 text-[11px] text-zinc-500" title={data.fetchedAt}>
            Updated {fmtClock(data.fetchedAt)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && <SpinnerIcon size={11} className="animate-spin" />}
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-red-900/60 bg-red-950/30 px-6 py-2 text-xs text-red-300">
          Hyper Attention didn&apos;t answer: {error}
          {/Authentication required/i.test(error) && ' — the key in .env (HYPERATTENTION_API_KEY) was rejected.'}
        </div>
      )}
      {actionError && (
        <div className="shrink-0 border-b border-red-900/60 bg-red-950/30 px-6 py-2 text-xs text-red-300">{actionError}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {!data && loading && (
          <p className="flex items-center gap-2 text-xs text-zinc-500"><SpinnerIcon size={11} className="animate-spin" /> Reading the accounts and the queue…</p>
        )}
        {!data && !loading && !error && (
          <p className="text-xs text-zinc-500">Nothing read yet.</p>
        )}

        {data && (
          <>
            {/* The numbers at a glance. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { label: 'Accounts', value: `${activeAccounts} / ${accounts.length}`, note: 'can post / on the key' },
                { label: 'Queued', value: count(queue.filter((p) => p.status === 'queued').length), note: 'still to go' },
                { label: 'Posted', value: count(queue.filter((p) => p.status === 'posted').length), note: 'went out' },
                { label: 'Failed', value: count(queue.filter((p) => p.status === 'failed').length), note: 'did not' },
                {
                  label: 'Next post',
                  value: nextUp ? relative(nextUp.scheduledFor, now) : '—',
                  note: nextUp ? `${accountName(nextUp.accountId, nextUp)} · ${fmtWhen(nextUp.scheduledFor)}` : 'nothing queued',
                },
              ].map((tile) => (
                <div key={tile.label} className={`${CARD} px-3 py-2.5`}>
                  <p className={LABEL}>{tile.label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{tile.value}</p>
                  <p className="truncate text-[11px] text-zinc-500" title={tile.note}>{tile.note}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
              {/* Accounts — one card each; press one to see only its posts. */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className={LABEL}>Accounts</h2>
                  {accountFilter && (
                    <button type="button" onClick={() => setAccountFilter(null)} className="text-[11px] text-zinc-400 hover:text-white">
                      Show all
                    </button>
                  )}
                </div>
                {accounts.length === 0 ? (
                  <p className="text-xs text-zinc-500">No accounts on this key yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {accounts.map((a) => {
                      const t = tallies.get(a.id) ?? emptyTally();
                      const picked = accountFilter === a.id;
                      const status = ACCOUNT_STATUS[a.status] ?? { label: a.status, tint: 'border-zinc-700 text-zinc-400' };
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setAccountFilter(picked ? null : a.id)}
                          aria-pressed={picked}
                          title={picked ? 'Show every account’s posts' : 'Show only this account’s posts'}
                          className={`${CARD} w-full px-3 py-2.5 text-left transition-colors hover:border-zinc-600 ${picked ? 'border-zinc-500 bg-zinc-900' : ''}`}
                        >
                          <div className="flex items-center gap-2.5">
                            {a.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-400">
                                {(a.username ?? a.id).slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{a.username ? `@${a.username}` : a.id}</p>
                              <p className="truncate text-[11px] text-zinc-500">{PLATFORM[a.platform] ?? a.platform}{a.productName ? ` · ${a.productName}` : ''}</p>
                            </div>
                            <Badge label={status.label} tint={status.tint} />
                          </div>
                          <div className="mt-2 flex items-center gap-3 text-[11px] tabular-nums text-zinc-400">
                            <span><span className="text-sky-400">{t.queued}</span> queued</span>
                            <span><span className="text-emerald-400">{t.posted}</span> posted</span>
                            {t.failed > 0 && <span><span className="text-red-400">{t.failed}</span> failed</span>}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-500">
                            {t.next ? <span title={fmtWhen(t.next)}>Next {relative(t.next, now)}</span> : <span>Nothing queued</span>}
                            {t.last && <span title={fmtWhen(t.last)}> · Last posted {relative(t.last, now)}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* The queue — what is still to go, then what went. */}
              <section className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <h2 className={`${LABEL} mr-2`}>
                    Posts{accountFilter ? ` · ${accountName(accountFilter)}` : ''}
                  </h2>
                  {filters.map((f) => {
                    const on = filter === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id)}
                        aria-pressed={on}
                        className={`h-7 rounded-full border px-3 text-xs transition-colors ${
                          on ? 'border-zinc-600 bg-zinc-800 text-white' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200'
                        }`}
                      >
                        {f.label} <span className="tabular-nums opacity-60">{f.n}</span>
                      </button>
                    );
                  })}
                </div>
                {rows.length === 0 ? (
                  <p className={`${CARD} px-3 py-4 text-xs text-zinc-500`}>
                    {scoped.length === 0 ? 'Nothing has been queued here yet. Publish to accounts on Vids 2 puts posts on this list.' : 'Nothing in this state.'}
                  </p>
                ) : (
                  <div className={`${CARD} overflow-x-auto`}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                          <th className="px-3 py-2 font-semibold">When</th>
                          <th className="px-3 py-2 font-semibold">Account</th>
                          <th className="px-3 py-2 font-semibold">As</th>
                          <th className="px-3 py-2 font-semibold">Video</th>
                          <th className="px-3 py-2 font-semibold">Caption</th>
                          <th className="px-3 py-2 font-semibold">State</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((p) => {
                          const media = p.videoId ? mediaById.get(p.videoId) : undefined;
                          const state = POST_STATUS[p.status] ?? { label: p.status, tint: 'border-zinc-700 text-zinc-400' };
                          const busy = cancelling.has(p.id);
                          return (
                            <tr key={p.id} className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/50">
                              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                                <div>{fmtWhen(p.scheduledFor)}</div>
                                <div className="text-[10px] text-zinc-500">{relative(p.scheduledFor, now)}</div>
                              </td>
                              <td className="max-w-[160px] truncate px-3 py-2" title={p.accountId}>{accountName(p.accountId, p)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-zinc-300">{p.postType ? (POST_TYPE[p.postType] ?? p.postType) : p.slideshowId ? 'Slideshow' : 'Video'}</td>
                              <td className="max-w-[200px] truncate px-3 py-2 text-zinc-300" title={media?.name ?? p.videoId ?? p.slideshowId ?? ''}>
                                {media ? (
                                  <a href={media.url} target="_blank" rel="noreferrer" className="hover:text-white hover:underline">{media.name}</a>
                                ) : (p.videoId ?? p.slideshowId ?? '—')}
                              </td>
                              <td className="max-w-[260px] truncate px-3 py-2 text-zinc-400" title={p.caption ?? ''}>{p.caption || <span className="text-zinc-600">—</span>}</td>
                              <td className="px-3 py-2"><Badge label={state.label} tint={state.tint} /></td>
                              <td className="whitespace-nowrap px-3 py-2 text-right">
                                {p.status === 'queued' && (
                                  <button
                                    type="button"
                                    onClick={() => void cancel(p)}
                                    disabled={busy}
                                    className="text-[11px] text-zinc-500 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {busy ? 'Cancelling…' : 'Cancel'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {/* Their media library — every video sent over for a post. */}
              <section className="min-w-0">
                <h2 className={`${LABEL} mb-2`}>Videos on Hyper Attention</h2>
                {data.media.error ? (
                  <p className={`${CARD} px-3 py-3 text-xs text-zinc-500`}>The media list isn&apos;t readable on this key: {data.media.error}</p>
                ) : !data.media.items || data.media.items.length === 0 ? (
                  <p className={`${CARD} px-3 py-3 text-xs text-zinc-500`}>No videos sent over yet.</p>
                ) : (
                  <div className={`${CARD} overflow-x-auto`}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                          <th className="px-3 py-2 font-semibold">Name</th>
                          <th className="px-3 py-2 font-semibold">Length</th>
                          <th className="px-3 py-2 font-semibold">Size</th>
                          <th className="px-3 py-2 font-semibold">Sent</th>
                          <th className="px-3 py-2 font-semibold">Posts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.media.items.map((m) => (
                          <tr key={m.id} className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/50">
                            <td className="max-w-[260px] truncate px-3 py-2" title={m.name}>
                              <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">{m.name}</a>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400">{m.duration ? clock(m.duration) : '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400">{m.fileSize ? formatSize(m.fileSize) : '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400" title={fmtWhen(m.createdAt)}>{relative(m.createdAt, now)}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400">{usesByVideo.get(m.id) ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* The Stats add-on, when the plan has it. */}
              <section className="min-w-0">
                <h2 className={`${LABEL} mb-2`}>Followers &amp; views</h2>
                {data.stats.error ? (
                  <p className={`${CARD} px-3 py-3 text-xs text-zinc-500`}>Not on this plan: {data.stats.error}</p>
                ) : !data.stats.accounts || data.stats.accounts.length === 0 ? (
                  <p className={`${CARD} px-3 py-3 text-xs text-zinc-500`}>No accounts tracked yet.</p>
                ) : (
                  <div className={`${CARD} overflow-x-auto`}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                          <th className="px-3 py-2 font-semibold">Account</th>
                          <th className="px-3 py-2 text-right font-semibold">Followers</th>
                          <th className="px-3 py-2 text-right font-semibold">Likes</th>
                          <th className="px-3 py-2 text-right font-semibold">Views</th>
                          <th className="px-3 py-2 text-right font-semibold">Videos</th>
                          <th className="px-3 py-2 font-semibold">Read</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.stats.accounts.map((s) => (
                          <tr key={s.id} className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/50">
                            <td className="max-w-[200px] truncate px-3 py-2" title={s.nickname ?? ''}>@{s.handle} <span className="text-zinc-500">{PLATFORM[s.platform] ?? s.platform}</span></td>
                            <td className="px-3 py-2 text-right tabular-nums">{count(s.followers)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{count(s.likes)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{count(s.totalViews)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{count(s.videoCount)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-zinc-400">{s.lastRefreshedAt ? relative(s.lastRefreshedAt, now) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
