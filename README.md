# Phonedeck

Watches a folder for incoming videos and lets you push them over USB to
any subset of connected Android phones from a browser UI. Also launches
scrcpy on demand for remote control.

## Components

- **server/** — Node.js + Express + TypeScript. Watches `C:\fileshare\incoming`
  with chokidar, exposes a REST + SSE API, shells out to `adb` and `scrcpy`.
- **web/** — React + Vite + TypeScript. Single-page UI: live file list,
  per-file phone picker, scrcpy launch buttons.

## Dev

```
.\start-dev.bat
```

Opens two terminals. Browse to <http://localhost:5173>.

Or run them by hand:

```
cd server && npm run dev    # Express on :8080
cd web    && npm run dev    # Vite   on :5173
```

## Flow

1. LocalSend on Computer 2 saves a video into `C:\fileshare\incoming\`.
2. The Express watcher emits an SSE event; the UI shows the new file instantly.
3. Tick the phones you want, click **Push**.
4. Server runs `adb -s <serial> push <file> /sdcard/DCIM/Camera/` in parallel
   and then triggers a media scan so the Camera roll picks it up.
5. For remote control, click **scrcpy** next to a phone. A scrcpy window
   appears on this desktop.

## Config

Env vars on the server process:

| Var                       | Default                  |
|---------------------------|--------------------------|
| `PHONEDECK_WATCH_DIR`     | `C:\fileshare\incoming`  |
| `PHONEDECK_PORT`          | `8080`                   |
| `PHONEDECK_PHONE_TARGET`  | `/sdcard/DCIM/Camera/`   |
| `PHONEDECK_ADB`           | `adb` (PATH)             |
| `PHONEDECK_SCRCPY`        | `scrcpy` (PATH)          |

## Phone setup (one-time per Pixel)

1. Enable Developer options (tap Build number 7×).
2. Enable USB debugging.
3. Plug in via USB, accept the "Allow USB debugging" RSA prompt.
4. `adb devices` should list the phone as `device` (not `unauthorized`).
