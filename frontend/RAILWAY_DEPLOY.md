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
- **Vercel can stay** for the rest of the site. If you want the AI-maker reachable under your
  Vercel domain, add Vercel rewrites for `/ai-maker` and `/api/aier/:path*` pointing at the
  Railway service URL. Otherwise just use the Railway URL for the studio.
- **python3** is only needed because `youtube-dl-exec` ships the Python build of yt-dlp; ffmpeg
  is the bundled `ffmpeg-static` binary, no apt package required.
