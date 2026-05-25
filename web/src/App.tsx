import { useEffect, useMemo, useRef, useState } from "react";
import { SettingsModal } from "./Settings";
import { AccountsModal, type Theme } from "./Accounts";
import { ThemePicker } from "./ThemePicker";
import { ensureNotificationPermission, playDing, showDesktopNotification } from "./notify";

interface SentEvent {
  at: number;
  themeIds?: string[];
  serials: string[];
  okCount: number;
  errCount: number;
}

interface FileRecord {
  name: string;
  size: number;
  receivedAt: number;
  status: "new" | "saved";
  diskState: "present" | "deleted";
  sentEvents: SentEvent[];
}

interface Device {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  name?: string | null;
}

interface PushResult {
  serial: string;
  ok: boolean;
  stdout: string;
  stderr: string;
}

function formatSize(bytes: number): string {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

export function App() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [statuses, setStatuses] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [fileThemes, setFileThemes] = useState<Record<string, string[]>>({});
  const [manualMode, setManualMode] = useState<Record<string, boolean>>({});
  // Track filenames we've seen so we can detect arrivals on the SSE stream.
  // Read inside the SSE callback so it isn't captured stale.
  const seenNames = useRef<Set<string> | null>(null);
  // Latest notification prefs, read inside SSE callback. Polled alongside themes.
  const notifyPrefs = useRef({ sound: true, desktop: true });

  // Ask for notification permission once on mount.
  useEffect(() => { ensureNotificationPermission(); }, []);

  // Pull notification prefs from settings; refresh every 5s so toggles take
  // effect without a page reload.
  useEffect(() => {
    const fetchPrefs = async () => {
      try {
        const s = await fetch("/api/settings").then((r) => r.json());
        notifyPrefs.current = {
          sound: s.notifySound !== false,
          desktop: s.notifyDesktop !== false,
        };
      } catch { /* ignore */ }
    };
    fetchPrefs();
    const t = setInterval(fetchPrefs, 5000);
    return () => clearInterval(t);
  }, []);

  const reloadThemes = async () => {
    const r = await fetch("/api/themes");
    setThemes(await r.json());
  };
  useEffect(() => {
    reloadThemes();
    const t = setInterval(reloadThemes, 5000);
    return () => clearInterval(t);
  }, []);

  // SSE: live file list + notify on newly-arrived files.
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("files", (e) => {
      const data: FileRecord[] = JSON.parse((e as MessageEvent).data);
      // On first message after page load, seed the set without notifying — we
      // don't want to ding for every existing file. Subsequent messages
      // compare against the set to find genuine arrivals.
      if (seenNames.current === null) {
        seenNames.current = new Set(data.map((f) => f.name));
      } else {
        for (const f of data) {
          if (!seenNames.current.has(f.name) && f.status === "new" && f.diskState === "present") {
            const prefs = notifyPrefs.current;
            if (prefs.desktop) {
              showDesktopNotification("Phonedeck — new video", `${f.name} · ${formatSize(f.size)}`, f.name);
            }
            if (prefs.sound) playDing();
          }
          seenNames.current.add(f.name);
        }
      }
      setFiles(data);
    });
    return () => es.close();
  }, []);

  // Poll device list every 3s
  useEffect(() => {
    let cancelled = false;
    const fetchDevices = async () => {
      try {
        const r = await fetch("/api/devices");
        if (!r.ok) return;
        const data: Device[] = await r.json();
        if (!cancelled) setDevices(data);
      } catch { /* ignore */ }
    };
    fetchDevices();
    const t = setInterval(fetchDevices, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const ready = useMemo(() => devices.filter((d) => d.state === "device"), [devices]);

  const toggle = (fileName: string, serial: string) => {
    setSelections((prev) => {
      const cur = new Set(prev[fileName] ?? []);
      if (cur.has(serial)) cur.delete(serial); else cur.add(serial);
      return { ...prev, [fileName]: cur };
    });
  };

  const selectAll = (fileName: string) => {
    setSelections((prev) => ({ ...prev, [fileName]: new Set(ready.map((d) => d.serial)) }));
  };

  const clearSel = (fileName: string) => {
    setSelections((prev) => ({ ...prev, [fileName]: new Set() }));
  };

  const push = async (fileName: string) => {
    const serials = [...(selections[fileName] ?? [])];
    if (serials.length === 0) return;
    setBusy((b) => ({ ...b, [fileName]: true }));
    setStatuses((s) => ({ ...s, [fileName]: { ok: true, msg: `Pushing to ${serials.length} phone(s)...` } }));
    try {
      const r = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, serials }),
      });
      const data: { results: PushResult[] } = await r.json();
      const allOk = data.results.every((x) => x.ok);
      const lines = data.results.map((x) =>
        x.ok ? `OK  ${nameFor(x.serial)}` : `ERR ${nameFor(x.serial)}: ${x.stderr.trim() || "failed"}`,
      );
      setStatuses((s) => ({ ...s, [fileName]: { ok: allOk, msg: lines.join("\n") } }));
    } catch (err) {
      setStatuses((s) => ({ ...s, [fileName]: { ok: false, msg: String(err) } }));
    } finally {
      setBusy((b) => ({ ...b, [fileName]: false }));
    }
  };

  const nameFor = (serial: string) =>
    devices.find((d) => d.serial === serial)?.name ?? shortSerial(serial);

  const pushTheme = async (fileName: string) => {
    const themeIds = fileThemes[fileName] ?? [];
    if (themeIds.length === 0) return;
    const themeNames = themes.filter((t) => themeIds.includes(t.id)).map((t) => t.name);
    const label = themeNames.length === 1 ? `"${themeNames[0]}"` : `${themeNames.length} themes`;
    setBusy((b) => ({ ...b, [fileName]: true }));
    setStatuses((s) => ({ ...s, [fileName]: { ok: true, msg: `Sending to ${label}...` } }));
    try {
      const r = await fetch("/api/push-theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, themeIds }),
      });
      const data: { results: PushResult[]; serials: string[]; unreachable: string[] } = await r.json();
      if (data.results.length === 0) {
        setStatuses((s) => ({
          ...s,
          [fileName]: { ok: false, msg: `No connected phones in ${label}.` },
        }));
        return;
      }
      const allOk = data.results.every((x) => x.ok);
      const lines = data.results.map((x) =>
        x.ok ? `OK  ${nameFor(x.serial)}` : `ERR ${nameFor(x.serial)}: ${x.stderr.trim() || "failed"}`,
      );
      if (data.unreachable.length > 0) {
        lines.push(`(unreachable: ${data.unreachable.map(nameFor).join(", ")})`);
      }
      setStatuses((s) => ({ ...s, [fileName]: { ok: allOk, msg: lines.join("\n") } }));
    } catch (err) {
      setStatuses((s) => ({ ...s, [fileName]: { ok: false, msg: String(err) } }));
    } finally {
      setBusy((b) => ({ ...b, [fileName]: false }));
    }
  };

  const remove = async (fileName: string) => {
    if (!confirm(`Delete ${fileName} from the watch folder?`)) return;
    await fetch(`/api/files/${encodeURIComponent(fileName)}`, { method: "DELETE" });
  };

  const launchScrcpy = async (serial: string) => {
    await fetch("/api/scrcpy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial }),
    });
  };

  const [openingAll, setOpeningAll] = useState(false);
  const launchAllScrcpy = async () => {
    if (openingAll) return;
    setOpeningAll(true);
    try {
      await fetch("/api/scrcpy/all", { method: "POST" });
    } finally {
      // Stagger on the server is 350ms per device + setup time; lock the
      // button until they're all in flight.
      setTimeout(() => setOpeningAll(false), Math.max(2000, ready.length * 500));
    }
  };

  const saveFile = async (fileName: string) => {
    await fetch(`/api/files/${encodeURIComponent(fileName)}/save`, { method: "POST" });
  };

  return (
    <div className="app">
      <div className="app-header">
        <div>
          <h1>Phonedeck</h1>
          <div className="subtitle">Incoming videos arrive from the sender. Save or send to phones.</div>
        </div>
        <div className="row">
          <button className="secondary" onClick={() => setAccountsOpen(true)}>Accounts</button>
          <button className="secondary" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AccountsModal
        open={accountsOpen}
        onClose={() => { setAccountsOpen(false); reloadThemes(); }}
      />

      <div className="grid">
        <div>
          {(() => {
            const incoming = files.filter((f) => f.status === "new" && f.diskState === "present");
            const past = files.filter((f) => f.status === "saved");
            const renderFile = (f: FileRecord) => {
              const sel = selections[f.name] ?? new Set<string>();
              const st = statuses[f.name];
              const sent = f.sentEvents.length > 0;
              const onDisk = f.diskState === "present";
              return (
                <div className={`file${!onDisk ? " file-deleted" : ""}`} key={f.name}>
                  <div className="file-header">
                    <div className="file-name">
                      {sent && <span className="sent-badge" title={`Sent ${f.sentEvents.length}×`}>✓</span>}
                      {f.name}
                      {!onDisk && <span className="file-meta"> (deleted from disk)</span>}
                    </div>
                    <div className="file-meta">{formatSize(f.size)} · {formatTime(f.receivedAt)}</div>
                  </div>

                  {onDisk && manualMode[f.name] ? (
                    <>
                      <div className="phones">
                        {ready.length === 0 && <span className="file-meta">No phones connected.</span>}
                        {ready.map((d) => {
                          const checked = sel.has(d.serial);
                          return (
                            <label key={d.serial} className={`phone-pill${checked ? " checked" : ""}`}>
                              <input type="checkbox" checked={checked} onChange={() => toggle(f.name, d.serial)} />
                              {d.name ?? d.model ?? shortSerial(d.serial)}
                            </label>
                          );
                        })}
                      </div>
                      <div className="row">
                        <button onClick={() => push(f.name)} disabled={sel.size === 0 || busy[f.name]}>
                          {busy[f.name] ? "Pushing..." : `Push to ${sel.size} phone(s)`}
                        </button>
                        <button className="secondary" onClick={() => selectAll(f.name)} disabled={ready.length === 0}>Select all</button>
                        <button className="secondary" onClick={() => clearSel(f.name)} disabled={sel.size === 0}>Clear</button>
                        <button className="secondary" onClick={() => setManualMode((m) => ({ ...m, [f.name]: false }))}>
                          ← Back to themes
                        </button>
                        <button className="danger" onClick={() => remove(f.name)}>Delete</button>
                      </div>
                    </>
                  ) : (
                    <div className="row">
                      {onDisk ? (
                        <>
                          <ThemePicker
                            themes={themes}
                            selected={fileThemes[f.name] ?? []}
                            onChange={(next) => setFileThemes((m) => ({ ...m, [f.name]: next }))}
                            onManual={() => setManualMode((m) => ({ ...m, [f.name]: true }))}
                          />
                          <button
                            onClick={() => pushTheme(f.name)}
                            disabled={(fileThemes[f.name] ?? []).length === 0 || busy[f.name]}
                          >
                            {busy[f.name]
                              ? "Sending..."
                              : `Send${(fileThemes[f.name] ?? []).length > 0 ? ` (${(fileThemes[f.name] ?? []).length})` : ""}`}
                          </button>
                          {f.status === "new" && (
                            <button className="secondary" onClick={() => saveFile(f.name)}>Save</button>
                          )}
                          <button className="danger" onClick={() => remove(f.name)}>Delete</button>
                        </>
                      ) : (
                        <button className="danger" onClick={() => remove(f.name)}>Remove from history</button>
                      )}
                    </div>
                  )}

                  {st && <div className={`status ${st.ok ? "ok" : "err"}`}>{st.msg}</div>}
                </div>
              );
            };

            return (
              <>
                <h2>Incoming ({incoming.length})</h2>
                {incoming.length === 0 && <div className="card empty">No new files. Drag one to the sender on Computer 1.</div>}
                {incoming.map(renderFile)}

                <h2 style={{ marginTop: 24 }}>Past files ({past.length})</h2>
                {past.length === 0 && <div className="card empty">Nothing yet — saved/sent files will appear here.</div>}
                {past.map(renderFile)}
              </>
            );
          })()}
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Phones ({ready.length})</h2>
            <button
              className="secondary"
              onClick={launchAllScrcpy}
              disabled={ready.length === 0 || openingAll}
              title="Launch scrcpy on every connected phone"
            >
              {openingAll ? "Opening..." : "Open all"}
            </button>
          </div>
          {devices.length === 0 && <div className="empty">No devices.</div>}
          {devices.map((d) => (
            <div className="device-row" key={d.serial}>
              <div className="device-info">
                <div className="device-model">{d.name ?? d.model ?? "Unknown"}</div>
                <div className="device-serial">{d.serial} · {d.state}</div>
              </div>
              <button
                className="secondary"
                disabled={d.state !== "device"}
                onClick={() => launchScrcpy(d.serial)}
              >
                scrcpy
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function shortSerial(s: string): string {
  return s.length > 8 ? s.slice(0, 4) + "…" + s.slice(-4) : s;
}
