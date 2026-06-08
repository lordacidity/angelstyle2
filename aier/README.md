# AI-maker

Localhost tool to drop **you (Aiden)** into a YouTube clip. Trim a video → pick the exact
hand-off frame → Kling continues the scene with you in it → stitch real + AI into one 1080p video.

- **App:** one Express process serves the React (Vite) UI **and** the API on `http://localhost:3010` (+ `/admin`)

> Single port **3010** (ports 3000/3001 belong to another app on this machine). Change it with `PORT` in `.env`.
- **AI:** Gemini 2.5 Flash drafts the prompt (sees your freeze frame + reference photos) · fal.ai **Kling v3** image-to-video inserts you via `@Element1`
- **Media:** `yt-dlp` + `ffmpeg` are bundled as npm packages — nothing to install by hand.

## Setup

```powershell
# yt-dlp's installer has an overzealous Python check; the binary it downloads bundles Python,
# so we skip the check. Only needed for this first install.
$env:YOUTUBE_DL_SKIP_PYTHON_CHECK=1
npm run setup      # installs backend + frontend deps (downloads ffmpeg & yt-dlp binaries)
```

Your keys live in `.env` (already created, gitignored):

```
FAL_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
KLING_MODEL=fal-ai/kling-video/v3/standard/image-to-video   # default; switch to pro in /admin
PORT=3010
```

## Run

```powershell
npm run dev        # one process: UI + API on http://localhost:3010
```

Open **http://localhost:3010**. First stop: **/admin** → upload your face (first = `@Element1` frontal)
and full-body reference, pick Testing/Production model.

## Run /ai-maker against THIS local server (Launch Aier server button)

The Vercel-hosted `/ai-maker` page is just static client JS — its whole studio backend (YouTube
download, freeze frame, Kling, render/export, Video downloader tab) runs on **this local app on
port 3010**, launched on demand. That's why download works at all: YouTube bot-blocks datacenter
IPs (Vercel/Railway → "Sign in to confirm you're not a bot" / `yt-dlp exited 127: python3 not
found`), whereas locally it uses your residential IP and the bundled `yt-dlp.exe` (no python3) for
true 1080p. The browser talks to `http://localhost:3010` cross-origin (CORS + Private-Network
headers in `server/index.js`); the server accepts the SPA's `/api/aier/*` paths as a drop-in.

**First time on a PC** — paste one line into Windows PowerShell (this is what the floating button's
"First time?" dropdown shows). It installs Git + Node if missing, clones the repo, installs the app
(backend + client → pulls yt-dlp + ffmpeg), registers the `aier://` launch button, and starts it:

```powershell
irm https://raw.githubusercontent.com/lordacidity/angelstyle2/main/setup-aier.ps1 | iex
```

(Already have the repo cloned? Run it as a file instead and it sets up THIS clone:
`powershell -ExecutionPolicy Bypass -File .\setup-aier.ps1`.)

**Every time after** — press the floating **"Launch Aier server"** button (bottom-right on
`/ai-maker`), an `aier://launch` deep-link → `launch-aier.bat` → `npm run dev` (with
`AIER_UNGATED=1`). Exactly like Phonedeck's "Launch server". The first connection may prompt to
allow a local-network connection; click Allow. (Don't also run `npm run dev` by hand — one
instance owns port 3010.) Set `NEXT_PUBLIC_AIER_LOCAL_URL` to point the page at a different
host/port; it defaults to `http://localhost:3010`.

## The 5 steps (Studio)

1. **Paste & Trim** — paste a YouTube URL; it downloads locally, then trim start/end.
2. **Freeze Frame** — scrub to the millisecond and capture the exact hand-off frame.
3. **Prompt & Generate** — Gemini drafts a Kling prompt from that frame + your refs (editable); Kling generates the clip.
4. **Hand-off** — the real clip plays up to your freeze frame, then the AI clip takes over; choose where it stops.
5. **Review & Download** — preview and download the stitched 1080p MP4.

## Models

| Mode | Model | Use |
|------|-------|-----|
| Testing | `fal-ai/kling-video/v3/standard/image-to-video` | cheaper, default |
| Production | `fal-ai/kling-video/v3/pro/image-to-video` | best quality |

Toggle live in **/admin**. Both support `elements` (your reference images as `@Element1`) and native audio.

## Notes / roadmap

- Output aspect ratio follows your source video (Kling v3 i2v derives it from the start frame).
- Audio: `generate_audio` toggle is in /admin (off by default) — for the upcoming "me talking" feature.
- Everything you create lands in `storage/projects/<id>/` (`source.mp4`, `frame.png`, `kling.mp4`, `final.mp4`).
- This downloads YouTube videos — use only content you have the rights to.

## Structure

```
server/                Express API
  index.js             app + static /media + job poller
  lib/                 paths, exec (ffmpeg/ffprobe), store (settings/projects/jobs), gemini, fal
  routes/              youtube, frame, prompt, generate, export, admin
client/                Vite + React
  src/pages/           Wizard.jsx (5-step studio), Admin.jsx
  src/components/ui.jsx, src/api.js, src/styles.css
storage/               runtime data (gitignored)
```
