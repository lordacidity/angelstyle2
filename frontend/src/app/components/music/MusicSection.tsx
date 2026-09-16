'use client';

// Music (Studio > Music) — every song in the library in one place. These are
// the songs Vids, the charts and the carousel pick from (/api/charts/list-audio):
// listen to any of them, give one a better name, mark it degen (every other
// song is just a song), trim it, upload new ones from this computer, delete an
// upload, and send any song to the Phonedeck as an MP3.
//
// A rename is the same rename as on the Clippers page (PATCH /api/vids/music),
// so the new name is the name in every picker, and degen goes through the same
// route. Only songs that were added — uploads, trims and songs saved from a
// link, track-custom-* — can be deleted or trimmed in place; the numbered
// tracks are part of the app, so a trim of one is always a new song.
//
// Send to Deck drops the MP3 in Phonedeck's Incoming list, from the browser
// straight to the local server the way a Vids export goes (a Next route would
// run on the host and never reach this PC). The Phonedeck panel beside the list
// pushes it on to the phones; the song just sent is lit at the top of it.

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { PHONEDECK_URL, safeExportName } from '@/lib/canvasVideoExport';
import { VidsPhonedeck } from '../vids/VidsPhonedeck';
import { TrimEditor } from './TrimEditor';

interface Track {
  url: string;
  label: string;
  durationMs: number;
  degen: boolean;
}

interface Upload {
  id: number;
  name: string;
  progress: number;
  state: 'uploading' | 'converting' | 'error';
  error?: string;
}

type DeckState =
  | { state: 'sending' }
  | { state: 'sent'; name: string }
  | { state: 'error'; error: string };

/** Which songs the list shows: all of them, the degen ones, or the rest. */
type View = 'all' | 'degen' | 'songs';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** When a song was added — its file is named for the moment. Null for the
 *  numbered tracks that ship with the app. */
const addedAt = (url: string): number | null => {
  const m = /\/track-custom-(\d+)\.mp3$/.exec(url);
  return m ? Number(m[1]) : null;
};

/** Newest additions first, then the numbered tracks in order. */
const byNewest = (a: Track, b: Track) => {
  const ta = addedAt(a.url);
  const tb = addedAt(b.url);
  if (ta !== null && tb !== null) return tb - ta;
  if (ta !== null) return -1;
  if (tb !== null) return 1;
  return a.url.localeCompare(b.url, undefined, { numeric: true });
};

/** Anything ffmpeg can take the sound from. */
const isMedia = (f: File) =>
  f.type.startsWith('audio/') || f.type.startsWith('video/') ||
  /\.(mp3|m4a|aac|wav|flac|ogg|opus|aiff?|wma|mp4|mov|m4v|webm|mkv)$/i.test(f.name);

const inView = (t: Track, view: View) => (view === 'all' ? true : view === 'degen' ? t.degen : !t.degen);

const ICON_BTN = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 disabled:opacity-30 disabled:hover:bg-transparent';

const DEGEN_ON = 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300';

export function MusicSection({ active }: { active: boolean }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('all');

  // ── The library ──
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/charts/list-audio', { cache: 'no-store' });
      if (!r.ok) throw new Error(`Couldn't load the music library (${r.status}).`);
      const rows = await r.json() as Array<Omit<Track, 'degen'> & { degen?: unknown }>;
      setTracks(rows.map((t) => ({ ...t, degen: t.degen === true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Every visit re-reads it: a song saved or renamed elsewhere shows up here.
  useEffect(() => { if (active) void load(); }, [active, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tracks
      .filter((t) => inView(t, view) && (!q || t.label.toLowerCase().includes(q)))
      .sort(byNewest);
  }, [tracks, query, view]);

  const views = useMemo(() => {
    const degen = tracks.filter((t) => t.degen).length;
    return [
      { id: 'all' as const, label: 'All', count: tracks.length },
      { id: 'degen' as const, label: 'Degen', count: degen },
      { id: 'songs' as const, label: 'Just songs', count: tracks.length - degen },
    ];
  }, [tracks]);

  // A song written over by a trim keeps its url, so the browser is sent to
  // the new file by a version on the end of it.
  const [versions, setVersions] = useState<Record<string, number>>({});
  const srcOf = useCallback((url: string) => (versions[url] ? `${url}?v=${versions[url]}` : url), [versions]);

  // Real lengths, read from each file's header one at a time. list-audio only
  // knows them for the songs it names in code and for uploads.
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const probed = useRef(new Set<string>());
  useEffect(() => {
    const todo = tracks.map((t) => t.url).filter((u) => !probed.current.has(u));
    if (todo.length === 0) return;
    let cancelled = false;
    const probe = new Audio();
    probe.preload = 'metadata';
    const next = () => {
      const url = todo.shift();
      if (cancelled || !url) return;
      probed.current.add(url);
      const done = (seconds: number) => {
        setLengths((l) => ({ ...l, [url]: seconds }));
        next();
      };
      probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) ? probe.duration : NaN);
      probe.onerror = () => done(NaN);
      probe.src = srcOf(url);
    };
    next();
    return () => {
      cancelled = true;
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.removeAttribute('src');
      probe.load();
    };
  }, [tracks, srcOf]);

  // ── Playback ── one player for the page; a new song stops the last.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);

  const toggle = (t: Track) => {
    const a = audioRef.current;
    if (!a) return;
    if (current === t.url) {
      if (a.paused) void a.play().catch(() => setError(`Couldn't play ${t.label}.`));
      else a.pause();
      return;
    }
    a.src = srcOf(t.url);
    setCurrent(t.url);
    setPos(0);
    void a.play().catch(() => setError(`Couldn't play ${t.label}.`));
  };

  const seek = (t: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = t;
    setPos(t);
  };

  /** Stop and let go of the file — before a song is deleted or written over. */
  const release = (url: string) => {
    if (current !== url) return;
    const a = audioRef.current;
    a?.pause();
    a?.removeAttribute('src');
    a?.load();
    setCurrent(null);
  };

  useEffect(() => { if (!active) audioRef.current?.pause(); }, [active]);

  // ── Rename ──
  const [editing, setEditing] = useState<{ url: string; value: string } | null>(null);

  const saveName = async () => {
    if (!editing) return;
    const track = tracks.find((t) => t.url === editing.url);
    const label = editing.value.trim();
    setEditing(null);
    if (!track || !label || label === track.label) return;
    const relabel = (to: string) => setTracks((ts) => ts.map((t) => (t.url === track.url ? { ...t, label: to } : t)));
    relabel(label);
    try {
      const r = await fetch('/api/vids/music', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: track.url, label }),
      });
      const body = await r.json().catch(() => ({})) as { label?: string; error?: string };
      if (!r.ok) throw new Error(body.error || `Rename failed (${r.status}).`);
      if (body.label) relabel(body.label);
    } catch (e) {
      relabel(track.label);
      setError(`Couldn't rename ${track.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── Degen ──
  const setDegen = async (track: Track, degen: boolean) => {
    const mark = (to: boolean) => setTracks((ts) => ts.map((t) => (t.url === track.url ? { ...t, degen: to } : t)));
    mark(degen);
    try {
      const r = await fetch('/api/vids/music', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: track.url, degen }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `failed (${r.status})`);
      }
    } catch (e) {
      mark(track.degen);
      setError(`Couldn't mark ${track.label} ${degen ? 'degen' : 'as just a song'}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── Delete ──
  const remove = async (t: Track) => {
    if (!confirm(`Delete "${t.label}"? It leaves the library for good, and every picker with it.`)) return;
    release(t.url);
    try {
      const r = await fetch(`/api/charts/delete-audio?url=${encodeURIComponent(t.url)}`, { method: 'DELETE' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Delete failed (${r.status}).`);
      }
      setTracks((ts) => ts.filter((x) => x.url !== t.url));
      if (trim?.url === t.url) setTrim(null);
    } catch (e) {
      setError(`Couldn't delete ${t.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── Upload ── one file at a time, so a folder of songs lands in order.
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const nextUploadId = useRef(1);

  useEffect(() => {
    if (!fresh) return;
    const id = setTimeout(() => setFresh(null), 4000);
    return () => clearTimeout(id);
  }, [fresh]);

  const uploadOne = (f: File) => new Promise<void>((resolve) => {
    const id = nextUploadId.current++;
    const patch = (p: Partial<Upload>) => setUploads((u) => u.map((j) => (j.id === id ? { ...j, ...p } : j)));
    if (!isMedia(f)) {
      setUploads((u) => [...u, { id, name: f.name, progress: 0, state: 'error', error: 'not an audio or video file' }]);
      resolve();
      return;
    }
    setUploads((u) => [...u, { id, name: f.name, progress: 0, state: 'uploading' }]);
    const form = new FormData();
    form.append('file', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/charts/upload-audio');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) patch({ progress: e.loaded / e.total }); };
    xhr.upload.onload = () => patch({ state: 'converting', progress: 1 });
    xhr.onload = () => {
      let body: { url?: string; label?: string; durationMs?: number | null; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON — the status says enough */ }
      const url = body.url;
      if (xhr.status >= 200 && xhr.status < 300 && url) {
        setUploads((u) => u.filter((j) => j.id !== id));
        setTracks((ts) => [
          { url, label: body.label ?? f.name, durationMs: body.durationMs ?? 0, degen: false },
          ...ts.filter((t) => t.url !== url),
        ]);
        setFresh(url);
      } else {
        patch({ state: 'error', error: body.error || `upload failed (${xhr.status})` });
      }
      resolve();
    };
    xhr.onerror = () => { patch({ state: 'error', error: 'network error' }); resolve(); };
    xhr.send(form);
  });

  const uploadAll = async (files: File[]) => {
    for (const f of files) await uploadOne(f);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    void uploadAll(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void uploadAll(Array.from(e.dataTransfer.files));
  };

  // ── Trim ── one song at a time.
  const [trim, setTrim] = useState<{ url: string; busy: 'copy' | 'replace' | null; error: string } | null>(null);

  const saveTrim = async (t: Track, mode: 'copy' | 'replace', start: number, end: number) => {
    setTrim({ url: t.url, busy: mode, error: '' });
    if (mode === 'replace') release(t.url);
    const round = (s: number) => Math.round(s * 1000) / 1000;
    try {
      const r = await fetch('/api/charts/trim-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: t.url, start: round(start), end: round(end), mode, label: `${t.label} (trim)` }),
      });
      const body = await r.json().catch(() => ({})) as { url?: string; label?: string; durationMs?: number; degen?: unknown; error?: string };
      if (!r.ok || !body.url) throw new Error(body.error || `Trim failed (${r.status}).`);
      if (mode === 'copy') {
        const url = body.url;
        setTracks((ts) => [
          { url, label: body.label ?? `${t.label} (trim)`, durationMs: body.durationMs ?? 0, degen: body.degen === true },
          ...ts,
        ]);
        setFresh(url);
      } else {
        setTracks((ts) => ts.map((x) => (x.url === t.url ? { ...x, durationMs: body.durationMs ?? x.durationMs } : x)));
        probed.current.delete(t.url);
        setLengths((l) => { const n = { ...l }; delete n[t.url]; return n; });
        setDeck((d) => { const n = { ...d }; delete n[t.url]; return n; });
        setVersions((v) => ({ ...v, [t.url]: Date.now() }));
        setFresh(t.url);
      }
      setTrim(null);
    } catch (e) {
      setTrim({ url: t.url, busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  // ── Send to Deck ──
  const [deck, setDeck] = useState<Record<string, DeckState>>({});
  const [recent, setRecent] = useState<string | null>(null);

  const sendToDeck = async (t: Track) => {
    const setState = (s: DeckState) => setDeck((d) => ({ ...d, [t.url]: s }));
    setState({ state: 'sending' });
    try {
      const song = await fetch(srcOf(t.url));
      if (!song.ok) throw new Error(`Couldn't read the song (${song.status}).`);
      const fileName = `${safeExportName(t.label)}.mp3`;
      const form = new FormData();
      form.append('files', await song.blob(), fileName);
      let resp: Response;
      try {
        resp = await fetch(`${PHONEDECK_URL}/api/upload`, { method: 'POST', body: form });
      } catch {
        throw new Error("Phonedeck isn't running on this PC.");
      }
      if (!resp.ok) throw new Error(`Phonedeck answered ${resp.status}.`);
      const result = await resp.json().catch(() => null) as { files?: Array<{ name: string }> } | null;
      // Phonedeck adds " (1)" when the name is taken, so the name it answers with is the one in Incoming.
      const name = result?.files?.[0]?.name ?? fileName;
      setState({ state: 'sent', name });
      setRecent(name);
    } catch (e) {
      setState({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div
      className="flex h-screen flex-col bg-black text-white"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
    >
      <input ref={inputRef} type="file" accept="audio/*,video/*" multiple className="hidden" onChange={onPick} />
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0); }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        className="hidden"
      />

      <div className="flex shrink-0 items-center gap-4 border-b border-zinc-900 px-6 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Music</h1>
          <p className="text-xs text-zinc-500">
            Every song in the library, the same ones Vids, the charts and the carousel pick from. Listen, rename, trim, mark the degen ones, upload, and send any of them to the Phonedeck as an MP3.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${tracks.length} song${tracks.length === 1 ? '' : 's'}`}
          className="h-8 w-56 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="h-8 shrink-0 rounded-md bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-zinc-200"
        >
          Upload
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-900 px-6 py-2">
        {views.map((v) => {
          const on = view === v.id;
          const tint = v.id === 'degen' ? DEGEN_ON : 'border-zinc-600 bg-zinc-800 text-white';
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-pressed={on}
              className={`h-7 rounded-full border px-3 text-xs transition-colors ${
                on ? tint : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200'
              }`}
            >
              {v.label} <span className="tabular-nums opacity-60">{v.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="max-w-4xl">
            {dragging && (
              <div className="mb-3 flex h-20 items-center justify-center rounded-xl border border-dashed border-zinc-500 bg-zinc-900 text-sm text-zinc-300">
                Drop songs to add them to the library
              </div>
            )}

            {uploads.map((u) => (
              <div key={u.id} className="mb-1 flex items-center gap-3 rounded-lg border border-zinc-900 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{u.name}</span>
                {u.state === 'error' ? (
                  <>
                    <span className="shrink-0 text-xs text-red-400">{u.error}</span>
                    <button type="button" onClick={() => setUploads((x) => x.filter((j) => j.id !== u.id))} className={`${ICON_BTN} hover:text-white`} title="Dismiss">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="h-1 w-32 shrink-0 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full bg-white transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs text-zinc-500">
                      {u.state === 'converting' ? 'Converting…' : `${Math.round(u.progress * 100)}%`}
                    </span>
                  </>
                )}
              </div>
            ))}

            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-950 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-white">Dismiss</button>
              </div>
            )}

            {loading && tracks.length === 0 ? (
              <p className="text-xs text-zinc-600">Loading the library…</p>
            ) : shown.length === 0 ? (
              <p className="text-xs text-zinc-600">
                {query.trim()
                  ? `No song matches "${query.trim()}".`
                  : view === 'all'
                    ? 'No songs yet. Upload one, or drop files anywhere on this page.'
                    : view === 'degen'
                      ? 'No degen songs yet. Mark one with its Degen button.'
                      : 'Every song is marked degen.'}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {shown.map((t) => {
                  const isCurrent = current === t.url;
                  const isPlaying = isCurrent && playing;
                  const trimming = trim?.url === t.url;
                  const added = addedAt(t.url);
                  const seconds = lengths[t.url];
                  const length = Number.isFinite(seconds) ? clock(seconds) : '–:––';
                  const d = deck[t.url];
                  const renaming = editing?.url === t.url;
                  return (
                    <div
                      key={t.url}
                      className={`rounded-lg border px-3 py-2 transition-colors ${
                        isCurrent || trimming ? 'border-zinc-700 bg-zinc-950'
                          : fresh === t.url ? 'border-emerald-900 bg-emerald-950/20'
                          : 'border-transparent hover:bg-zinc-950'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => toggle(t)}
                          title={isPlaying ? 'Pause' : 'Play'}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                            isCurrent ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                          }`}
                        >
                          {isPlaying ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          {renaming ? (
                            <input
                              autoFocus
                              value={editing.value}
                              maxLength={120}
                              onChange={(e) => setEditing({ url: t.url, value: e.target.value })}
                              onBlur={() => void saveName()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') setEditing(null);
                              }}
                              className="h-6 w-full rounded border border-zinc-700 bg-black px-1.5 text-sm text-white focus:border-zinc-500 focus:outline-none"
                            />
                          ) : (
                            <div
                              onDoubleClick={() => setEditing({ url: t.url, value: t.label })}
                              title="Double-click to rename"
                              className="truncate text-sm text-zinc-100"
                            >
                              {t.label}
                            </div>
                          )}
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-[11px] tabular-nums text-zinc-600">
                              {length} · {added !== null
                                ? `Added ${new Date(added).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                                : 'Built in'}
                            </span>
                            <button
                              type="button"
                              onClick={() => void setDegen(t, !t.degen)}
                              aria-pressed={t.degen}
                              title={t.degen ? 'Degen. Click to make it just a song.' : 'Just a song. Click to mark it degen.'}
                              className={`h-5 rounded-full border px-2 text-[10px] font-medium transition-colors ${
                                t.degen ? DEGEN_ON : 'border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-300'
                              }`}
                            >
                              Degen
                            </button>
                          </div>
                        </div>

                        <button type="button" onClick={() => setEditing({ url: t.url, value: t.label })} className={`${ICON_BTN} hover:text-white`} title="Rename">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTrim(trimming ? null : { url: t.url, busy: null, error: '' })}
                          disabled={!!trim?.busy}
                          className={`${ICON_BTN} ${trimming ? 'bg-zinc-900 text-white' : 'hover:text-white'}`}
                          title={trimming ? 'Close the trim editor' : 'Trim'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/></svg>
                        </button>
                        <a href={srcOf(t.url)} download={`${safeExportName(t.label)}.mp3`} className={`${ICON_BTN} hover:text-white`} title="Download MP3">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
                        </a>
                        <button
                          type="button"
                          onClick={() => void remove(t)}
                          disabled={added === null || !!(trimming && trim?.busy)}
                          className={`${ICON_BTN} hover:text-red-400 disabled:hover:text-zinc-500`}
                          title={added === null ? "Built-in tracks can't be deleted" : 'Delete'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => void sendToDeck(t)}
                          disabled={d?.state === 'sending'}
                          title={d?.state === 'sent' ? `In Phonedeck's Incoming as ${d.name} — click to send another copy` : "Put this MP3 in Phonedeck's Incoming"}
                          className={`h-7 w-[92px] shrink-0 rounded-md px-2 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                            d?.state === 'sent'
                              ? 'border border-[#04df9d]/40 text-[#04df9d] hover:border-[#04df9d]'
                              : 'bg-[#04df9d] text-black hover:bg-[#03c98e]'
                          }`}
                        >
                          {d?.state === 'sending' ? 'Sending…' : d?.state === 'sent' ? '✓ In Deck' : 'Send to Deck'}
                        </button>
                      </div>

                      {isCurrent && (
                        <div className="mt-2 flex items-center gap-3 pl-11">
                          <span className="w-9 text-right text-[11px] tabular-nums text-zinc-500">{clock(pos)}</span>
                          <input
                            type="range"
                            min={0}
                            max={Number.isFinite(seconds) && seconds > 0 ? seconds : 1}
                            step={0.1}
                            value={Number.isFinite(seconds) ? Math.min(pos, seconds) : 0}
                            onChange={(e) => seek(Number(e.target.value))}
                            className="flex-1 accent-white"
                          />
                          <span className="w-9 text-[11px] tabular-nums text-zinc-500">{length}</span>
                        </div>
                      )}

                      {trimming && trim && (
                        <div className="pl-11">
                          <TrimEditor
                            src={srcOf(t.url)}
                            label={t.label}
                            canReplace={added !== null}
                            pagePlaying={playing}
                            pausePage={() => audioRef.current?.pause()}
                            busy={trim.busy}
                            error={trim.error}
                            onCancel={() => setTrim(null)}
                            onSave={(mode, start, end) => void saveTrim(t, mode, start, end)}
                          />
                        </div>
                      )}

                      {d?.state === 'error' && <p className="mt-1 pl-11 text-[11px] text-red-400">{d.error}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-900 p-3">
          <VidsPhonedeck recent={recent} grow />
          <p className="mt-2 shrink-0 text-[10px] leading-relaxed text-zinc-600">
            Send to Deck puts a song in Incoming. Pick phones above and push it from there.
          </p>
        </aside>
      </div>
    </div>
  );
}
