'use client';

// BoardTabs — the markets/athletes/artists tab strip, shared by the full-page
// BoardGrid and the read-only BoardWidget so the tabs look + behave identically
// on both surfaces. `compact` tightens it for the floating widget.
//
// Per-machine hide preferences live in localStorage (see useHiddenBoardTabs):
// each tab carries a hover × that hides it on this computer; a "Hidden (n) ▾"
// dropdown reveals the hidden ones with a single-click "show" entry. The
// management chrome (× and dropdown) only renders on the full page; the
// compact widget silently follows the same preference.

import React, { useEffect, useRef, useState } from 'react';
import { type UseBoardReturn, type BoardTable, TABS } from '../hooks/useBoard';
import { useHiddenBoardTabs } from '../hooks/useHiddenBoardTabs';

export function BoardTabs({ board, compact = false }: { board: UseBoardReturn; compact?: boolean }) {
  const { active, setActive, rows, rowsByTable, loading } = board;
  const [hidden, setHidden] = useHiddenBoardTabs();
  const visible = TABS.filter((t) => !hidden.has(t.id));
  const hiddenList = TABS.filter((t) => hidden.has(t.id));

  // If the user hides the currently-active tab on another instance, snap to
  // the first visible tab so BoardGrid isn't quietly painting rows for a tab
  // whose button is no longer in the strip.
  useEffect(() => {
    if (visible.length > 0 && !visible.some((t) => t.id === active)) {
      setActive(visible[0].id);
    }
  }, [active, visible, setActive]);

  // "Hidden N" dropdown — click outside to close.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const hide = (id: BoardTable) => {
    // Refuse to hide the LAST visible tab — otherwise the board renders a
    // strip with nothing in it and the grid below shows ghost rows for the
    // still-active-but-hidden table.
    if (visible.length <= 1) return;
    const next = new Set(hidden);
    next.add(id);
    setHidden(next);
  };
  const unhide = (id: BoardTable) => {
    const next = new Set(hidden);
    next.delete(id);
    setHidden(next);
    setActive(id); // jump to it after unhiding so the user sees the effect
    setMenuOpen(false);
  };

  const pad = compact ? 'px-2' : 'px-4';
  const btn = compact ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  const showManagementChrome = !compact;

  return (
    <div className={`flex items-center gap-1 border-b border-zinc-800 ${pad} pt-2 shrink-0`}>
      {visible.map((t) => (
        <button
          key={t.id}
          onClick={() => setActive(t.id)}
          className={`group rounded-t-md ${btn} font-medium transition-colors ${
            active === t.id
              ? 'bg-zinc-900 text-white border-b-2 border-emerald-500'
              : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          {t.label}
          {rowsByTable[t.id] !== undefined && (
            <span className="ml-2 text-[11px] text-zinc-600">{rowsByTable[t.id]!.length}</span>
          )}
          {/* Hide-tab × — fades in on hover. stopPropagation so clicking it
              doesn't also trigger the parent button's setActive. Only on the
              full /board page; the widget stays clean. */}
          {showManagementChrome && visible.length > 1 && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); hide(t.id); }}
              title={`Hide ${t.label} on this computer`}
              aria-label={`Hide ${t.label} tab`}
              className="ml-1.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer text-[13px] leading-none align-middle"
            >
              ×
            </span>
          )}
        </button>
      ))}

      {showManagementChrome && hiddenList.length > 0 && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title={`${hiddenList.length} hidden tab${hiddenList.length === 1 ? '' : 's'} — click to manage`}
            className={`flex items-center gap-1 rounded-t-md ${btn} font-medium text-zinc-600 hover:text-zinc-200 transition-colors`}
          >
            <span>Hidden</span>
            <span className="text-[10px] text-zinc-700">{hiddenList.length}</span>
            <svg
              width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-[160px] rounded-md border border-zinc-800 bg-zinc-950 py-1 shadow-xl">
              {hiddenList.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => unhide(t.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors"
                >
                  <span>{t.label}</span>
                  <span className="text-[10px] text-zinc-600">show</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Total-row count: redundant with the per-tab badges, but kept on the
          full /board page since the loading state is otherwise invisible there.
          Hidden in the compact widget to declutter that small surface. */}
      {!compact && (
        <span className="ml-auto pr-2 text-[11px] text-zinc-500">
          {loading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
        </span>
      )}
    </div>
  );
}
