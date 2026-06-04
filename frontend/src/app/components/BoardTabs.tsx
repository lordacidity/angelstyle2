'use client';

// BoardTabs — the markets/athletes/artists tab strip, shared by the full-page
// BoardGrid and the read-only BoardWidget so the tabs look + behave identically
// on both surfaces. `compact` tightens it for the floating widget.

import React from 'react';
import { type UseBoardReturn, TABS } from '../hooks/useBoard';

export function BoardTabs({ board, compact = false }: { board: UseBoardReturn; compact?: boolean }) {
  const { active, setActive, rows, rowsByTable, loading } = board;
  const pad = compact ? 'px-2' : 'px-4';
  const btn = compact ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <div className={`flex items-center gap-1 border-b border-zinc-800 ${pad} pt-2 shrink-0`}>
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setActive(t.id)}
          className={`rounded-t-md ${btn} font-medium transition-colors ${
            active === t.id
              ? 'bg-zinc-900 text-white border-b-2 border-emerald-500'
              : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          {t.label}
          {rowsByTable[t.id] !== undefined && (
            <span className="ml-2 text-[11px] text-zinc-600">{rowsByTable[t.id]!.length}</span>
          )}
        </button>
      ))}
      <span className="ml-auto pr-2 text-[11px] text-zinc-500">
        {loading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}
