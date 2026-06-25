'use client';

// BoardGrid — the full editable spreadsheet table for the Shared Board page
// (quick-add row, inline-edit cells, boolean checkboxes, delete), driven by a
// useBoard() instance. The floating media-tab widget uses its own read-only
// table (BoardWidget); both share the data hook (useBoard) and tab strip
// (BoardTabs).
//
// Renders a fragment (tabs / error / scrollable table) meant to drop into a
// flex-column parent that owns the header above it.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type UseBoardReturn, type BoardRow, type BoolField, type TextField, TEXT_FIELDS } from '../hooks/useBoard';
import { BoardTabs } from './BoardTabs';
import { useEmojiField } from './EmojiPicker';

// Bulk auto-context generator — lives in the CONTEXT column header. The little
// green ring is always-on: at rest it shows what fraction of eligible rows
// (not posted, not unusable) already have a context filled in; mid-run it
// flips to tracking just the current batch as each row completes. Clicking the
// sparkle kicks off serial generation for every eligible row whose context is
// empty; click again to cancel. Runs serially (one row at a time) so we don't
// flood the auto-context endpoint, which scrapes + summarizes per call.
function BulkAutoContextButton({
  rows, autoContext,
}: {
  rows: BoardRow[];
  autoContext: (row: BoardRow) => Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const cancelRef = useRef(false);

  const { eligible, withContext, toDo } = useMemo(() => {
    const elig = rows.filter((r) => !r.posted && !r.unusable);
    const filled = elig.filter((r) => r.context.trim().length > 0);
    const empty = elig.filter((r) => r.context.trim().length === 0);
    return { eligible: elig, withContext: filled, toDo: empty };
  }, [rows]);

  // While running we show batchDone/batchTotal; otherwise the static
  // "already-have-context" coverage. Both feed the same ring.
  const num = running ? batchDone : withContext.length;
  const den = running ? batchTotal : eligible.length;
  const pct = den > 0 ? num / den : 0;

  // Ring geometry — small enough to sit comfortably next to the "CONTEXT" label.
  const R = 6;
  const C = 2 * Math.PI * R;
  const dashOffset = C * (1 - pct);

  async function handleClick() {
    if (running) { cancelRef.current = true; return; }
    if (toDo.length === 0) return;
    cancelRef.current = false;
    setRunning(true);
    setBatchDone(0);
    setBatchTotal(toDo.length);
    for (const row of toDo) {
      if (cancelRef.current) break;
      try { await autoContext(row); } catch { /* swallow per-row; keep going */ }
      setBatchDone((d) => d + 1);
    }
    setRunning(false);
  }

  const idleEmpty = !running && toDo.length === 0;
  const title = running
    ? `Generating context — ${batchDone} / ${batchTotal} done. Click to cancel.`
    : toDo.length > 0
      ? `Auto-write context for ${toDo.length} remaining row${toDo.length === 1 ? '' : 's'} (${withContext.length} / ${eligible.length} already filled)`
      : `All ${eligible.length} eligible row${eligible.length === 1 ? ' has' : 's have'} context filled in`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={idleEmpty}
      title={title}
      className={`flex h-6 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/40 px-1.5 transition-colors ${
        idleEmpty
          ? 'text-zinc-600'
          : running
            ? 'text-emerald-400 hover:bg-zinc-800'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-violet-300'
      }`}
    >
      {running ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2.5l1.6 4.3a4 4 0 0 0 2.4 2.4l4.3 1.6-4.3 1.6a4 4 0 0 0-2.4 2.4L12 19.5l-1.6-4.3a4 4 0 0 0-2.4-2.4L3.7 11.2l4.3-1.6a4 4 0 0 0 2.4-2.4z" />
        </svg>
      )}
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <circle cx="7" cy="7" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
        <circle
          cx="7" cy="7" r={R}
          fill="none"
          stroke="#10b981"
          strokeWidth="1.5"
          strokeDasharray={C}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 7 7)"
          style={{ transition: 'stroke-dashoffset 220ms ease-out' }}
        />
      </svg>
      <span className="tabular-nums text-[10px] font-medium normal-case tracking-normal text-zinc-400">
        {num}/{den}
      </span>
    </button>
  );
}

// Left-of-context "watch the clip and draft the context" button. Gemini reads
// the linked video (motion + speech) and fills the Context cell, so it doesn't
// have to be written by hand.
function AutoContextButton({ url, onRun }: { url: string; onRun: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const disabled = loading || !url.trim();
  async function run() {
    if (disabled) return;
    setLoading(true); setErr(null);
    try { await onRun(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }
  return (
    <button
      onClick={run}
      disabled={disabled}
      title={err ?? (url.trim() ? 'Auto-write context — Gemini watches the linked clip' : 'Add a link first')}
      className={`mt-1 ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
        err ? 'text-red-400 hover:bg-red-950/40' : 'text-zinc-500 hover:bg-zinc-800 hover:text-violet-300'
      }`}
    >
      {loading ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.5l1.6 4.3a4 4 0 0 0 2.4 2.4l4.3 1.6-4.3 1.6a4 4 0 0 0-2.4 2.4L12 19.5l-1.6-4.3a4 4 0 0 0-2.4-2.4L3.7 11.2l4.3-1.6a4 4 0 0 0 2.4-2.4z" />
        </svg>
      )}
    </button>
  );
}

const CELL_BASE =
  'w-full bg-transparent px-2 py-1.5 text-[13px] leading-snug text-zinc-200 outline-none placeholder:text-zinc-700 focus:bg-zinc-900/60';

// Single-line cell — stays one line and truncates with an ellipsis when not
// focused. Used for the URL column (no emoji picker — it's a link).
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

// Single-line free-text cell with the "@" emoji picker (Notes). Same look as
// CellInput; the picker floats under the cell — see useEmojiField / EmojiPicker.
function EmojiCellInput({
  value, onChange, onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { detect, picker } = useEmojiField(ref, onChange);
  return (
    <>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); detect(); }}
        onKeyUp={detect}
        onClick={detect}
        onBlur={onCommit}
        spellCheck={false}
        className={`${CELL_BASE} truncate`}
      />
      {picker}
    </>
  );
}

// Auto-growing multi-line cell — expands to fit wrapped text (caption / context).
// Both are free text, so it carries the "@" emoji picker too.
function CellTextarea({
  value, onChange, onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { detect, picker } = useEmojiField(ref, onChange);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  return (
    <>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => { onChange(e.target.value); resize(); detect(); }}
        onKeyUp={detect}
        onClick={detect}
        onBlur={onCommit}
        spellCheck={false}
        className={`${CELL_BASE} resize-none`}
      />
      {picker}
    </>
  );
}

// One existing data row, memoized. Because useBoard's handlers are now
// referentially stable and patchLocal only swaps the edited row's object (others
// keep identity), React.memo lets a keystroke in one row skip re-rendering all
// the others — the core fix for the board's typing/scroll jank with many rows.
const BoardRowItem = React.memo(function BoardRowItem({
  row, onTextChange, onTextCommit, toggleBool, deleteRow, autoContext,
}: {
  row: BoardRow;
  onTextChange: (id: string, field: TextField, value: string) => void;
  onTextCommit: (row: BoardRow, field: TextField) => void;
  toggleBool: (row: BoardRow, field: BoolField) => void;
  deleteRow: (id: string) => void;
  autoContext: (row: BoardRow) => Promise<void>;
}) {
  return (
    <tr className="group align-top">
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
      {TEXT_FIELDS.map((f) => {
        const cell = f.multiline ? (
          <CellTextarea
            value={row[f.key]}
            onChange={(v) => onTextChange(row.id, f.key, v)}
            onCommit={() => onTextCommit(row, f.key)}
          />
        ) : f.key === 'url' ? (
          <CellInput
            value={row[f.key]}
            onChange={(v) => onTextChange(row.id, f.key, v)}
            onCommit={() => onTextCommit(row, f.key)}
          />
        ) : (
          <EmojiCellInput
            value={row[f.key]}
            onChange={(v) => onTextChange(row.id, f.key, v)}
            onCommit={() => onTextCommit(row, f.key)}
          />
        );
        return (
          <td key={f.key} className="border border-zinc-800 p-0">
            {f.key === 'context' ? (
              <div className="flex items-start">
                <AutoContextButton url={row.url} onRun={() => autoContext(row)} />
                <div className="min-w-0 flex-1">{cell}</div>
              </div>
            ) : (
              cell
            )}
          </td>
        );
      })}
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
  );
});

export function BoardGrid({ board }: { board: UseBoardReturn }) {
  const {
    rows, loading, error,
    draft, setDraft, draftHasContent, posting, urlInputRef,
    onTextChange, onTextCommit, toggleBool, deleteRow, postDraft, autoContext, autoContextDraft,
  } = board;

  function renderTextCell(
    key: TextField,
    multiline: boolean,
    value: string,
    onChange: (v: string) => void,
    onCommit?: () => void,
    isDraftUrl = false,
  ) {
    // Caption / Context — multiline free text, emoji-enabled.
    if (multiline) {
      return <CellTextarea value={value} onChange={onChange} onCommit={onCommit} />;
    }
    // URL — a link, so no emoji picker. The draft's URL gets the focus ref +
    // Enter-to-post; existing rows' URL is a plain inline-edit.
    if (key === 'url') {
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
    // Notes — single-line free text, emoji-enabled.
    return <EmojiCellInput value={value} onChange={onChange} onCommit={onCommit} />;
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
                <th key={f.key} className="border border-zinc-800 px-2 py-2 font-medium">
                  {f.key === 'context' ? (
                    // Bulk auto-context button + green progress ring sits in
                    // the header so it scopes to the active tab's column and
                    // stays visible while the user works through rows.
                    <div className="flex items-center justify-between gap-2">
                      <span>{f.label}</span>
                      <BulkAutoContextButton rows={rows} autoContext={autoContext} />
                    </div>
                  ) : (
                    f.label
                  )}
                </th>
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
                  {f.key === 'context' ? (
                    // Generate the context from just the link, before posting —
                    // the ✨ writes into the draft so you can tweak then Post.
                    <div className="flex items-start">
                      <AutoContextButton url={draft.url} onRun={autoContextDraft} />
                      <div className="min-w-0 flex-1">
                        {renderTextCell(
                          f.key, f.multiline, draft[f.key],
                          (v) => setDraft((d) => ({ ...d, [f.key]: v })),
                        )}
                      </div>
                    </div>
                  ) : (
                    renderTextCell(
                      f.key, f.multiline, draft[f.key],
                      (v) => setDraft((d) => ({ ...d, [f.key]: v })),
                      undefined,
                      f.key === 'url',
                    )
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

            {/* Existing rows — memoized so editing one cell doesn't re-render the rest */}
            {rows.map((row) => (
              <BoardRowItem
                key={row.id}
                row={row}
                onTextChange={onTextChange}
                onTextCommit={onTextCommit}
                toggleBool={toggleBool}
                deleteRow={deleteRow}
                autoContext={autoContext}
              />
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
