'use client';

// useBoard — all the data plumbing for the Shared Board (the three Excel-like
// markets/athletes/artists tables backed by Railway Postgres via /api/board).
//
// Lifted out of BoardSection so the full-page board AND the floating media-tab
// widget (BoardWidget) can share one implementation: a single place for the
// load / add / inline-edit / boolean-toggle / delete logic. The presentational
// table that renders this state lives in BoardGrid; both surfaces compose
// useBoard + BoardGrid.
//
// Each useBoard() instance owns independent state (its own active tab + row
// cache), so the page and the widget don't fight over a shared store — they
// just both read/write the same API, so a refresh reconciles them.

import { useCallback, useEffect, useRef, useState } from 'react';

export type BoardTable = 'markets' | 'athletes' | 'artists';

export const TABS: { id: BoardTable; label: string }[] = [
  { id: 'markets', label: 'Gamers' },
  { id: 'athletes', label: 'Athletes' },
  { id: 'artists', label: 'Artists' },
];

export interface BoardRow {
  id: string;
  posted: boolean;
  unusable: boolean;
  url: string;
  vidCaption: string;
  context: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type BoolField = 'posted' | 'unusable';

// Editable text columns, in display order. `multiline` cells (caption/context)
// grow to fit wrapped text and take the bulk of the width; single-line cells
// (url/notes) stay one line, truncate with an ellipsis, and stay narrow.
export const TEXT_FIELDS = [
  { key: 'url', label: 'URL', multiline: false },
  { key: 'vidCaption', label: 'Vid caption', multiline: true },
  { key: 'context', label: 'Context', multiline: true },
  { key: 'notes', label: 'Notes', multiline: false },
] as const;
export type TextField = (typeof TEXT_FIELDS)[number]['key'];

export interface Draft {
  posted: boolean;
  unusable: boolean;
  url: string;
  vidCaption: string;
  context: string;
  notes: string;
}
const EMPTY_DRAFT: Draft = {
  posted: false, unusable: false, url: '', vidCaption: '', context: '', notes: '',
};

export interface UseBoardReturn {
  active: BoardTable;
  setActive: (t: BoardTable) => void;
  rows: BoardRow[];
  rowsByTable: Partial<Record<BoardTable, BoardRow[]>>;
  loading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  draftHasContent: boolean;
  posting: boolean;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  onTextChange: (id: string, field: TextField, value: string) => void;
  onTextCommit: (row: BoardRow, field: TextField) => void;
  toggleBool: (row: BoardRow, field: BoolField) => void;
  deleteRow: (id: string) => void;
  postDraft: () => void;
  // Force a row's Posted flag true (local + persisted). Used when a video that
  // came from this board is exported — see [[board widget send]] in BoardWidget.
  markPosted: (table: BoardTable, id: string) => void;
  // Resolve the row's link → playable clip → let Gemini watch it and draft the
  // 2-sentence Context, then persist into the Context cell. Throws on failure so
  // the caller (the ✨ button) can surface the message.
  autoContext: (row: BoardRow) => Promise<void>;
  // Same as autoContext, but for the not-yet-posted quick-add draft: writes the
  // generated context into the draft's Context cell so you can review it (and
  // tweak) before hitting Post. Lets you add just a link and generate from there.
  autoContextDraft: () => Promise<void>;
}

export function useBoard(): UseBoardReturn {
  const [active, setActive] = useState<BoardTable>('markets');
  const [rowsByTable, setRowsByTable] = useState<Partial<Record<BoardTable, BoardRow[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  // Tracks "cell has unsaved keystrokes" so blur only PATCHes when something
  // actually changed — keyed `${rowId}:${field}`.
  const dirty = useRef<Set<string>>(new Set());

  // Live refs for the latest active tab + row cache. The data handlers read these
  // instead of closing over `active` / `rowsByTable` directly, which keeps the
  // handlers referentially STABLE across edits. That stability is what lets the
  // memoized row (BoardGrid's BoardRowItem) skip re-rendering every other row on
  // each keystroke — the fix for the board's typing/scroll jank.
  const activeRef = useRef(active);
  activeRef.current = active;
  const rowsByTableRef = useRef(rowsByTable);
  rowsByTableRef.current = rowsByTable;

  const rows = rowsByTable[active] ?? [];
  const draftHasContent =
    draft.url.trim() !== '' || draft.vidCaption.trim() !== '' ||
    draft.context.trim() !== '' || draft.notes.trim() !== '';

  const loadTable = useCallback(async (t: BoardTable) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/board/${t}`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const data: BoardRow[] = await res.json();
      setRowsByTable((prev) => ({ ...prev, [t]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load a tab the first time it's viewed; reset the draft when switching tabs.
  useEffect(() => {
    if (rowsByTable[active] === undefined) void loadTable(active);
    setDraft(EMPTY_DRAFT);
  }, [active, rowsByTable, loadTable]);

  const patchLocal = useCallback((id: string, patch: Partial<BoardRow>) => {
    const table = activeRef.current;
    setRowsByTable((prev) => ({
      ...prev,
      [table]: (prev[table] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }, []);

  const savePatch = useCallback(async (id: string, patch: Partial<BoardRow>) => {
    try {
      const res = await fetch(`/api/board/${activeRef.current}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  }, []);

  const onTextChange = useCallback((id: string, field: TextField, value: string) => {
    dirty.current.add(`${id}:${field}`);
    patchLocal(id, { [field]: value } as Partial<BoardRow>);
  }, [patchLocal]);

  const onTextCommit = useCallback((row: BoardRow, field: TextField) => {
    const key = `${row.id}:${field}`;
    if (!dirty.current.has(key)) return;
    dirty.current.delete(key);
    const current = (rowsByTableRef.current[activeRef.current] ?? []).find((r) => r.id === row.id);
    if (current) void savePatch(row.id, { [field]: current[field] } as Partial<BoardRow>);
  }, [savePatch]);

  const toggleBool = useCallback((row: BoardRow, field: BoolField) => {
    const next = !row[field];
    patchLocal(row.id, { [field]: next } as Partial<BoardRow>);
    void savePatch(row.id, { [field]: next } as Partial<BoardRow>);
  }, [patchLocal, savePatch]);

  const postDraft = useCallback(async () => {
    if (!draftHasContent || posting) return;
    setPosting(true);
    setError(null);
    const tableAtPost = active;
    try {
      const res = await fetch(`/api/board/${tableAtPost}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const row: BoardRow = await res.json();
      // Newest on top — prepend so the just-added row appears at the top of the
      // board (matches the DESC load order in board-db listRows).
      setRowsByTable((prev) => ({ ...prev, [tableAtPost]: [row, ...(prev[tableAtPost] ?? [])] }));
      setDraft(EMPTY_DRAFT);
      urlInputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post row');
    } finally {
      setPosting(false);
    }
  }, [draftHasContent, posting, active, draft]);

  const deleteRow = useCallback(async (id: string) => {
    const table = activeRef.current;
    let snapshot: BoardRow[] = [];
    setRowsByTable((prev) => {
      snapshot = prev[table] ?? [];
      return { ...prev, [table]: snapshot.filter((r) => r.id !== id) };
    });
    try {
      const res = await fetch(`/api/board/${table}/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setRowsByTable((prev) => ({ ...prev, [table]: snapshot }));
      setError('Failed to delete row');
    }
  }, []);

  // Set posted=true for a row in any table (not just the active one) and persist
  // it. If that table isn't loaded yet the local map is left as-is — the PATCH
  // still lands, so it shows correct once the table is first opened.
  const markPosted = useCallback(async (table: BoardTable, id: string) => {
    setRowsByTable((prev) => {
      const list = prev[table];
      if (!list) return prev;
      return { ...prev, [table]: list.map((r) => (r.id === id ? { ...r, posted: true } : r)) };
    });
    try {
      const res = await fetch(`/api/board/${table}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posted: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark posted');
    }
  }, []);

  // Auto-context core: the link is all we have, so resolve it the same way the
  // media tab does (/api/download → playable url), hand the clip to Gemini
  // (/api/ai/auto-context), and return the drafted 2-sentence Context. Throws on
  // failure so callers (the ✨ buttons) can surface the message.
  const resolveContext = useCallback(async (rawLink: string): Promise<string> => {
    const link = rawLink.trim();
    if (!link) throw new Error('Add a link first.');

    const dl = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: link }),
    });
    const dlData = await dl.json().catch(() => ({})) as {
      id?: string; play?: string; hdplay?: string; wmplay?: string;
      title?: string; author?: { nickname?: string }; error?: string;
    };
    if (!dl.ok || dlData.error) throw new Error(dlData.error || 'Could not fetch the video.');
    // Raw playable URL — NOT bestVideoUrl(), which returns the browser /api/proxy
    // path. The route fetches this server-side, where the proxy isn't needed.
    const videoUrl = dlData.play || dlData.hdplay || dlData.wmplay || '';
    if (!videoUrl) throw new Error('No video found at that link.');

    const r = await fetch('/api/ai/auto-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl,
        sourceUrl: link,            // original share link → used to pull comments
        videoId:   dlData.id || undefined,
        title:     dlData.title || undefined,
        author:    dlData.author?.nickname || undefined,
      }),
    });
    const data = await r.json().catch(() => ({})) as { context?: string; error?: string };
    if (!r.ok || data.error || !data.context) throw new Error(data.error || 'Auto-context failed.');
    return data.context.trim();
  }, []);

  // Existing-row auto-context: write straight into the Context cell. We patch+save
  // the explicit value here rather than going through onTextChange/onTextCommit,
  // whose commit re-reads (stale) closure state.
  const autoContext = useCallback(async (row: BoardRow) => {
    const text = await resolveContext(row.url);
    patchLocal(row.id, { context: text });
    void savePatch(row.id, { context: text });
  }, [resolveContext, patchLocal, savePatch]);

  // Draft auto-context: generate from the quick-add link before the row exists,
  // dropping the result into the draft so it posts (or gets tweaked) from there.
  const autoContextDraft = useCallback(async () => {
    const text = await resolveContext(draft.url);
    setDraft((d) => ({ ...d, context: text }));
  }, [resolveContext, draft.url]);

  return {
    active, setActive, rows, rowsByTable, loading, error, setError,
    draft, setDraft, draftHasContent, posting, urlInputRef,
    onTextChange, onTextCommit, toggleBool, deleteRow, postDraft, markPosted,
    autoContext, autoContextDraft,
  };
}
