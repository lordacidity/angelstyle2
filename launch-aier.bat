@echo off
REM Aier server launcher — invoked by the aier:// URL protocol that the Vercel-hosted
REM /ai-maker "Launch Aier server" button opens. Starts the FULL local Aier studio (port 3010)
REM so the whole flow — YouTube download, freeze frame, Kling generate, render/export, and the
REM Video downloader tab — runs on THIS PC (residential IP, bundled yt-dlp.exe + ffmpeg) instead
REM of Railway. The Vercel page is just static client JS that calls this local server.
REM
REM AIER_UNGATED=1: the server is localhost-only, and the browser can't send its SameSite=Lax
REM auth cookie cross-origin, so we run it open (no password gate). Windows hands the full
REM aier://... URL as %1; it is unused. Registered once by register-aier-protocol.ps1.
set AIER_UNGATED=1
start "aier-server" cmd /k "cd /d %~dp0aier && npm run dev"
