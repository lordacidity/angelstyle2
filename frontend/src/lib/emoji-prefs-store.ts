'use client';

// Client-side cache for per-emoji preferences (custom "@" alias + pinned state),
// shared by the "@" picker (read) and the sidebar Emoji manager (read + write).
//
// A tiny external store (useSyncExternalStore) instead of a context provider, so
// any surface — the picker rendered in a portal, the board cells, the manager
// drawer — sees the same live state without threading props through the tree.
// Mutations are optimistic and persisted to Railway via /api/emoji-prefs.

import { useEffect, useSyncExternalStore } from 'react';

export interface EmojiPref {
  unified: string;
  alias: string;
  pinned: boolean;
  pinOrder: number;
  updatedAt: string;
}

export type EmojiPrefMap = Record<string, EmojiPref>;
interface State { prefs: EmojiPrefMap; loaded: boolean }

// The whole state object is replaced (never mutated) on every change, so
// getSnapshot returns a stable reference between renders.
let state: State = { prefs: {}, loaded: false };
const listeners = new Set<() => void>();

function setState(next: State) {
  state = next;
  for (const l of listeners) l();
}

// Same rule as the server's normalizeAlias — a single lowercase token, no "@" or
// whitespace — so optimistic local state matches what the API stores.
function cleanAlias(v: string): string {
  return v.toLowerCase().replace(/[@\s]+/g, '').slice(0, 32);
}

function maxPinOrder(prefs: EmojiPrefMap): number {
  let m = 0;
  for (const k in prefs) { const p = prefs[k]; if (p.pinned && p.pinOrder > m) m = p.pinOrder; }
  return m;
}

// ── Loading ───────────────────────────────────────────────────────────────────
let loadPromise: Promise<void> | null = null;

export function loadEmojiPrefs(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch('/api/emoji-prefs', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as EmojiPref[];
      const prefs: EmojiPrefMap = {};
      for (const r of rows) prefs[r.unified] = r;
      setState({ prefs, loaded: true });
    } catch (e) {
      console.error('[emoji-prefs load]', e);
      // Mark loaded anyway so the UI shows built-in defaults instead of hanging.
      setState({ prefs: state.prefs, loaded: true });
    }
  })();
  return loadPromise;
}

// ── Mutation (optimistic + persist) ─────────────────────────────────────────────
export async function setEmojiPref(
  unified: string,
  patch: { alias?: string; pinned?: boolean },
): Promise<void> {
  const prev = state.prefs[unified];
  const optimistic: EmojiPref = {
    unified,
    alias: patch.alias !== undefined ? cleanAlias(patch.alias) : (prev?.alias ?? ''),
    pinned: patch.pinned ?? prev?.pinned ?? false,
    pinOrder:
      patch.pinned === true ? maxPinOrder(state.prefs) + 1
      : patch.pinned === false ? 0
      : (prev?.pinOrder ?? 0),
    updatedAt: prev?.updatedAt ?? '',
  };
  setState({ prefs: { ...state.prefs, [unified]: optimistic }, loaded: state.loaded });

  try {
    const res = await fetch('/api/emoji-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unified, ...patch }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const row = (await res.json()) as EmojiPref;
    // Reconcile with the server's authoritative row (esp. the real pin_order).
    setState({ prefs: { ...state.prefs, [unified]: row }, loaded: state.loaded });
  } catch (e) {
    console.error('[emoji-prefs save]', e);
    // Roll back to what it was before the optimistic change.
    const reverted = { ...state.prefs };
    if (prev) reverted[unified] = prev; else delete reverted[unified];
    setState({ prefs: reverted, loaded: state.loaded });
    throw e;
  }
}

// ── Selectors ───────────────────────────────────────────────────────────────────
export function aliasOf(prefs: EmojiPrefMap, unified: string): string {
  return prefs[unified]?.alias ?? '';
}
export function isPinned(prefs: EmojiPrefMap, unified: string): boolean {
  return prefs[unified]?.pinned ?? false;
}
/** Unifieds of all pinned emoji, in pin order. */
export function pinnedUnifieds(prefs: EmojiPrefMap): string[] {
  return Object.values(prefs)
    .filter((p) => p.pinned)
    .sort((a, b) => a.pinOrder - b.pinOrder)
    .map((p) => p.unified);
}

// ── Hook ─────────────────────────────────────────────────────────────────────
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot() { return state; }

export function useEmojiPrefs(): State {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { void loadEmojiPrefs(); }, []);
  return snap;
}
