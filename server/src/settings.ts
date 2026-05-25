import fs from "node:fs";
import path from "node:path";

const SETTINGS_PATH = path.resolve(process.cwd(), "data", "settings.json");

export type TileLayout = "horizontal" | "vertical" | "grid2x2";

export interface Settings {
  tileLayout: TileLayout;
  tileTopPx: number;          // reserved space at the top of the screen
  tileBottomPx: number;       // reserved space at the bottom (taskbar)
  staggerMs: number;          // delay between scrcpy launches
  borderless: boolean;        // scrcpy --window-borderless
  alwaysOnTop: boolean;       // scrcpy --always-on-top
  phoneTargetDir: string;     // where to push files on each phone
  monitorIndex: number;       // which monitor to tile onto
  screenWidthOverride: number | null;   // null = auto-detect
  screenHeightOverride: number | null;
  notifySound: boolean;       // play a ding on new incoming files
  notifyDesktop: boolean;     // show browser desktop notification on new files
}

const defaults: Settings = {
  tileLayout: "horizontal",
  tileTopPx: 0,
  tileBottomPx: 50,
  staggerMs: 350,
  borderless: false,
  alwaysOnTop: false,
  phoneTargetDir: "/sdcard/DCIM/Camera/",
  monitorIndex: 0,
  screenWidthOverride: null,
  screenHeightOverride: null,
  notifySound: true,
  notifyDesktop: true,
};

let current: Settings = { ...defaults };

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    current = { ...defaults, ...parsed };
  } catch {
    current = { ...defaults };
  }
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function saveSettings(next: Partial<Settings>): Settings {
  // Whitelist allowed keys and coerce types.
  const merged: Settings = { ...current };
  if (next.tileLayout === "horizontal" || next.tileLayout === "vertical" || next.tileLayout === "grid2x2") {
    merged.tileLayout = next.tileLayout;
  }
  if (Number.isFinite(next.tileTopPx as number)) merged.tileTopPx = Math.max(0, Math.floor(next.tileTopPx as number));
  if (Number.isFinite(next.tileBottomPx as number)) merged.tileBottomPx = Math.max(0, Math.floor(next.tileBottomPx as number));
  if (Number.isFinite(next.staggerMs as number)) merged.staggerMs = Math.max(0, Math.floor(next.staggerMs as number));
  if (typeof next.borderless === "boolean") merged.borderless = next.borderless;
  if (typeof next.alwaysOnTop === "boolean") merged.alwaysOnTop = next.alwaysOnTop;
  if (typeof next.notifySound === "boolean") merged.notifySound = next.notifySound;
  if (typeof next.notifyDesktop === "boolean") merged.notifyDesktop = next.notifyDesktop;
  if (typeof next.phoneTargetDir === "string" && next.phoneTargetDir.startsWith("/")) {
    merged.phoneTargetDir = next.phoneTargetDir;
  }
  if (Number.isFinite(next.monitorIndex as number)) {
    merged.monitorIndex = Math.max(0, Math.floor(next.monitorIndex as number));
  }
  if (next.screenWidthOverride === null) {
    merged.screenWidthOverride = null;
  } else if (Number.isFinite(next.screenWidthOverride as number)) {
    merged.screenWidthOverride = next.screenWidthOverride as number;
  }
  if (next.screenHeightOverride === null) {
    merged.screenHeightOverride = null;
  } else if (Number.isFinite(next.screenHeightOverride as number)) {
    merged.screenHeightOverride = next.screenHeightOverride as number;
  }
  current = merged;
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(current, null, 2));
  return current;
}
