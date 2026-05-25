import { useEffect, useState } from "react";

export type TileLayout = "horizontal" | "vertical" | "grid2x2";

export interface MonitorInfo {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

export interface SettingsShape {
  tileLayout: TileLayout;
  tileTopPx: number;
  tileBottomPx: number;
  staggerMs: number;
  borderless: boolean;
  alwaysOnTop: boolean;
  phoneTargetDir: string;
  monitorIndex: number;
  screenWidthOverride: number | null;
  screenHeightOverride: number | null;
  notifySound: boolean;
  notifyDesktop: boolean;
  detectedScreen?: { w: number; h: number };
  monitors?: MonitorInfo[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const [s, setS] = useState<SettingsShape | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: SettingsShape) => setS(data));
  }, [open]);

  if (!open) return null;
  if (!s) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>Loading...</div>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const next: SettingsShape = await r.json();
      setS(next);
      setStatus("Saved.");
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const detected = s.detectedScreen;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Settings</h2>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>

        <div className="settings-grid">
          <label className="span-2">
            <span>Target monitor {s.monitors && <em>({s.monitors.length} detected)</em>}</span>
            <select
              value={s.monitorIndex}
              onChange={(e) => setS({ ...s, monitorIndex: Number(e.target.value) })}
            >
              {(s.monitors ?? []).map((m) => (
                <option key={m.index} value={m.index}>
                  [{m.index}] {m.width}×{m.height} at ({m.x},{m.y}){m.primary ? " · primary" : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Tile layout</span>
            <select
              value={s.tileLayout}
              onChange={(e) => setS({ ...s, tileLayout: e.target.value as TileLayout })}
            >
              <option value="horizontal">Horizontal row (4 across)</option>
              <option value="vertical">Vertical column (stacked)</option>
              <option value="grid2x2">2×2 grid</option>
            </select>
          </label>

          <label>
            <span>Top reserved pixels</span>
            <input
              type="number"
              min={0}
              value={s.tileTopPx}
              onChange={(e) => setS({ ...s, tileTopPx: Number(e.target.value) })}
            />
          </label>

          <label>
            <span>Bottom reserved pixels (taskbar)</span>
            <input
              type="number"
              min={0}
              value={s.tileBottomPx}
              onChange={(e) => setS({ ...s, tileBottomPx: Number(e.target.value) })}
            />
          </label>

          <label>
            <span>Stagger between launches (ms)</span>
            <input
              type="number"
              min={0}
              value={s.staggerMs}
              onChange={(e) => setS({ ...s, staggerMs: Number(e.target.value) })}
            />
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={s.borderless}
              onChange={(e) => setS({ ...s, borderless: e.target.checked })}
            />
            <span>Borderless windows (no title bar)</span>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={s.alwaysOnTop}
              onChange={(e) => setS({ ...s, alwaysOnTop: e.target.checked })}
            />
            <span>Always on top</span>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={s.notifyDesktop}
              onChange={(e) => setS({ ...s, notifyDesktop: e.target.checked })}
            />
            <span>Desktop notification on new file</span>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={s.notifySound}
              onChange={(e) => setS({ ...s, notifySound: e.target.checked })}
            />
            <span>Play ding on new file</span>
          </label>

          <label className="span-2">
            <span>Phone target directory (where pushed videos land)</span>
            <input
              type="text"
              value={s.phoneTargetDir}
              onChange={(e) => setS({ ...s, phoneTargetDir: e.target.value })}
            />
          </label>

          <label>
            <span>Screen width override {detected && <em>(detected: {detected.w})</em>}</span>
            <input
              type="number"
              min={0}
              value={s.screenWidthOverride ?? ""}
              placeholder={detected ? `${detected.w}` : ""}
              onChange={(e) => setS({ ...s, screenWidthOverride: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>

          <label>
            <span>Screen height override {detected && <em>(detected: {detected.h})</em>}</span>
            <input
              type="number"
              min={0}
              value={s.screenHeightOverride ?? ""}
              placeholder={detected ? `${detected.h}` : ""}
              onChange={(e) => setS({ ...s, screenHeightOverride: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="modal-footer">
          <span className={`status ${status?.startsWith("Error") ? "err" : "ok"}`}>{status}</span>
          <button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
