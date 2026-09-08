'use client';

// usePhonedeck — the live view of the local Phonedeck server that both of its
// faces in the Studio share: the floating panel on Media and the short list
// under the export buttons on Vids. Incoming files arrive over SSE, the phones
// by polling, and a push is one POST. No code is shared with the Phonedeck app
// itself — just HTTP to localhost:8080 (NEXT_PUBLIC_PHONEDECK_URL to point at
// a peer machine on the LAN).
//
// The phone selection is one sticky Set for every file — "my usual phones" —
// kept in localStorage so it survives a refresh and applies to the next file
// too. It lives in this module rather than in the hook's own state so every
// mounted instance reads and writes the same Set: pick a phone on Vids and the
// panel on Media has it picked as well.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PHONEDECK_URL } from '@/lib/canvasVideoExport';

export interface PhonedeckFile {
  name: string;
  size: number;
  receivedAt: number;
  status: 'new' | 'saved' | 'backlog';
  diskState: 'present' | 'deleted';
  sentEvents: Array<{ at: number; serials: string[]; okCount: number; errCount: number }>;
}

export interface PhonedeckDevice {
  serial: string;
  state: string;
  model?: string;
  name?: string | null;
}

export function formatSize(bytes: number): string {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// ── The shared phone selection ────────────────────────────────────────────────

const SELECTION_KEY = 'studio.phonedeckSelectedSerials';
const NO_SELECTION: ReadonlySet<string> = new Set();
let selection: ReadonlySet<string> | null = null; // null = not read from storage yet
const listeners = new Set<() => void>();

function readSelection(): ReadonlySet<string> {
  if (selection) return selection;
  let next: ReadonlySet<string> = new Set();
  try {
    const raw = window.localStorage.getItem(SELECTION_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) next = new Set(arr.filter((s): s is string => typeof s === 'string'));
    }
  } catch { /* storage blocked — start empty */ }
  selection = next;
  return next;
}

function writeSelection(next: ReadonlySet<string>) {
  selection = next;
  try { window.localStorage.setItem(SELECTION_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

function subscribeSelection(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const serverSelection = () => NO_SELECTION;

// ── The hook ──────────────────────────────────────────────────────────────────

/** onPushed fires with the file's name after a successful push to ≥1 phone, so
 *  the Studio can mark the originating board row Posted (the board flow marks
 *  on push, not on export). */
export function usePhonedeck({ onPushed }: { onPushed?: (fileName: string) => void } = {}) {
  const [files, setFiles] = useState<PhonedeckFile[]>([]);
  const [devices, setDevices] = useState<PhonedeckDevice[]>([]);
  const [connected, setConnected] = useState(false);
  const [pushing, setPushing] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const onPushedRef = useRef(onPushed);
  useEffect(() => { onPushedRef.current = onPushed; }, [onPushed]);

  // Live file feed.
  useEffect(() => {
    const es = new EventSource(`${PHONEDECK_URL}/api/stream`);
    es.addEventListener('files', (e) => {
      try {
        const data: PhonedeckFile[] = JSON.parse((e as MessageEvent).data);
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
        const data: PhonedeckDevice[] = await r.json();
        if (!cancelled) setDevices(data);
      } catch { /* Phonedeck unreachable — fall through silently */ }
    };
    fetchDevices();
    const t = setInterval(fetchDevices, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const incoming = files.filter((f) => f.status === 'new' && f.diskState === 'present');
  const ready = devices.filter((d) => d.state === 'device');

  const selectedSerials = useSyncExternalStore(subscribeSelection, readSelection, serverSelection);
  const togglePhone = (serial: string) => {
    const next = new Set(selectedSerials);
    if (next.has(serial)) next.delete(serial); else next.add(serial);
    writeSelection(next);
  };
  const selectAll = () => writeSelection(new Set(ready.map((d) => d.serial)));
  const clearSelection = () => writeSelection(new Set());

  // Bulk-sweep the Incoming list — mark every file currently shown as past, so
  // the list goes empty in one tap. The SSE rebroadcast updates `files`.
  const clearAllIncoming = async () => {
    if (incoming.length === 0) return;
    if (!confirm(`Mark all ${incoming.length} incoming file(s) as past?`)) return;
    try {
      await fetch(`${PHONEDECK_URL}/api/files/clear-incoming`, { method: 'POST' });
    } catch { /* the offline notice already covers this */ }
  };

  const flash = (fileName: string, text: string, ms: number) => {
    setStatus((s) => ({ ...s, [fileName]: text }));
    setTimeout(() => setStatus((s) => { const n = { ...s }; delete n[fileName]; return n; }), ms);
  };

  const pushSelected = async (fileName: string) => {
    if (selectedSerials.size === 0) {
      flash(fileName, 'No phones selected', 3000);
      return;
    }
    setPushing((p) => ({ ...p, [fileName]: true }));
    try {
      const r = await fetch(`${PHONEDECK_URL}/api/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, serials: [...selectedSerials] }),
      });
      if (!r.ok) throw new Error(await r.text());
      onPushedRef.current?.(fileName);
      flash(fileName, `✓ Sent to ${selectedSerials.size}`, 4000);
    } catch {
      flash(fileName, 'Push failed', 4000);
    } finally {
      setPushing((p) => ({ ...p, [fileName]: false }));
    }
  };

  return {
    connected, incoming, ready,
    selectedSerials, togglePhone, selectAll, clearSelection,
    pushing, status, pushSelected, clearAllIncoming,
  };
}
