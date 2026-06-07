@echo off
REM Phonedeck dev launcher: opens two terminals — backend (Express on :8080) and
REM Studio Next.js (frontend on :3000). The Phonedeck UI and the AI-maker (Aier) are
REM both served from Studio (AI-maker at /ai-maker, API at /api/aier/*) — no separate
REM Vite/Express server for it anymore. The standalone aier/ folder is reference only.

start "phonedeck-server"   cmd /k "cd /d %~dp0server && npm run dev"
start "phonedeck-frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Phonedeck dev servers starting in two new windows.
echo   API:    http://localhost:8080
echo   Studio: http://localhost:3000  (AI-maker at /ai-maker)
echo.
