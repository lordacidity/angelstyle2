# AI-maker — Claude context

Localhost tool to insert the user (Aiden) into YouTube videos: trim a clip → pick a freeze
frame → Kling v3 (fal.ai) continues it with Aiden via the `elements` / `@Element1` mechanism →
stitch real + AI into one 1080p MP4. Gemini 2.5 Flash drafts the Kling prompt from the frame
+ reference images.

## ⛔ Rules for Claude (IMPORTANT)
- **NEVER run `npm run dev`, `npm start`, or `node server/index.js`, or otherwise start the
  app / server.** The user (Aiden) ALWAYS starts it himself. Claude starting servers has
  repeatedly orphaned node processes that squat on the port, causing the user's own launches
  to fail. To verify backend behavior, use a one-off Node script that imports the libs directly
  (does NOT bind the app port), or ask the user to run it and report back.
- **Don't touch the user's other apps.** Ports **3000/3001** belong to a separate Next.js
  project of theirs — leave them alone. This app uses **port 3010**; the standalone local
  YouTube downloader (`downloader.js`, launched by the user via the `/ai-maker` "Launch Aier
  server" button → `aier://` → `launch-aier.bat`) uses **port 3011**. Same rule: the USER
  starts it, never Claude.

## Architecture
- **Single Express process** serves BOTH the UI and the API on **http://localhost:3010**
  (Vite middleware mode for HMR). Entry: `server/index.js`. No separate frontend server,
  no proxy, no port 8787.
- Backend: `server/lib` (paths, exec = ffmpeg/ffprobe/yt-dlp, store = settings/projects/jobs,
  gemini, fal, video = shared ffmpeg normalization, edl = timeline schema/normalizer,
  render = two-rail EDL renderer) and `server/routes` (youtube, frame, prompt, generate,
  export = legacy 2-part stitch, render = full timeline EDL, admin).
- Frontend: `client/src` (pages/Wizard.jsx = 5-step studio, pages/Admin.jsx,
  components/TimelineEditor.jsx = the multi-track editor on the final step).
- Settings + reference images + the admin audio library persist as files in `storage/`
  (settings.json + refs/ + audio/), never localStorage.

## Pipeline (5 steps)
Trim → freeze frame (captured from the browser `<video>` via canvas = pixel-exact, no
ffmpeg re-decode/color shift) → Gemini prompt + Kling clip (Kling natively voices Aiden) →
**Combine** (set the takeover frame + where to stop the AI clip) → **Edit & download**.
The final step is a real multi-track editor (`TimelineEditor.jsx`), seeded with the
real + AI clips, where you trim/split/speed/reorder, add clips or admin audio, detach &
move audio, and set levels — then Render.

## Timeline editor + EDL render (the final step)
- The editor edits client-side state and emits an **EDL** (edit decision list) JSON;
  `POST /api/render { projectId, edl }` renders it to `storage/projects/<id>/final.mp4`
  via the job system. The browser preview is approximate; the ffmpeg render is authoritative.
- EDL shape (see `server/lib/edl.js`): `videoTrack` = ordered, **gapless** concat of
  `{ src, in, out, speed, crop }`; `audioTrack s` = absolutely-positioned `{ src, in, out,
  speed, start, gain }`. The video track carries **no** audio — ALL sound is audio items
  (a clip's own audio is a "linked" item the editor adds automatically; "detach" turns it
  into a free item). `src` is a `/media/...` URL or storage-relative path.
- Renderer (`server/lib/render.js`) is two rails: video clips → normalized silent segments
  (same encode params as `video.js`) → concat-copy; audio items → trim/atempo/volume/adelay
  → `amix` → one stereo track; then mux. Every time is snapped to 30fps first. Reuses the
  same `vfFor`/`ENC`/`cropFilter` as the legacy export, so seams stay frame-exact.
- `/api/render/assets/:projectId` tells the editor what it can drop on the timeline
  (project clips + the global admin audio library).

## Run (the USER does this, not Claude)
```
npm run dev      # → http://localhost:3010   (admin at /admin)
```

## Scope
Claude owns the **full stack** here (backend + `client/src/**`). The earlier "frontend lives
in a separate chat" lane split is dissolved.
