import './env.js'; // MUST be first: loads the shared repo-root .env before anything reads process.env
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORAGE, PROJECTS_DIR, ensureDirs } from './lib/paths.js';
import { getJob } from './lib/store.js';
import { gate } from './middleware/gate.js';

import youtubeRouter from './routes/youtube.js';
import frameRouter from './routes/frame.js';
import promptRouter from './routes/prompt.js';
import generateRouter from './routes/generate.js';
import exportRouter from './routes/export.js';
import renderRouter from './routes/render.js';
import devRouter from './routes/dev.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '..', 'client');

ensureDirs();

const app = express();

// Chrome's Private Network Access: when launched locally and driven by the Vercel-hosted
// /ai-maker page, requests go from a PUBLIC origin (https://…vercel.app) to this PRIVATE
// localhost server. Chrome blocks that unless the preflight gets this header. Set it first
// for every request (incl. /media subresources like <video>).
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

// CORS: Aier serves its own client same-origin in standalone use, but the Vercel SPA reaches
// it cross-origin — reflect the origin (allowlist via ALLOWED_ORIGINS if set, permissive
// otherwise) and expose range headers so a cross-origin <video> can canvas-capture frames.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || !ALLOWED.length) return cb(null, true);
    return cb(null, ALLOWED.includes(origin));
  },
  credentials: true,
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
}));
app.use(express.json({ limit: '4mb' }));

// The Vercel /ai-maker SPA calls this server with the SAME /api/aier/* paths it used against
// the cloud backend (so it's a drop-in for Railway). Strip the extra "aier" segment back to
// this server's own /api/* (and /media) routes before anything else looks at the path.
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/aier/media/')) req.url = '/media/' + req.url.slice('/api/aier/media/'.length);
  else if (req.url.startsWith('/api/aier/')) req.url = '/api/' + req.url.slice('/api/aier/'.length);
  else if (req.url === '/api/aier') req.url = '/api';
  next();
});

// Site password gate — must run before media + routes so a locked visitor (or a bot hitting
// the API directly) can't reach anything that spends money. See middleware/gate.js.
app.use(gate());

// Runtime media (source videos, frames, kling clips, exports, refs). Supports range requests.
app.use('/media', express.static(STORAGE));

// ---------------- API ----------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, fal: !!process.env.FAL_KEY, gemini: !!process.env.GEMINI_API_KEY });
});
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});
app.use('/api/youtube', youtubeRouter);
app.use('/api/frame', frameRouter);
app.use('/api/prompt', promptRouter);
app.use('/api/generate', generateRouter);
app.use('/api/export', exportRouter);
app.use('/api/render', renderRouter);
app.use('/api/dev', devRouter);
app.use('/api/admin', adminRouter);

// Unknown /api path → JSON 404 (never fall through to the HTML handler).
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));

const PORT = process.env.PORT || 3010;
const isProd = process.env.NODE_ENV === 'production';

// Public deploys accumulate anonymous projects forever; sweep stale ones so the volume
// doesn't fill. Disabled by default (0) so local/dev data is never deleted — set
// PROJECT_TTL_HOURS (e.g. 24) only in production.
const PROJECT_TTL_HOURS = Number(process.env.PROJECT_TTL_HOURS ?? 0);
function sweepOldProjects() {
  if (!PROJECT_TTL_HOURS) return;
  const cutoff = Date.now() - PROJECT_TTL_HOURS * 3600_000;
  let removed = 0;
  try {
    for (const id of fs.readdirSync(PROJECTS_DIR)) {
      const dir = path.join(PROJECTS_DIR, id);
      try {
        const st = fs.statSync(dir);
        if (st.isDirectory() && st.mtimeMs < cutoff) {
          fs.rmSync(dir, { recursive: true, force: true });
          removed++;
        }
      } catch { /* skip this one */ }
    }
  } catch { /* projects dir not created yet */ }
  if (removed) console.log(`[cleanup] removed ${removed} project(s) older than ${PROJECT_TTL_HOURS}h`);
}

async function start() {
  if (isProd) {
    // Serve the built client (run `npm run build:client` first).
    const dist = path.join(CLIENT_DIR, 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    // DEV: run Vite in middleware mode so the UI + API share ONE process/port (with HMR).
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: CLIENT_DIR,
      cacheDir: path.join(CLIENT_DIR, 'node_modules', `.vite-${PORT}`),
      server: {
        middlewareMode: true,
        hmr: { port: 24678 },
      },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      try {
        const html = await vite.transformIndexHtml(
          req.originalUrl,
          fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8'),
        );
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace?.(e);
        next(e);
      }
    });
  }

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  });

  // Stale-project cleanup (prod only, via PROJECT_TTL_HOURS).
  sweepOldProjects();
  setInterval(sweepOldProjects, 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`\n  AI-maker  ->  http://localhost:${PORT}   (admin: /admin)`);
    console.log(`  mode: ${isProd ? 'production (built)' : 'dev (vite + hmr)'}  ·  single process (UI + API together)`);
    console.log(`  fal.ai key: ${process.env.FAL_KEY ? 'loaded' : 'MISSING'}   Gemini key: ${process.env.GEMINI_API_KEY ? 'loaded' : 'MISSING'}\n`);
  });
}

start();
