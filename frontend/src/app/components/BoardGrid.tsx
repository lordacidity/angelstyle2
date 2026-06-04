'use client';

// BoardGrid — the full editable spreadsheet table for the Shared Board page
// (quick-add row, inline-edit cells, boolean checkboxes, delete), driven by a
// useBoard() instance. The floating media-tab widget uses its own read-only
// table (BoardWidget); both share the data hook (useBoard) and tab strip
// (BoardTabs).
//
// Renders a fragment (tabs / error / scrollable table) meant to drop into a
// flex-column parent that owns the header above it.

import React, { useCallback, useEffect, useRef } from 'react';
import { type UseBoardReturn, type TextField, TEXT_FIELDS } from '../hooks/useBoard';
import { BoardTabs } from './BoardTabs';

const CELL_BASE =
  'w-full bg-transparent px-2 py-1.5 text-[13px] leading-snug text-zinc-200 outline-none placeholder:text-zinc-700 focus:bg-zinc-900/60';

// Single-line cell — stays one line and truncates with an ellipsis when not
// focused (url / notes).
function CellInput({
  value, onChange, onCommit, onKeyDown, inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={onKeyDown}
      spellCheck={false}
      className={`${CELL_BASE} truncate`}
    />
  );
}

// Auto-growing multi-line cell — expands to fit wrapped text (caption / context).
function CellTextarea({
  value, onChange, onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => { onChange(e.target.value); resize(); }}
      onBlur={onCommit}
      spellCheck={false}
      className={`${CELL_BASE} resize-none`}
    />
  );
}

export function BoardGrid({ board }: { board: UseBoardReturn }) {
  const {
    rows, loading, error,
    draft, setDraft, draftHasContent, posting, urlInputRef,
    onTextChange, onTextCommit, toggleBool, deleteRow, postDraft,
  } = board;

  function renderTextCell(
    key: TextField,
    multiline: boolean,
    value: string,
    onChange: (v: string) => void,
    onCommit?: () => void,
    isDraftUrl = false,
  ) {
    if (multiline) {
      return <CellTextarea value={value} onChange={onChange} onCommit={onCommit} />;
    }
    return (
      <CellInput
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        inputRef={isDraftUrl ? urlInputRef : undefined}
        onKeyDown={
          isDraftUrl
            ? (e) => { if (e.key === 'Enter') { e.preventDefault(); void postDraft(); } }
            : undefined
        }
      />
    );
  }

  return (
    <>
      <BoardTabs board={board} />

      {error && (
        <div className="mx-6 mt-3 rounded-md border border-red-900 bg-red-950/50 px-3 py-1.5 text-xs text-red-300 shrink-0">
          {error}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
        <table className="w-full border-collapse text-left">
          {/* Columns: posted · unusable · url · vid caption · context · notes ·
              action. No inline comments between <col>s — stray whitespace text
              nodes are illegal inside <colgroup> and break hydration. */}
          <colgroup>
            <col style={{ width: '56px' }} />
            <col style={{ width: '72px' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '32%' }} />
            <col style={{ width: '32%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '44px' }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-black">
            <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="border border-zinc-800 px-1 py-2 text-center font-medium" title="Posted">Posted</th>
              <th className="border border-zinc-800 px-1 py-2 text-center font-medium" title="Unusable">Unusable</th>
              {TEXT_FIELDS.map((f) => (
                <th key={f.key} className="border border-zinc-800 px-2 py-2 font-medium">{f.label}</th>
              ))}
              <th className="border border-zinc-800" />
            </tr>
          </thead>
          <tbody>
            {/* Quick-add entry row — type here, Enter or Post to commit */}
            <tr className="align-top bg-zinc-900/40">
              <td className="border border-zinc-800 text-center align-middle">
                <input
                  type="checkbox"
                  checked={draft.posted}
                  onChange={(e) => setDraft((d) => ({ ...d, posted: e.target.checked }))}
                  title="Mark as already posted"
                  className="h-4 w-4 cursor-pointer accent-emerald-500"
                />
              </td>
              <td className="border border-zinc-800 text-center align-middle">
                <input
                  type="checkbox"
                  checked={draft.unusable}
                  onChange={(e) => setDraft((d) => ({ ...d, unusable: e.target.checked }))}
                  title="Mark as unusable"
                  className="h-4 w-4 cursor-pointer accent-red-500"
                />
              </td>
              {TEXT_FIELDS.map((f) => (
                <td key={f.key} className="border border-zinc-800 p-0">
                  {renderTextCell(
                    f.key, f.multiline, draft[f.key],
                    (v) => setDraft((d) => ({ ...d, [f.key]: v })),
                    undefined,
                    f.key === 'url',
                  )}
                </td>
              ))}
              <td className="border border-zinc-800 text-center align-middle">
                <button
                  onClick={postDraft}
                  disabled={!draftHasContent || posting}
                  title="Post (Enter)"
                  className="mx-auto flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-30 disabled:hover:bg-emerald-600 transition-colors"
                >
                  {posting ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  )}
                </button>
              </td>
            </tr>

            {/* Existing rows */}
            {rows.map((row) => (
              <tr key={row.id} className="group align-top">
                <td className="border border-zinc-800 text-center align-middle">
                  <input
                    type="checkbox"
                    checked={row.posted}
                    onChange={() => toggleBool(row, 'posted')}
                    className="h-4 w-4 cursor-pointer accent-emerald-500"
                  />
                </td>
                <td className="border border-zinc-800 text-center align-middle">
                  <input
                    type="checkbox"
                    checked={row.unusable}
                    onChange={() => toggleBool(row, 'unusable')}
                    title="Unusable"
                    className="h-4 w-4 cursor-pointer accent-red-500"
                  />
                </td>
                {TEXT_FIELDS.map((f) => (
                  <td key={f.key} className="border border-zinc-800 p-0">
                    {renderTextCell(
                      f.key, f.multiline, row[f.key],
                      (v) => onTextChange(row.id, f.key, v),
                      () => onTextCommit(row, f.key),
                    )}
                  </td>
                ))}
                <td className="border border-zinc-800 text-center align-middle">
                  <button
                    onClick={() => deleteRow(row.id)}
                    title="Delete row"
                    className="p-1 text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="border border-zinc-800 px-3 py-8 text-center text-sm text-zinc-600">
                  No rows yet — type a link in the row above and hit <span className="text-zinc-400">Enter</span>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
