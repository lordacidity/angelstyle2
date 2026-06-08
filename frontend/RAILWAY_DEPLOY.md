# Deploying the Aier studio on Railway

The Aier AI-maker (YouTube download → freeze frame → Kling → export) needs a **persistent
disk**, **long-running jobs**, and **system binaries (python3 for yt-dlp, ffmpeg)** — none of
which Vercel's serverless model provides. Railway gives all three. This app is built for it:
`STORAGE_ROOT` redirects every read/write to a mounted volume (see `src/lib/aier/paths.js`).

The repo already contains the build config:
- [`nixpacks.toml`](./nixpacks.toml) — installs `python3` (fixes the `yt-dlp exited 127` error).
- [`railway.json`](./railway.json) — Nixpacks builder, start command, healthcheck.

## One-time setup in the Railway dashboard

1. **New service → Deploy from GitHub repo** → pick `lordacidity/angelstyle2`.
2. **Settings → Root Directory** = `frontend` (this is a monorepo; the Next app lives there).
   Railway then picks up `frontend/nixpacks.toml` + `frontend/railway.json` automatically.
3. **Add a Volume** (Service → Variables/Settings → Volumes): mount path **`/data`**.
4. **Variables** — add everything from the repo-root `.env`, **plus** `STORAGE_ROOT=/data`:

   Runtime + build secrets:
   - `FAL_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `KLING_MODEL`
   - `DATABASE_PUBLIC_URL` (or `DATABASE_URL`) — your Railway Postgres connection string
   - `ACCESS_TOKEN`, `AUTH_SECRET`
   - `DEEPSEEK_API_KEY`, `NEWSDATA_API_KEY`, `SERPAPI_KEY`, `TWITTERAPI_IO_KEY`
   - `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

   **Build-time** (must exist before the build — Next inlines `NEXT_PUBLIC_*` at build):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SUPABASE_DIST_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

   **New:** `STORAGE_ROOT=/data`  ← points all Aier storage at the volume so projects,
   refs, audio, frames, and exports survive redeploys.

5. **Deploy.** First build runs `npm ci && npm run build`; the service starts with `npm start`
   and Railway health-checks `GET /api/aier/health`.

## Notes / gotchas

- **Keep replicas = 1.** Background job state (`createJob`/`pollJob`) lives in-process. A single
  instance is correct for this workload; horizontal scaling would split the job map.
- **Volume is the source of truth.** With `STORAGE_ROOT=/data`, the settings live in Postgres
  (durable) and media lives on the volume (durable). Don't remove the volume.
- **Vercel can stay** for the rest of the site, with `/ai-maker` still reachable under your
  Vercel domain. [`next.config.ts`](./next.config.ts) proxies the studio backend to Railway via
  `rewrites()` when **`AIER_RAILWAY_URL`** is set — so on the **Vercel** project set
  `AIER_RAILWAY_URL=https://<your-service>.up.railway.app` (needed at *build* time → redeploy
  after adding it). The `/ai-maker` page stays on Vercel (static client JS); only `/api/aier/*`
  is proxied. The stateless `/api/aier/youtube/grab` downloader is deliberately *not* proxied —
  it runs on Vercel directly. **Leave `AIER_RAILWAY_URL` UNSET on Railway** (and locally) or the
  backend would proxy to itself.
  - **Gotcha:** the proxy forwards the browser's `site_auth` cookie to Railway, where the same
    middleware re-checks it. So **`AUTH_SECRET` (and `ACCESS_TOKEN`) must be identical on Vercel
    and Railway**, or proxied API calls 401. No CORS setup is needed (the browser only ever talks
    to Vercel; the hop to Railway is server-side).
  - **Caveat:** large uploads (the admin audio library) travel browser → Vercel proxy → Railway
    and can hit Vercel's request-body limit. If that bites, do admin uploads on the Railway URL
    directly. The YouTube-download step (a small JSON POST; media streams back as a *response*)
    is unaffected.
- Prefer not to touch Vercel? Just open `/ai-maker` on the Railway URL — relative API calls then
  hit Railway directly and no rewrite/`AIER_RAILWAY_URL` is needed.
- **python3** is only needed because `youtube-dl-exec` ships the Python build of yt-dlp; ffmpeg
  is the bundled `ffmpeg-static` binary, no apt package required.
