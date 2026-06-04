'use client';

// BoardWidget — the Shared Board as a floating, draggable, resizable panel on
// the Media tab, so links can be reviewed (and triaged via the Posted/Unusable
// checkboxes) without leaving the generator.
//
// Read-only by design: unlike the full /board page you can't add, edit text, or
// delete here — only switch tables and tick Posted/Unusable. Cells truncate to
// one line (no wrapping, no per-cell scrollbars) to keep the grid dense. Adds
// and edits happen on the /board page; this is the at-a-glance companion view.
// Shares the data hook (useBoard) and tab strip (BoardTabs) with that page.
//
// Defaults to the left of the centered generator, vertically centered; the
// first drag pins an absolute position. Resize grips grow the panel rightward
// and downward (top-left corner stays put). Position / size / collapsed all
// persist via useFloatingPanel's localStorage keys.

import React, { useState } from 'react';
import { TABS, TEXT_FIELDS, type BoardRow, type UseBoardReturn } from '../hooks/useBoard';
import { useFloatingPanel } from '../hooks/useFloatingPanel';
import { BoardTabs } from './BoardTabs';

const DEFAULT_SIZE = { w: 560, h: 520 };

// `board` is owned by StudioShell (one useBoard instance) so the same state can
// be marked Posted when a sent video is exported. onSendRow hands a row's
// url/caption/context to the main generator and kicks off the fetch → crop →
// caption pipeline (wired up in StudioShell).
export function BoardWidget({ board, onSendRow }: { board: UseBoardReturn; onSendRow: (row: BoardRow) => void }) {
  const { rows, loading, error, toggleBool } = board;

  // Brief per-row "sent ✓" confirmation, since the actual result shows up in
  // the generator which may be partly behind the widget.
  const [sentId, setSentId] = useState<string | null>(null);
  const sendRow = (row: BoardRow) => {
    onSendRow(row);
    setSentId(row.id);
    window.setTimeout(() => setSentId((cur) => (cur === row.id ? null : cur)), 1200);
  };

  const {
    panelRef, panelStyle, collapsed, dragging,
    onHeaderMouseDown, onResizeMouseDown,
  } = useFloatingPanel({
    storageKey: 'studio.boardWidget',
    defaultSize: DEFAULT_SIZE,
    minWidth: 340,
    minHeight: 220,
  });

  const activeLabel = TABS.find((t) => t.id === board.active)?.label ?? '';

  return (
    <div
      ref={panelRef}
      // Resting spot: left of the centered generator, vertically centered. The
      // hook pins an absolute position (clearing the centering translate) on the
      // first drag/resize.
      className="fixed left-24 top-1/2 -translate-y-1/2 w-[560px] bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl z-40 overflow-hidden flex flex-col"
      style={panelStyle}
    >
      {/* Drag handle / title bar — the whole bar is grabbable; a click without
          dragging toggles collapse. select-none here only, so cell text in the
          body can still be selected. */}
      <div
        onMouseDown={onHeaderMouseDown}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-zinc-900/60 border-b border-zinc-800 hover:bg-zinc-900 transition-colors shrink-0 select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="Shared Board — drag anywhere on this bar to move, click to collapse"
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* grip dots — signals the bar is draggable */}
          <svg width="9" height="14" viewBox="0 0 9 14" className="text-zinc-600 shrink-0" aria-hidden>
            <g fill="currentColor">
              <circle cx="2" cy="2" r="1.1" /><circle cx="7" cy="2" r="1.1" />
              <circle cx="2" cy="7" r="1.1" /><circle cx="7" cy="7" r="1.1" />
              <circle cx="2" cy="12" r="1.1" /><circle cx="7" cy="12" r="1.1" />
            </g>
          </svg>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="9" x2="9" y2="21" />
          </svg>
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Board</span>
          <span className="text-[10px] text-zinc-500 shrink-0">{activeLabel}</span>
        </div>
        <div className="flex items-center shrink-0">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
            {collapsed
              ? <polyline points="18 15 12 9 6 15" />
              : <polyline points="6 9 12 15 18 9" />}
          </svg>
        </div>
      </div>

      {!collapsed && (
        <>
          <BoardTabs board={board} compact />

          {error && (
            <div className="mx-3 mt-2 rounded-md border border-red-900 bg-red-950/50 px-2.5 py-1 text-[11px] text-red-300 shrink-0">
              {error}
            </div>
          )}

          {/* Read-only grid — truncated single-line cells, only the checkboxes
              are interactive. */}
          <div className="flex-1 min-h-0 overflow-auto px-2 py-2">
            <table className="w-full table-fixed border-collapse text-left">
              {/* Columns: P · U · url · vid caption · context · notes · send.
                  No inline comments between <col>s — stray whitespace text nodes
                  are illegal inside <colgroup> and break hydration. */}
              <colgroup>
                <col style={{ width: '26px' }} />
                <col style={{ width: '26px' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '34px' }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-zinc-950">
                <tr className="text-[10px] uppercase tracking-wide text-zinc-500">
                  <th title="Posted" className="cursor-help border border-zinc-800 px-1 py-1.5 text-center font-medium">P</th>
                  <th title="Unusable" className="cursor-help border border-zinc-800 px-1 py-1.5 text-center font-medium">U</th>
                  {TEXT_FIELDS.map((f) => (
                    <th key={f.key} title={f.label} className="border border-zinc-800 px-1.5 py-1.5 font-medium">
                      <div className="truncate">{f.label}</div>
                    </th>
                  ))}
                  <th title="Send to generator" className="border border-zinc-800" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="align-middle hover:bg-zinc-900/40">
                    <td className="border border-zinc-800 text-center">
                      <input
                        type="checkbox"
                        checked={row.posted}
                        onChange={() => toggleBool(row, 'posted')}
                        title="Posted"
                        className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                      />
                    </td>
                    <td className="border border-zinc-800 text-center">
                      <input
                        type="checkbox"
                        checked={row.unusable}
                        onChange={() => toggleBool(row, 'unusable')}
                        title="Unusable"
                        className="h-3.5 w-3.5 cursor-pointer accent-red-500"
                      />
                    </td>
                    <td className="border border-zinc-800 px-1.5 py-1 text-[12px]">
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          title={row.url}
                          className="block truncate text-sky-400 hover:underline"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          {row.url}
                        </a>
                      ) : (
                        <span className="block truncate text-zinc-700">—</span>
                      )}
                    </td>
                    {(['vidCaption', 'context', 'notes'] as const).map((key) => (
                      <td key={key} className="border border-zinc-800 px-1.5 py-1 text-[12px] text-zinc-300">
                        <div className="truncate" title={row[key] || undefined}>{row[key]}</div>
                      </td>
                    ))}
                    <td className="border border-zinc-800 text-center">
                      <button
                        onClick={() => sendRow(row)}
                        disabled={!row.url.trim()}
                        title="Send url + caption + context to the generator and start cropping"
                        className="mx-auto flex h-6 w-6 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-25 disabled:hover:bg-emerald-600 transition-colors"
                      >
                        {sentId === row.id ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="border border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">
                      No rows yet — add them on the Board page.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Resize grips (only when expanded) — grow the panel right and/or down;
          the top-left corner stays anchored. */}
      {!collapsed && (
        <>
          {/* right edge — width only (grows rightward) */}
          <div
            onMouseDown={onResizeMouseDown('e')}
            title="Drag to resize width"
            className="absolute right-0 top-11 bottom-3 w-1.5 cursor-ew-resize hover:bg-emerald-500/30"
          />
          {/* bottom edge — height only (grows downward) */}
          <div
            onMouseDown={onResizeMouseDown('s')}
            title="Drag to resize height"
            className="absolute bottom-0 left-3 right-4 h-1.5 cursor-ns-resize hover:bg-emerald-500/30"
          />
          {/* bottom-right corner — both */}
          <div
            onMouseDown={onResizeMouseDown('se')}
            title="Drag to resize"
            className="absolute bottom-0 right-0 z-20 flex items-end justify-end p-0.5 cursor-nwse-resize"
            style={{ width: 16, height: 16 }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-zinc-600">
              <path d="M9 3 L3 9 M9 6 L6 9" strokeLinecap="round" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
