@echo off
REM Phonedeck server launcher — invoked by the phonedeck:// URL protocol that the
REM Vercel-hosted Studio "Launch server" button opens. Starts ONLY the local
REM Express backend (ADB/scrcpy device control + incoming-file watcher) in a
REM visible terminal; the Studio frontend itself is served from Vercel, so we do
REM not start Next here. Windows hands the full phonedeck://... URL to this script
REM as %1 — it is unused; we just need to fire up the server.
REM
REM To launch BOTH the server and a local frontend instead, point the protocol at
REM start-dev.bat rather than this file.
start "phonedeck-server" cmd /k "cd /d %~dp0server && npm run dev"
