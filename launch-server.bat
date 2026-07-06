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
REM
REM Point the server at the bundled adb/scrcpy explicitly. The browser that opens
REM phonedeck:// may have a stale environment (started before setup set the User
REM PHONEDECK_ADB/PHONEDECK_SCRCPY vars or updated PATH), so relying on those
REM inherited vars gives "spawn adb ENOENT". Resolving them here from tools\,
REM relative to this script, makes launch self-sufficient regardless of caller.
for /d %%D in ("%~dp0tools\scrcpy-win64-*") do set "PHONEDECK_TOOLS=%%~fD"
if defined PHONEDECK_TOOLS set "PHONEDECK_ADB=%PHONEDECK_TOOLS%\adb.exe"
if defined PHONEDECK_TOOLS set "PHONEDECK_SCRCPY=%PHONEDECK_TOOLS%\scrcpy.exe"
start "phonedeck-server" cmd /k "cd /d %~dp0server && npm run dev"
