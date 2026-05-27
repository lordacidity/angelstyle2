import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export interface Device {
  serial: string;
  state: string;
  model?: string;
  product?: string;
}

export async function listDevices(): Promise<Device[]> {
  const { stdout } = await execFileAsync(config.adbPath, ["devices", "-l"]);
  const lines = stdout.split(/\r?\n/).slice(1);
  const bySerial = new Map<string, Device>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const [serial, state, ...rest] = parts;
    if (!serial || !state) continue;
    const device: Device = { serial, state };
    for (const kv of rest) {
      const [k, v] = kv.split(":");
      if (k === "model") device.model = v;
      if (k === "product") device.product = v;
    }
    // Prefer `device` state over any prior offline/unauthorized entry for the same serial.
    const prior = bySerial.get(serial);
    if (!prior || (prior.state !== "device" && device.state === "device")) {
      bySerial.set(serial, device);
    }
  }
  return [...bySerial.values()];
}

export interface PushResult {
  serial: string;
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function pushFile(serial: string, localPath: string, remoteDir: string): Promise<PushResult> {
  return new Promise((resolve) => {
    const remotePath = remoteDir.endsWith("/") ? remoteDir : remoteDir + "/";
    const args = ["-s", serial, "push", localPath, remotePath];
    const child = spawn(config.adbPath, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("close", (code) => {
      resolve({ serial, ok: code === 0, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ serial, ok: false, stdout, stderr: stderr + String(err) });
    });
  });
}

// Trigger a media scan so the gallery picks up the new file immediately.
// Android 10+ silently ignores the old MEDIA_SCANNER_SCAN_FILE broadcast for
// security reasons, so we call the MediaProvider's scan_volume method instead —
// it rescans external storage and Google Photos picks the file up right away.
// remotePath is unused but kept for call-site compatibility.
export function mediaScan(serial: string, _remotePath: string): Promise<void> {
  return new Promise((resolve) => {
    const args = [
      "-s", serial,
      "shell",
      "content", "call",
      "--uri", "content://media/external/file",
      "--method", "scan_volume",
      "--arg", "external_primary",
    ];
    const child = spawn(config.adbPath, args);
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

export interface ScrcpyWindowOpts {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
  borderless?: boolean;
  alwaysOnTop?: boolean;
  // Performance knobs — undefined means use scrcpy's native default (full
  // resolution / 60fps / ~8Mbps). Set these when launching multiple phones at
  // once so the host doesn't choke on 4× full-res H.264 streams.
  maxSize?: number;        // cap longest edge in px (e.g. 800)
  maxFps?: number;         // cap framerate (e.g. 30)
  videoBitRate?: string;   // e.g. "4M"
  noAudio?: boolean;       // skip the audio stream entirely
}

export function launchScrcpy(serial: string, opts: ScrcpyWindowOpts = {}): void {
  const args = ["-s", serial];
  if (opts.x !== undefined) args.push(`--window-x=${opts.x}`);
  if (opts.y !== undefined) args.push(`--window-y=${opts.y}`);
  if (opts.width !== undefined) args.push(`--window-width=${opts.width}`);
  if (opts.height !== undefined) args.push(`--window-height=${opts.height}`);
  if (opts.title) args.push(`--window-title=${opts.title}`);
  if (opts.borderless) args.push("--window-borderless");
  if (opts.alwaysOnTop) args.push("--always-on-top");
  if (opts.maxSize !== undefined) args.push(`--max-size=${opts.maxSize}`);
  if (opts.maxFps !== undefined) args.push(`--max-fps=${opts.maxFps}`);
  if (opts.videoBitRate) args.push(`--video-bit-rate=${opts.videoBitRate}`);
  if (opts.noAudio) args.push("--no-audio");
  // IMPORTANT: don't combine detached:true with windowsHide:true. They map
  // to mutually exclusive Win32 flags (DETACHED_PROCESS vs CREATE_NO_WINDOW);
  // when DETACHED wins, scrcpy has no console and every child adb call it
  // makes pops its own console window → dozens of terminals.
  // Plain windowsHide:true gives scrcpy a hidden console that its children
  // inherit. On Windows, child processes survive the parent exiting anyway,
  // so we don't need detached:true.
  const child = spawn(config.scrcpyPath, args, {
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => { /* swallow — don't crash server on spawn failure */ });
  child.unref();
}
