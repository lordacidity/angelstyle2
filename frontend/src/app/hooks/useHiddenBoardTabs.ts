'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BoardTable } from './useBoard';

// Per-machine "which Board tabs to hide" preference. Lives in localStorage so it
// stays local to this computer (different teammates can hide different tabs),
// and so BoardGrid + BoardWidget — separate useBoard instances — stay in sync
// inside one window via a custom event + cross-tab via the native `storage`
// event. Starts empty on first paint to dodge SSR hydration drift, then
// hydrates from storage on mount.

const STORAGE_KEY = 'board.hiddenTabs';
const EVENT = 'board.hiddenTabs.changed';

function read(): Set<BoardTable> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as BoardTable[]) : []);
  } catch { return new Set(); }
}

export function useHiddenBoardTabs(): [Set<BoardTable>, (next: Set<BoardTable>) => void] {
  const [hidden, setHidden] = useState<Set<BoardTable>>(new Set());

  useEffect(() => {
    setHidden(read());
    const onChange = () => setHidden(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const update = useCallback((next: Set<BoardTable>) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      window.dispatchEvent(new Event(EVENT));
    } catch { /* ignore */ }
    setHidden(new Set(next));
  }, []);

  return [hidden, update];
}
