import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { IncomingWatcher } from "./watcher.js";
import { listDevices, pushFile, mediaScan, launchScrcpy } from "./adb.js";
import { loadSettings, getSettings, saveSettings } from "./settings.js";
import * as store from "./store.js";
import * as filesStore from "./filesStore.js";
import * as templates from "./templates.js";
import { chat as deepseekChat, parseJson as deepseekParseJson } from "./deepseek.js";

// Single source of truth lives at the repo-root .env (phonedeck/.env). The Next
// app loads it via next.config, and we read the same file here so both runtimes
// share one set of values. HERE resolves relative to this file, not cwd, so
// launching from any directory (npm --prefix, start-dev.bat, etc.) still hits it
// — and works whether running src (tsx) or dist, since both sit one level under
// server/.
const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, "..", "..", ".env") });

// Dynamic import AFTER dotenv runs, so pauvData sees the env vars when it
// constructs its module-level Supabase client.
const { listTalents, searchNews, newsForTalent, listIndustries, lookupNews, lookupPersonNews, latestArticlesByIndustry, extractPerson, chatEdit, getTrendingTalents } =
  await import("./pauvData.js");
const { imageSearch } = await import("./serpapi.js");
const { getHandlesByIndustry, listIndustriesWithCounts } = await import("./newsSources.js");

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

// Private Network Access (Chrome's "Local Network Access"). The Studio is served
// from a public HTTPS origin (e.g. angelstyle.vercel.app) but calls this server
// on http://localhost:8080 — a loopback address. Chrome treats public-site →
// loopback as a private-network request and BLOCKS it ("Permission was denied
// for this request to access the loopback address space") unless the preflight
// response echoes `Access-Control-Allow-Private-Network: true`. The cors()
// middleware doesn't set this header, so add it first, on every request that
// carries the matching preflight request header.
app.use((req, res, next) => {
  if (req.headers["access-control-request-private-network"]) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  next();
});
// Reflect the requesting origin and allow the PNA header on preflights so the
// browser is satisfied for both http and https Studio origins.
app.use(cors({ origin: true }));
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

// Bulk-mark every Incoming file as past. One-tap sweep for when the user has
// already distributed everything by other means and just wants a clean slate.
app.post("/api/files/clear-incoming", (_req, res) => {
  const count = filesStore.markAllNewAsSaved();
  res.json({ ok: true, count });
});

app.post("/api/files/:name/backlog", (req, res) => {
  const rec = filesStore.markBacklog(req.params.name);
  if (!rec) { res.status(404).json({ error: "not found" }); return; }
  res.json(rec);
});

// Tracks whether we've already logged an adb failure so a missing/stopped adb
// doesn't spam the server log on every poll. Reset once a list succeeds again.
let devicesWarned = false;
app.get("/api/devices", async (_req, res) => {
  try {
    const devices = await listDevices();
    devicesWarned = false;
    const enriched = devices.map((d) => ({ ...d, name: store.getPhoneName(d.serial) ?? null }));
    res.json(enriched);
  } catch (err) {
    // adb missing / not running / no devices: reply with an empty list (200)
    // rather than a 500, so the polling clients (mini-panel + deck) don't make
    // the browser log a failed request every few seconds. "No devices" simply
    // reads as "none connected". Logged once until adb recovers.
    if (!devicesWarned) {
      console.warn("[devices] adb unavailable — returning empty device list:", String(err));
      devicesWarned = true;
    }
    res.json([]);
  }
});


// Local "reel catalogue" — every successful push spawns a copy at
// ~/Downloads/reel catalogue/MM-DD-YYYY/<phone-name>/<filename>. This is the
// single archive of what was actually distributed (not just what was exported),
// organised by day and by recipient phone so the user can find any clip by
// "when did I send it and to whom?". Studio video exports, Computer-1 sends,
// uploads, and Backlog pushes all archive through this same path.
const REEL_CATALOGUE_DIR = path.join(os.homedir(), "Downloads", "reel catalogue");

function reelCatalogueDateFolder(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

// Sanitize for use as a directory name on Windows.
function safeDirName(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 60) || "phone";
}

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

  // Archive a copy per successful recipient in the reel catalogue. Failures
  // are logged but don't fail the push — the phones got the file, which is
  // the primary outcome the user cares about.
  const dateDir = path.join(REEL_CATALOGUE_DIR, reelCatalogueDateFolder());
  for (const r of results.filter((x) => x.ok)) {
    try {
      const phoneName = safeDirName(store.getPhoneName(r.serial) ?? r.serial.slice(-4));
      const phoneDir = path.join(dateDir, phoneName);
      fs.mkdirSync(phoneDir, { recursive: true });
      fs.copyFileSync(filePath, path.join(phoneDir, fileName));
    } catch (err) {
      console.warn(`[reel catalogue] failed to archive ${fileName} for ${r.serial}:`, err);
    }
  }

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
        // Multi-phone mode: cap resolution/fps/bitrate so 4× streams don't
        // choke the GPU and USB bus. Single-phone /api/scrcpy keeps native
        // quality. 800px longest edge looks fine in a tiled window and cuts
        // the pixel count roughly in half vs native 1080×2400.
        maxSize: 800,
        maxFps: 30,
        videoBitRate: "4M",
        noAudio: true,
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

// ---- news-cards feature: talents (Pauv Supabase) + news (Newsdata.io) ----
app.get("/api/talents", async (_req, res) => {
  try {
    res.json(await listTalents());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Today's most-mentioned music & film Pauv talents, with their headlines.
// Backs the Trending tab.
app.get("/api/trending/talents", async (req, res) => {
  try {
    // Cap at 500 — the actual cost is the per-talent Google News fan-out,
    // which runs for every eligible talent regardless of limit. Slicing
    // more or fewer at the end is essentially free.
    const limit = req.query.limit ? Math.min(500, Math.max(1, Number(req.query.limit))) : 12;
    res.json(await getTrendingTalents(limit));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const size = req.query.size ? Number(req.query.size) : undefined;
    res.json(await searchNews({ q, size }));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/news/for-talent/:ticker", async (req, res) => {
  try {
    res.json(await newsForTalent(req.params.ticker));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/industries", async (_req, res) => {
  try {
    res.json(await listIndustries());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/news/latest-by-industry", async (req, res) => {
  try {
    const industry = typeof req.query.industry === "string" ? req.query.industry : "";
    if (!industry) { res.status(400).json({ error: "industry query param required" }); return; }
    const size = req.query.size ? Number(req.query.size) : 5;
    res.json(await latestArticlesByIndustry(industry, size));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/news/lookup", async (req, res) => {
  try {
    const { industry, pauvOnly, exclude } = req.body as {
      industry?: string;
      pauvOnly?: boolean;
      exclude?: string[];
    };
    if (!industry) { res.status(400).json({ error: "industry required" }); return; }
    const ex = Array.isArray(exclude) ? exclude.filter((x) => typeof x === "string") : [];
    res.json(await lookupNews(industry, !!pauvOnly, ex));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/news/person-lookup", async (req, res) => {
  try {
    const { ticker, exclude } = (req.body ?? {}) as { ticker?: string; exclude?: string[] };
    if (!ticker) { res.status(400).json({ error: "ticker required" }); return; }
    const ex = Array.isArray(exclude) ? exclude.filter((x) => typeof x === "string") : [];
    res.json(await lookupPersonNews(ticker, ex));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/news/chat-edit", async (req, res) => {
  try {
    const { messages, state } = req.body as {
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
      state?: {
        caption: string;
        mainPerson: string;
        summary: string;
        pauvAngle: string;
        matchedTicker: string | null;
      };
    };
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages[] required (with at least one user message)" });
      return;
    }
    if (!state) {
      res.status(400).json({ error: "state required" });
      return;
    }
    res.json(await chatEdit(messages, state));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// One-time image cache. The live image proxy below works for most sources,
// but some CDNs intermittently fail (bot detection, expired hotlink tokens,
// CDN edge inconsistency). Downloading the bytes to disk once gives us a
// truly same-origin file that is bulletproof for both <img> rendering and
// canvas export (toPng). Used by the news-card flow when transitioning from
// the photo step to the card step.
const PHOTO_CACHE_DIR = path.resolve(process.cwd(), "data", "photo-cache");
fs.mkdirSync(PHOTO_CACHE_DIR, { recursive: true });

function extFromContentType(ct: string | null): string | null {
  if (!ct) return null;
  const t = ct.toLowerCase();
  if (t.includes("jpeg")) return "jpg";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("avif")) return "avif";
  if (t.includes("svg")) return "svg";
  return null;
}

function extFromUrl(url: string): string | null {
  const m = /\.(jpg|jpeg|png|webp|gif|avif|svg)(?:\?|#|$)/i.exec(url);
  return m ? (m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase()) : null;
}

app.post("/api/photos/cache", async (req, res) => {
  const url = typeof req.body?.url === "string" ? req.body.url : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "absolute http(s) url required" });
    return;
  }
  try {
    const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
    // Hit the on-disk cache first — same URL never downloads twice.
    const existing = fs.readdirSync(PHOTO_CACHE_DIR).find((f) => f.startsWith(hash + "."));
    if (existing) {
      res.json({ localUrl: `/cached-photos/${existing}`, cached: true });
      return;
    }
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Referer": new URL(url).origin + "/",
        "Accept": "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
      return;
    }
    const ext = extFromContentType(upstream.headers.get("content-type")) ?? extFromUrl(url) ?? "jpg";
    const filename = `${hash}.${ext}`;
    const buf = Buffer.from(await upstream.arrayBuffer());
    fs.writeFileSync(path.join(PHOTO_CACHE_DIR, filename), buf);
    res.json({ localUrl: `/cached-photos/${filename}`, cached: false, bytes: buf.byteLength });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Static-serve the cache. The CORS header keeps canvas export clean if the
// page ever moves origins (e.g. tunneled), even though same-origin would work
// without it.
app.use("/cached-photos", (_req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=86400");
  next();
}, express.static(PHOTO_CACHE_DIR));

// Image proxy. Many publisher CDNs don't return CORS headers, so when the
// template renderer sets `crossorigin="anonymous"` (needed so the card can be
// exported as PNG without canvas-tainting), the browser refuses to paint the
// image. We route external images through here, set permissive CORS headers
// of our own, and the browser is happy. This also bypasses publisher hotlink
// protection that rejects loads from non-publisher origins.
app.get("/api/img-proxy", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).send("absolute http(s) url required");
    return;
  }
  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        // Some CDNs only serve images when the Referer is from their own
        // origin (hotlink protection). Faking it to the image's own host
        // typically satisfies them without breaking sites that don't care.
        "Referer": new URL(url).origin + "/",
        "Accept": "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!upstream.ok) {
      res.status(upstream.status).send(`upstream ${upstream.status}`);
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=3600");
    res.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(500).send(String(err));
  }
});

// Scrape a news article URL for its featured image + site name. Used by the
// Person News → card flow so the resulting card can use the publisher's own
// hero image (with attribution) instead of a generic photo search result.
app.post("/api/article/scrape-images", async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url required" });
    return;
  }
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      redirect: "follow",
    });
    const html = await r.text();
    const meta = (prop: string): string | null => {
      // Match <meta property="og:image" content="..."> in either order.
      const re1 = new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
        "i",
      );
      const re2 = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
        "i",
      );
      const m = re1.exec(html) ?? re2.exec(html);
      return m ? m[1] : null;
    };
    // Collect candidate images in priority order — og:image then twitter:image.
    const seen = new Set<string>();
    const images: string[] = [];
    for (const p of ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"]) {
      const v = meta(p);
      if (v && !seen.has(v)) {
        seen.add(v);
        images.push(v);
      }
    }
    const siteName = meta("og:site_name");
    const title = meta("og:title");
    const finalUrl = r.url || url;
    res.json({ images, siteName, title, finalUrl });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/news/extract-person", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      title?: string;
      description?: string | null;
      content?: string | null;
      tweetText?: string;
      tweetAuthorName?: string;
      tweetAuthorHandle?: string;
    };
    if (!body.title && !body.tweetText) {
      res.status(400).json({ error: "title or tweetText required" });
      return;
    }
    res.json(await extractPerson(body));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/news-sources", async (_req, res) => {
  try {
    res.json(await listIndustriesWithCounts());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/news-sources/:industry", async (req, res) => {
  try {
    res.json(await getHandlesByIndustry(req.params.industry));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- card templates (Railway Postgres) ----
app.get("/api/templates", async (_req, res) => {
  try { res.json(await templates.listTemplates()); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

app.get("/api/templates/:id", async (req, res) => {
  try {
    const t = await templates.getTemplate(req.params.id);
    if (!t) { res.status(404).json({ error: "not found" }); return; }
    res.json(t);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post("/api/templates", async (req, res) => {
  try {
    const { name, doc } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name required" }); return;
    }
    if (!doc || typeof doc !== "object") {
      res.status(400).json({ error: "doc required" }); return;
    }
    res.json(await templates.createTemplate(name.trim(), doc));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.put("/api/templates/:id", async (req, res) => {
  try {
    const { name, doc } = req.body ?? {};
    const patch: { name?: string; doc?: templates.TemplateDoc } = {};
    if (typeof name === "string" && name.trim()) patch.name = name.trim();
    if (doc && typeof doc === "object") patch.doc = doc;
    const t = await templates.updateTemplate(req.params.id, patch);
    if (!t) { res.status(404).json({ error: "not found" }); return; }
    res.json(t);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.delete("/api/templates/:id", async (req, res) => {
  try {
    const ok = await templates.deleteTemplate(req.params.id);
    if (!ok) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// DeepSeek rewrites copy for the template's text-role slots so it fits the
// template's visual style (character budget, tone) instead of dumping the raw
// headline verbatim. Slots whose role isn't sent here are populated client-
// side from the talent/news data directly.
app.post("/api/templates/populate-copy", async (req, res) => {
  try {
    const { slots, context } = req.body as {
      slots?: Array<{ id: string; role: string; maxChars?: number; hint?: string }>;
      context?: {
        headline?: string;
        source?: string | null;
        pubDate?: string | null;
        pauvAngle?: string;
        person?: { name?: string; summary?: string };
        talent?: {
          name?: string; ticker?: string; industry?: string | null;
          subcategory?: string | null; location?: string | null;
          price?: { usd?: number | null; lifetimeChangePct?: number | null };
        };
      };
    };
    if (!Array.isArray(slots) || slots.length === 0) {
      res.status(400).json({ error: "slots[] required" }); return;
    }
    if (!context) { res.status(400).json({ error: "context required" }); return; }

    const sys =
      "You write copy for a Pauv news card. Given the news context and a list of " +
      "text slots (each with a semantic role and a max-character budget), write " +
      "the copy for each slot. Be punchy, factual, no hashtags, no emoji. " +
      "Return JSON: { results: { [slotId]: string } }. Stay under each maxChars.";
    const user = JSON.stringify({ slots, context });
    const raw = await deepseekChat(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      { json: true, temperature: 0.4 },
    );
    const parsed = deepseekParseJson<{ results?: Record<string, string> }>(raw);
    res.json({ results: parsed.results ?? {} });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/photos/search", async (req, res) => {
  try {
    const { query, count, offset } = req.body as {
      query?: string; count?: number; offset?: number;
    };
    if (!query) { res.status(400).json({ error: "query required" }); return; }
    res.json(await imageSearch(query, count ?? 3, offset ?? 0));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Download a found image straight to the user's Downloads/copyright free images
// folder, bucketed by today's date (MM-DD-YYYY) so the inbox stays organised
// without any manual filing. Used by the standalone Images tab — one click
// saves locally, no browser "save as" dialog.
const COPYRIGHT_FREE_DIR = path.join(os.homedir(), "Downloads", "copyright free images");

// Local-time date stamp (NOT UTC) — "today" should match the user's wall clock.
function todayFolderName(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

app.post("/api/images/download", async (req, res) => {
  const { url, query } = (req.body ?? {}) as { url?: string; query?: string };
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "absolute http(s) url required" });
    return;
  }
  try {
    const targetDir = path.join(COPYRIGHT_FREE_DIR, todayFolderName());
    fs.mkdirSync(targetDir, { recursive: true });
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Referer": new URL(url).origin + "/",
        "Accept": "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
      return;
    }
    const ext = extFromContentType(upstream.headers.get("content-type")) ?? extFromUrl(url) ?? "jpg";
    // Hash so re-downloading the same URL overwrites instead of piling up.
    const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 12);
    const slug = (query ?? "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
    const filename = `${slug}-${hash}.${ext}`;
    const filePath = path.join(targetDir, filename);
    const buf = Buffer.from(await upstream.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    res.json({ ok: true, filename, dir: targetDir, bytes: buf.byteLength });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DeepSeek suggests a different Google Images query so the user can swap
// "Drake" → "Drake rapper Toronto stage 2024" when generic results aren't
// matching. We send the prior tries so it doesn't loop back to the same one.
app.post("/api/photos/rewrite-query", async (req, res) => {
  try {
    const { personName, personSummary, previousQueries, hint } = req.body as {
      personName?: string;
      personSummary?: string;
      previousQueries?: string[];
      hint?: string;
    };
    if (!personName) { res.status(400).json({ error: "personName required" }); return; }
    const sys =
      "You generate Google Images search queries for finding good editorial " +
      "photos of a public figure. Return JSON: { query: string }. The query " +
      "should be specific enough to surface high-quality press photos but not " +
      "so narrow it returns nothing. Avoid the queries listed in `previousQueries` " +
      "— pick a different angle each time (e.g. add a year, a venue, a role, a context).";
    const user = JSON.stringify({ personName, personSummary, previousQueries, hint });
    const raw = await deepseekChat(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      { json: true, temperature: 0.7 },
    );
    const parsed = deepseekParseJson<{ query?: string }>(raw);
    if (!parsed.query) { res.status(500).json({ error: "no query returned" }); return; }
    res.json({ query: parsed.query });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
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
