'use client';

// Vids 2's "Publish to accounts…" panel — Studio only. Opened from
// Vids2Builder once a build has rendered, with that render's Blob in hand.
// Never mounted (and therefore never fetched from) on the clipper build:
// the caller gates it behind `!CLIPPERS`, and its two backing routes
// (/api/hyperattention/accounts, /api/hyperattention/push) simply aren't in
// middleware.ts's clipper allowlist either way.
//
// Flow: pick accounts (multi-select) + post types (Reel/Story, multi-select)
// + a schedule mode, Preview to see the resolved times without touching
// Hyper Attention yet, then Confirm & Queue — which uploads the render to
// the shared Vids library first (so it also becomes a normal permanent
// library row, per how this was scoped) and only then imports + queues it.
//
// Shell copied from BoardWidget's useFloatingPanel usage; anchored bottom-4
// right-4 like PhonedeckMiniPanel, the established corner for an
// export-adjacent floating panel, so the two don't stack on top of each other.

import { useEffect, useState } from 'react';
import { useFloatingPanel } from '../../hooks/useFloatingPanel';
import { withBase } from '@/lib/clipping';
import { uploadVideo } from '@/lib/vids-client';
import type { VidTheme } from '@/lib/vids-types';
import type { HAAccount, HAAccountStatus, HAPostType } from '@/lib/hyperattention';
import type { ResolvedSlot } from '@/lib/hyperattention-schedule';
import { SpinnerIcon } from '@/lib/icons';

const DEFAULT_SIZE = { w: 380, h: 480 };

type Mode = 'auto' | 'manual';
type Phase = 'idle' | 'previewing' | 'previewed' | 'publishing' | 'done';

const STATUS_LABEL: Record<HAAccountStatus, string> = {
  configuring: 'Configuring',
  sent_to_warmup: 'Sent to warmup',
  warming_up: 'Warming up',
  active: 'Active',
  paused: 'Paused',
  burned: 'Burned',
};
const canReceivePosts = (s: HAAccountStatus) => s === 'active' || s === 'paused';

interface PushResponse {
  posts?: unknown[];
  requestId?: string;
  slots?: ResolvedSlot[];
  error?: string;
  details?: Array<{ field?: string; message?: string }>;
}

export function Vids2PublishPanel({
  blob, videoName, defaultCaption, theme, onClose,
}: {
  blob: Blob;
  videoName: string;
  defaultCaption: string;
  theme?: VidTheme | null;
  onClose: () => void;
}) {
  const { panelRef, panelStyle, collapsed, dragging, onHeaderMouseDown, onResizeMouseDown } = useFloatingPanel({
    storageKey: 'studio.vids2PublishPanel',
    defaultSize: DEFAULT_SIZE,
    minWidth: 320,
    minHeight: 360,
  });

  const [accounts, setAccounts] = useState<HAAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [postTypes, setPostTypes] = useState<Set<HAPostType>>(new Set(['reel']));
  const [mode, setMode] = useState<Mode>('auto');
  const [manualWhen, setManualWhen] = useState('');
  const [caption, setCaption] = useState(defaultCaption);
  // Caption follows the card's draft until the user edits it by hand.
  const [captionTouched, setCaptionTouched] = useState(false);
  useEffect(() => { if (!captionTouched) setCaption(defaultCaption); }, [defaultCaption, captionTouched]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [slots, setSlots] = useState<ResolvedSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishedCount, setPublishedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(withBase('/api/hyperattention/accounts'));
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(j.error ?? `${r.status}`);
        setAccounts(j.accounts as HAAccount[]);
      } catch (e) {
        if (!cancelled) setAccountsError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleAccount = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPhase('idle');
    setSlots(null);
  };
  const togglePostType = (t: HAPostType) => {
    setPostTypes((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
    setPhase('idle');
    setSlots(null);
  };

  const canAct = selected.size > 0 && postTypes.size > 0 && (mode === 'auto' || !!manualWhen);

  const runPush = async (dryRun: boolean, videoUrl?: string) => {
    const r = await fetch(withBase('/api/hyperattention/push'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(videoUrl ? { videoUrl, videoName } : {}),
        accountIds: [...selected],
        postTypes: [...postTypes],
        mode,
        ...(mode === 'manual' ? { scheduledFor: new Date(manualWhen).toISOString() } : {}),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        dryRun,
      }),
    });
    const j: PushResponse = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = j.details?.length ? ` (${j.details.map((d) => d.message).join('; ')})` : '';
      throw new Error(`${j.error ?? r.status}${detail}${j.requestId ? ` — requestId ${j.requestId}` : ''}`);
    }
    return j;
  };

  const preview = async () => {
    if (!canAct) return;
    setPhase('previewing');
    setError(null);
    try {
      const j = await runPush(true);
      setSlots(j.slots ?? []);
      setPhase('previewed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  };

  const confirmAndQueue = async () => {
    setPhase('publishing');
    setError(null);
    try {
      // Save to the shared library exactly like a manual save would — this
      // is also where the public URL Hyper Attention needs comes from.
      const row = await uploadVideo(blob, { name: videoName, folderId: null, theme: theme ?? null });
      const j = await runPush(false, row.url);
      setPublishedCount((j.posts ?? []).length);
      setSlots(j.slots ?? slots);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('previewed');
    }
  };

  return (
    <div
      ref={panelRef}
      data-troll-obstacle
      className="fixed bottom-4 right-4 z-40 flex w-[380px] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
      style={panelStyle}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        className={`flex w-full shrink-0 select-none items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2.5 transition-colors hover:bg-zinc-900 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="Publish — drag anywhere on this bar to move, click to collapse"
      >
        <div className="flex min-w-0 items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-500">
            <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" />
          </svg>
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Publish</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
            {collapsed ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
          </svg>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Close"
            className="text-zinc-500 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
          {accountsError ? (
            <p className="text-xs text-red-400">Couldn&apos;t load accounts: {accountsError}</p>
          ) : !accounts ? (
            <p className="flex items-center gap-2 text-xs text-zinc-500"><SpinnerIcon size={11} className="animate-spin" /> Loading accounts…</p>
          ) : accounts.length === 0 ? (
            <p className="text-xs text-zinc-500">No Instagram accounts on this Hyper Attention key yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Accounts</p>
              {accounts.map((a) => {
                const disabled = !canReceivePosts(a.status);
                return (
                  <label
                    key={a.id}
                    title={disabled ? `${STATUS_LABEL[a.status]} — can't receive posts yet` : undefined}
                    className={`flex items-center gap-2 rounded px-1.5 py-1 text-[12px] ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-zinc-900'}`}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={selected.has(a.id)}
                      onChange={() => toggleAccount(a.id)}
                      className="h-3.5 w-3.5 accent-emerald-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{a.username ?? a.id}</span>
                    <span className="shrink-0 text-[10px] text-zinc-500">{STATUS_LABEL[a.status]}</span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex gap-3">
            <p className="w-full text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Post as</p>
          </div>
          <div className="mt-1 flex gap-3">
            {(['reel', 'story'] as const).map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-200">
                <input type="checkbox" checked={postTypes.has(t)} onChange={() => togglePostType(t)} className="h-3.5 w-3.5 accent-emerald-500" />
                {t === 'reel' ? 'Reel' : 'Story'}
              </label>
            ))}
          </div>

          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">When</p>
            <div className="mt-1 flex gap-3">
              {(['auto', 'manual'] as const).map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-200">
                  <input
                    type="radio"
                    name="ha-mode"
                    checked={mode === m}
                    onChange={() => { setMode(m); setPhase('idle'); setSlots(null); }}
                    className="h-3.5 w-3.5 accent-emerald-500"
                  />
                  {m === 'auto' ? 'Next available' : 'Pick a time'}
                </label>
              ))}
            </div>
            {mode === 'manual' && (
              <input
                type="datetime-local"
                value={manualWhen}
                onChange={(e) => { setManualWhen(e.target.value); setPhase('idle'); setSlots(null); }}
                className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-zinc-600"
              />
            )}
          </div>

          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Caption</p>
            <textarea
              value={caption}
              onChange={(e) => { setCaption(e.target.value); setCaptionTouched(true); }}
              rows={3}
              placeholder="Defaults to this build's IG caption — edit freely."
              className="mt-1 w-full resize-none rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-zinc-600"
            />
          </div>

          {slots && (
            <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {phase === 'done' ? 'Queued' : 'Preview'}
              </p>
              {slots.map((s, i) => {
                const acct = accounts?.find((a) => a.id === s.accountId);
                return (
                  <div key={i} className="flex items-baseline gap-2 py-0.5 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-zinc-300">
                      {acct?.username ?? s.accountId} · {s.postType}
                    </span>
                    <span className="shrink-0 font-mono text-zinc-500">{new Date(s.scheduledFor).toLocaleString()}</span>
                  </div>
                );
              })}
              {slots.some((s) => s.warning) && (
                <div className="mt-1 space-y-0.5">
                  {slots.filter((s) => s.warning).map((s, i) => (
                    <p key={i} className="text-[10px] text-amber-400">{s.warning}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
          {phase === 'done' && !error && (
            <p className="mt-2 text-[11px] text-emerald-400">
              Queued {publishedCount ?? slots?.length ?? 0} post(s), and saved to the library.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            {phase !== 'done' && (
              <button
                onClick={() => void preview()}
                disabled={!canAct || phase === 'previewing' || phase === 'publishing'}
                className="h-9 flex-1 rounded-lg border border-zinc-700 text-[12px] font-semibold text-zinc-200 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {phase === 'previewing' ? 'Checking…' : 'Preview'}
              </button>
            )}
            {phase !== 'done' && (
              <button
                onClick={() => void confirmAndQueue()}
                disabled={phase !== 'previewed'}
                title={phase === 'previewed' ? undefined : 'Preview first'}
                className="h-9 flex-1 rounded-lg bg-white text-[12px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {phase === 'publishing' ? 'Queuing…' : 'Confirm & Queue'}
              </button>
            )}
            {phase === 'done' && (
              <button onClick={onClose} className="h-9 flex-1 rounded-lg bg-white text-[12px] font-semibold text-black transition-colors hover:bg-zinc-200">
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {!collapsed && (
        <>
          <div onMouseDown={onResizeMouseDown('n')} title="Drag to resize height" className="absolute left-3 right-4 top-0 h-1.5 cursor-ns-resize hover:bg-emerald-500/30" />
          <div onMouseDown={onResizeMouseDown('w')} title="Drag to resize width" className="absolute left-0 top-11 bottom-3 w-1.5 cursor-ew-resize hover:bg-emerald-500/30" />
        </>
      )}
    </div>
  );
}
