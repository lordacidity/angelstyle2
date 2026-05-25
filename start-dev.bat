@echo off
REM Phonedeck dev launcher: opens two terminals — backend (Express) + frontend (Vite).
REM Browse to http://localhost:5173 once both are up.

start "phonedeck-server" cmd /k "cd /d %~dp0server && npm run dev"
start "phonedeck-web"    cmd /k "cd /d %~dp0web && npm run dev"

echo.
echo Phonedeck dev servers starting in two new windows.
echo   API:  http://localhost:8080
echo   UI:   http://localhost:5173
echo.
