import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { config } from "./config.js";
import { IncomingWatcher } from "./watcher.js";
import { listDevices, pushFile, mediaScan, launchScrcpy } from "./adb.js";
import { loadSettings, getSettings, saveSettings } from "./settings.js";
import * as store from "./store.js";
import * as filesStore from "./filesStore.js";

loadSettings();

export interface Monitor {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

function detectMonitors(): Monitor[] {
  try {
    // Use execFileSync + args array so we bypass cmd.exe shell parsing
    // (the dollar signs in the PowerShell script were getting mangled).
    const psScript =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { ' +
      '"$($_.DeviceName)|$($_.Bounds.X)|$($_.Bounds.Y)|$($_.Bounds.Width)|$($_.Bounds.Height)|$($_.Primary)" }';
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", psScript], {
      encoding: "utf8",
      timeout: 5000,
    });
    const monitors: Monitor[] = [];
    for (const line of out.trim().split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [name, x, y, w, h, primary] = line.split("|");
      monitors.push({
        index: monitors.length,
        name: (name ?? "").trim(),
        x: Number(x), y: Number(y),
        width: Number(w), height: Number(h),
        primary: primary?.trim() === "True",
      });
    }
    if (monitors.length > 0) return monitors;
  } catch { /* fall through */ }
  return [{ index: 0, name: "Primary", x: 0, y: 0, width: 1920, height: 1080, primary: true }];
}

const DETECTED_MONITORS = detectMonitors();
const PRIMARY = DETECTED_MONITORS.find((m) => m.primary) ?? DETECTED_MONITORS[0];
const DETECTED_SCREEN = { w: PRIMARY.width, h: PRIMARY.height };

function effectiveMonitor(): Monitor {
  const s = getSettings();
  const m = DETECTED_MONITORS[s.monitorIndex] ?? PRIMARY;
  // Allow manual override of size for edge cases like remote displays.
  return {
    ...m,
    width: s.screenWidthOverride ?? m.width,
    height: s.screenHeightOverride ?? m.height,
  };
}

function tileGrid(n: number) {
  const s = getSettings();
  const mon = effectiveMonitor();
  const tileW = mon.width;
  const tileH = mon.height - s.tileTopPx - s.tileBottomPx;
  const baseX = mon.x;
  const baseY = mon.y + s.tileTopPx;

  if (s.tileLayout === "vertical") {
    const rowH = Math.floor(tileH / n);
    return Array.from({ length: n }, (_, i) => ({
      x: baseX,
      y: baseY + i * rowH,
      width: tileW,
      height: rowH,
    }));
  }

  if (s.tileLayout === "grid2x2") {
    const cols = 2;
    const rows = Math.ceil(n / cols);
    const colW = Math.floor(tileW / cols);
    const rowH = Math.floor(tileH / rows);
    return Array.from({ length: n }, (_, i) => ({
      x: baseX + (i % cols) * colW,
      y: baseY + Math.floor(i / cols) * rowH,
      width: colW,
      height: rowH,
    }));
  }

  // horizontal (default)
  const colW = Math.floor(tileW / n);
  return Array.from({ length: n }, (_, i) => ({
    x: baseX + i * colW,
    y: baseY,
    width: colW,
    height: tileH,
  }));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const app = express();
app.use(cors());
app.use(express.json());

fs.mkdirSync(config.watchDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.watchDir),
    filename: (_req, file, cb) => {
      // Preserve original filename; on collision, append " (N)" before extension.
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext);
      let candidate = file.originalname;
      let n = 1;
      while (fs.existsSync(path.join(config.watchDir, candidate))) {
        candidate = `${base} (${n})${ext}`;
        n++;
      }
      cb(null, candidate);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50 GB cap
});

const watcher = new IncomingWatcher(config.watchDir);
watcher.start();

app.get("/api/files", (_req, res) => {
  res.json(filesStore.getAll());
});

app.post("/api/upload", upload.array("files"), (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  res.json({ ok: true, files: files.map((f) => ({ name: f.filename, size: f.size })) });
});

app.delete("/api/files/:name", async (req, res) => {
  const ok = await watcher.remove(req.params.name);
  res.json({ ok });
});

app.post("/api/files/:name/save", (req, res) => {
  const rec = filesStore.markSaved(req.params.name);
  if (!rec) { res.status(404).json({ error: "not found" }); return; }
  res.json(rec);
});

app.get("/api/devices", async (_req, res) => {
  try {
    const devices = await listDevices();
    const enriched = devices.map((d) => ({ ...d, name: store.getPhoneName(d.serial) ?? null }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/push", async (req, res) => {
  const { fileName, serials } = req.body as { fileName: string; serials: string[] };
  const rec = filesStore.get(fileName);
  if (!rec || rec.diskState !== "present") {
    res.status(404).json({ error: "file not on disk" });
    return;
  }
  if (!Array.isArray(serials) || serials.length === 0) {
    res.status(400).json({ error: "serials required" });
    return;
  }
  const filePath = watcher.filePath(fileName);
  const phoneTargetDir = getSettings().phoneTargetDir;
  const results = await Promise.all(
    serials.map((s) => pushFile(s, filePath, phoneTargetDir)),
  );
  await Promise.all(
    results
      .filter((r) => r.ok)
      .map((r) =>
        mediaScan(r.serial, phoneTargetDir.replace(/\/$/, "") + "/" + fileName),
      ),
  );
  const okCount = results.filter((r) => r.ok).length;
  filesStore.recordSent(fileName, {
    at: Date.now(),
    serials: results.filter((r) => r.ok).map((r) => r.serial),
    okCount,
    errCount: results.length - okCount,
  });
  res.json({ results });
});

app.post("/api/scrcpy", (req, res) => {
  const { serial } = req.body as { serial: string };
  if (!serial) {
    res.status(400).json({ error: "serial required" });
    return;
  }
  try {
    launchScrcpy(serial);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/scrcpy/all", async (_req, res) => {
  try {
    const all = await listDevices();
    const ready = all.filter((d) => d.state === "device");
    if (ready.length === 0) {
      res.json({ ok: true, launched: 0, layout: null });
      return;
    }
    const s = getSettings();
    const slots = tileGrid(ready.length);
    for (let i = 0; i < ready.length; i++) {
      const d = ready[i];
      const slot = slots[i];
      const friendly = store.getPhoneName(d.serial);
      launchScrcpy(d.serial, {
        ...slot,
        title: `${friendly ?? d.model ?? d.serial}  ·  ${d.serial.slice(-4)}`,
        borderless: s.borderless,
        alwaysOnTop: s.alwaysOnTop,
      });
      if (i < ready.length - 1) await sleep(s.staggerMs);
    }
    res.json({ ok: true, launched: ready.length, layout: slots, monitor: effectiveMonitor() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/settings", (_req, res) => {
  res.json({ ...getSettings(), detectedScreen: DETECTED_SCREEN, monitors: DETECTED_MONITORS });
});

app.put("/api/settings", (req, res) => {
  try {
    const next = saveSettings(req.body ?? {});
    res.json({ ...next, detectedScreen: DETECTED_SCREEN, monitors: DETECTED_MONITORS });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ---- phones (friendly names) ----
app.get("/api/phones", (_req, res) => {
  res.json(store.listPhones());
});
app.put("/api/phones/:serial", (req, res) => {
  const { name } = req.body as { name?: string };
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name required" });
    return;
  }
  res.json(store.setPhoneName(req.params.serial, name.trim()));
});

// ---- themes ----
app.get("/api/themes", (_req, res) => res.json(store.listThemes()));
app.post("/api/themes", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  res.json(store.createTheme(name));
});
app.put("/api/themes/:id", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const t = store.updateTheme(req.params.id, name);
  if (!t) { res.status(404).json({ error: "not found" }); return; }
  res.json(t);
});
app.delete("/api/themes/:id", (req, res) => {
  store.deleteTheme(req.params.id);
  res.json({ ok: true });
});

// ---- accounts ----
app.get("/api/accounts", (_req, res) => res.json(store.listAccounts()));
app.post("/api/accounts", (req, res) => {
  try {
    const { phoneSerial, platform, username, themeIds } = req.body ?? {};
    if (!phoneSerial || !platform || !username) {
      res.status(400).json({ error: "phoneSerial, platform, username required" });
      return;
    }
    res.json(store.createAccount({
      phoneSerial: String(phoneSerial),
      platform,
      username: String(username).trim(),
      themeIds: Array.isArray(themeIds) ? themeIds : [],
    }));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});
app.put("/api/accounts/:id", (req, res) => {
  try {
    const a = store.updateAccount(req.params.id, req.body ?? {});
    if (!a) { res.status(404).json({ error: "not found" }); return; }
    res.json(a);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});
app.delete("/api/accounts/:id", (req, res) => {
  store.deleteAccount(req.params.id);
  res.json({ ok: true });
});

// ---- push by theme ----
app.post("/api/push-theme", async (req, res) => {
  const body = (req.body ?? {}) as { fileName?: string; themeId?: string; themeIds?: string[] };
  const fileName = body.fileName;
  // Accept either a single themeId (legacy) or an array of themeIds.
  const themeIds = Array.isArray(body.themeIds) ? body.themeIds : body.themeId ? [body.themeId] : [];
  if (!fileName || themeIds.length === 0) {
    res.status(400).json({ error: "fileName and themeIds[] required" });
    return;
  }
  const rec = filesStore.get(fileName);
  if (!rec || rec.diskState !== "present") {
    res.status(404).json({ error: "file not on disk" });
    return;
  }
  // Union of all phones in any of the selected themes (deduped).
  const serialSet = new Set<string>();
  for (const tid of themeIds) {
    for (const s of store.phonesForTheme(tid)) serialSet.add(s);
  }
  const serials = [...serialSet];
  if (serials.length === 0) {
    res.json({ results: [], serials: [], unreachable: [] });
    return;
  }
  const ready = new Set((await listDevices()).filter((d) => d.state === "device").map((d) => d.serial));
  const reachable = serials.filter((s) => ready.has(s));

  const filePath = watcher.filePath(fileName);
  const phoneTargetDir = getSettings().phoneTargetDir;
  const results = await Promise.all(
    reachable.map((s) => pushFile(s, filePath, phoneTargetDir)),
  );
  await Promise.all(
    results
      .filter((r) => r.ok)
      .map((r) =>
        mediaScan(r.serial, phoneTargetDir.replace(/\/$/, "") + "/" + fileName),
      ),
  );
  const okCount = results.filter((r) => r.ok).length;
  filesStore.recordSent(fileName, {
    at: Date.now(),
    themeIds,
    serials: results.filter((r) => r.ok).map((r) => r.serial),
    okCount,
    errCount: results.length - okCount,
  });
  res.json({ results, serials, unreachable: serials.filter((s) => !ready.has(s)) });
});

// Server-Sent Events stream so the UI updates the file list live.
app.get("/api/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.flushHeaders();

  const send = () => {
    res.write(`event: files\ndata: ${JSON.stringify(filesStore.getAll())}\n\n`);
  };
  send();
  const unsubscribe = filesStore.subscribe(send);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// Serve the built React UI in production.
const webDist = path.resolve(process.cwd(), "..", "web", "dist");
app.use(express.static(webDist));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Phonedeck listening on http://0.0.0.0:${config.port}`);
  console.log(`Watching: ${config.watchDir}`);
  console.log(`Phone target: ${config.phoneTargetDir}`);
  console.log(`Monitors detected (${DETECTED_MONITORS.length}):`);
  for (const m of DETECTED_MONITORS) {
    console.log(`  [${m.index}] ${m.name} ${m.width}x${m.height} @ (${m.x},${m.y})${m.primary ? " *primary" : ""}`);
  }
  // Log the LAN IPs so the user knows what URL to visit from Computer 1.
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        console.log(`  LAN: http://${a.address}:${config.port}  (${name})`);
      }
    }
  }
});
