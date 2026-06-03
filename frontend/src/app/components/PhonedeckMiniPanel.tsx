'use client';

// Floating mini panel that mirrors Phonedeck's Incoming list inside the
// Studio. Lives bottom-right, always on top, collapsible. Lets the user
// push a freshly-exported video straight to every connected phone without
// switching tabs.
//
// Connects to the Phonedeck server via SSE (live file list) + REST polling
// (device list). No code is shared between the two apps — just HTTP. The
// Phonedeck URL defaults to localhost:8080 (the dev port) and can be
// overridden with NEXT_PUBLIC_PHONEDECK_URL if Phonedeck runs on a peer
// machine on the LAN.

import { useEffect, useRef, useState } from 'react';

const PHONEDECK_URL = process.env.NEXT_PUBLIC_PHONEDECK_URL ?? 'http://localhost:8080';

interface FileRecord {
  name: string;
  size: number;
  receivedAt: number;
  status: 'new' | 'saved' | 'backlog';
  diskState: 'present' | 'deleted';
  sentEvents: Array<{ at: number; serials: string[]; okCount: number; errCount: number }>;
}

interface Device {
  serial: string;
  state: string;
  model?: string;
  name?: string | null;
}

function formatSize(bytes: number): string {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function PhonedeckMiniPanel() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connected, setConnected] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pushing, setPushing] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  // Panel position. null = default bottom-right via className. {x,y} = absolute
  // top-left in viewport coords (set on first drag, then sticky).
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef({
    startMouseX: 0, startMouseY: 0,
    startPanelX: 0, startPanelY: 0,
    moved: false,
  });
  const hydratedRef = useRef(false);

  // Hydrate collapsed + position from localStorage so the panel stays where
  // the user left it across refreshes.
  useEffect(() => {
    try {
      const c = window.localStorage.getItem('studio.phonedeckPanelCollapsed');
      if (c === 'true') setCollapsed(true);
      const p = window.localStorage.getItem('studio.phonedeckPanelPosition');
      if (p) {
        const parsed = JSON.parse(p) as { x: number; y: number };
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          setPosition(parsed);
        }
      }
    } catch { /* ignore */ }
    hydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try { window.localStorage.setItem('studio.phonedeckPanelCollapsed', String(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (position) window.localStorage.setItem('studio.phonedeckPanelPosition', JSON.stringify(position));
    } catch { /* ignore */ }
  }, [position]);

  // Drag — header is the grab handle. Clicking the header (no movement) still
  // toggles collapse; moving past a 3px threshold flips into drag mode.
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if (!panelRef.current) return;
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    dragStateRef.current = {
      startMouseX: e.clientX, startMouseY: e.clientY,
      startPanelX: rect.left, startPanelY: rect.top,
      moved: false,
    };
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      const dx = e.clientX - ds.startMouseX;
      const dy = e.clientY - ds.startMouseY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.moved = true;
      if (ds.moved) {
        // Clamp so at least 60px stays on-screen (so the user can always grab
        // it back if dragged near an edge).
        const w = panelRef.current?.offsetWidth ?? 256;
        const h = panelRef.current?.offsetHeight ?? 40;
        const maxX = window.innerWidth  - 60;
        const maxY = window.innerHeight - 30;
        setPosition({
          x: Math.max(60 - w, Math.min(maxX, ds.startPanelX + dx)),
          y: Math.max(0,      Math.min(maxY, ds.startPanelY + dy)),
        });
      }
    };
    const onUp = () => {
      setDragging(false);
      if (!dragStateRef.current.moved) setCollapsed(c => !c);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  // Live file feed.
  useEffect(() => {
    const es = new EventSource(`${PHONEDECK_URL}/api/stream`);
    es.addEventListener('files', (e) => {
      try {
        const data: FileRecord[] = JSON.parse((e as MessageEvent).data);
        setFiles(data);
        setConnected(true);
      } catch { /* malformed payload — ignore */ }
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  // Phones list — poll every 3s, matches the cadence Phonedeck's own UI uses.
  useEffect(() => {
    let cancelled = false;
    const fetchDevices = async () => {
      try {
        const r = await fetch(`${PHONEDECK_URL}/api/devices`);
        if (!r.ok) return;
        const data: Device[] = await r.json();
        if (!cancelled) setDevices(data);
      } catch { /* Phonedeck unreachable — fall through silently */ }
    };
    fetchDevices();
    const t = setInterval(fetchDevices, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const incoming = files.filter(f => f.status === 'new' && f.diskState === 'present');
  const ready = devices.filter(d => d.state === 'device');

  // Global sticky phone selection — one Set that applies to every file. Starts
  // empty (default Push -> 0). User toggles phones to add/remove; the selection
  // persists in localStorage so it survives page refresh and reapplies to
  // future files until the user changes it. Per-file independence isn't useful
  // for the typical "push to my usual phones" workflow.
  const [selectedSerials, setSelectedSerials] = useState<Set<string>>(new Set());
  const selectionHydratedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('studio.phonedeckSelectedSerials');
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setSelectedSerials(new Set(arr));
      }
    } catch { /* ignore */ }
    selectionHydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!selectionHydratedRef.current) return;
    try { window.localStorage.setItem('studio.phonedeckSelectedSerials', JSON.stringify([...selectedSerials])); } catch { /* ignore */ }
  }, [selectedSerials]);

  const togglePhone = (serial: string) => {
    setSelectedSerials(prev => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial); else next.add(serial);
      return next;
    });
  };
  const selectAll = () => setSelectedSerials(new Set(ready.map(d => d.serial)));
  const clearSelection = () => setSelectedSerials(new Set());

  const pushSelected = async (fileName: string) => {
    if (selectedSerials.size === 0) {
      setStatus(s => ({ ...s, [fileName]: 'No phones selected' }));
      setTimeout(() => setStatus(s => { const n = { ...s }; delete n[fileName]; return n; }), 3000);
      return;
    }
    setPushing(p => ({ ...p, [fileName]: true }));
    try {
      const r = await fetch(`${PHONEDECK_URL}/api/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, serials: [...selectedSerials] }),
      });
      if (!r.ok) throw new Error(await r.text());
      setStatus(s => ({ ...s, [fileName]: `✓ Sent to ${selectedSerials.size}` }));
      setTimeout(() => setStatus(s => { const n = { ...s }; delete n[fileName]; return n; }), 4000);
    } catch {
      setStatus(s => ({ ...s, [fileName]: 'Push failed' }));
      setTimeout(() => setStatus(s => { const n = { ...s }; delete n[fileName]; return n; }), 4000);
    } finally {
      setPushing(p => ({ ...p, [fileName]: false }));
    }
  };

  // When position is null, fall back to className's bottom-4 right-4. Once
  // the user starts dragging (or we hydrated a saved position), pin via inline
  // style instead.
  const positionStyle: React.CSSProperties | undefined = position
    ? { left: position.x, top: position.y, bottom: 'auto', right: 'auto' }
    : undefined;

  return (
    <div
      ref={panelRef}
      className="fixed bottom-4 right-4 w-64 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl z-40 overflow-hidden select-none"
      style={positionStyle}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 hover:bg-zinc-900 transition-colors ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        title={connected ? 'Phonedeck connected — drag to move, click to collapse' : 'Phonedeck offline — drag to move'}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[#04df9d]' : 'bg-zinc-600'}`} />
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
            Phonedeck <span className="text-zinc-500 tabular-nums">({ready.length})</span>
          </span>
          {connected && incoming.length > 0 && (
            <span className="text-[10px] text-zinc-500 shrink-0">{incoming.length} new</span>
          )}
        </div>
        <div className="flex items-center shrink-0">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
            {collapsed
              ? <polyline points="18 15 12 9 6 15"/>
              : <polyline points="6 9 12 15 18 9"/>}
          </svg>
        </div>
      </div>
      {!collapsed && (
        <div className="max-h-72 overflow-y-auto">
          {!connected ? (
            <div className="px-3 py-4 text-center text-[10px] text-zinc-600 leading-relaxed">
              Phonedeck server offline.<br />Start <code className="text-zinc-500">npm run dev</code> in <code className="text-zinc-500">phonedeck/server</code>.
            </div>
          ) : incoming.length === 0 ? (
            <div className="px-3 py-4 text-center text-[10px] text-zinc-600">
              No incoming files yet.
            </div>
          ) : (
            <div className="divide-y divide-zinc-900">
              {incoming.map(f => {
                const st = status[f.name];
                const busy = pushing[f.name];
                const allSelected  = ready.length > 0 && selectedSerials.size === ready.length;
                const noneSelected = selectedSerials.size === 0;
                return (
                  <div key={f.name} className="px-3 py-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] text-zinc-200 truncate flex-1" title={f.name}>{f.name}</span>
                      <span className="text-[9px] text-zinc-600 shrink-0">{formatSize(f.size)}</span>
                    </div>
                    {ready.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {ready.map(d => {
                          const isSel = selectedSerials.has(d.serial);
                          return (
                            <button
                              key={d.serial}
                              onClick={() => togglePhone(d.serial)}
                              title={d.serial}
                              className={`text-[10px] px-2 py-0.5 rounded transition-colors shrink-0 ${
                                isSel
                                  ? 'bg-[#04df9d] text-black hover:bg-[#03c98e]'
                                  : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:border-zinc-600'
                              }`}
                            >
                              {d.name ?? d.model ?? d.serial.slice(-4)}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-[10px] text-zinc-600 italic">No phones connected</span>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => pushSelected(f.name)}
                        disabled={busy || selectedSerials.size === 0}
                        className="flex items-center gap-1 h-6 px-2.5 rounded-md bg-white text-black hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[10px] font-semibold shrink-0"
                      >
                        {busy ? '…' : `Push → ${selectedSerials.size}`}
                      </button>
                      {!allSelected && ready.length > 0 && (
                        <button
                          onClick={selectAll}
                          className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors"
                        >All</button>
                      )}
                      {!noneSelected && (
                        <button
                          onClick={clearSelection}
                          className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors"
                        >None</button>
                      )}
                      <span className="flex-1" />
                      <span className={`text-[10px] truncate ${
                        st?.startsWith('✓') ? 'text-[#04df9d]' :
                        st === 'Push failed' || st === 'No phones selected' ? 'text-red-400' :
                        'text-zinc-600'
                      }`}>
                        {st ?? ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
