@echo off
REM Phonedeck dev launcher: opens two terminals — backend (Express on :8080) +
REM Studio Next.js (frontend on :3000). The Phonedeck UI is now served from
REM Studio at /deck, /trending, /images — no separate Vite server.

start "phonedeck-server"   cmd /k "cd /d %~dp0server && npm run dev"
start "phonedeck-frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Phonedeck dev servers starting in two new windows.
echo   API:    http://localhost:8080
echo   Studio: http://localhost:3000
echo.
