@echo off
REM Aier downloader launcher — invoked by the aier:// URL protocol that the Vercel-hosted
REM /ai-maker "Launch Aier server" button opens. Starts ONLY the small local YouTube→MP4
REM download server (aier\downloader.js, port 3011) in a visible terminal, so downloads run
REM from this PC's residential IP at up to 1080p. It is NOT the studio app (port 3010) and
REM does NOT touch it — the AI pipeline still runs on Railway.
REM
REM Windows hands the full aier://... URL to this script as %1; it is unused — we just fire
REM up the server. Registered once by register-aier-protocol.ps1 (run setup-aier.ps1 first).
start "aier-downloader" cmd /k "cd /d %~dp0aier && node downloader.js"
