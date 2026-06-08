#!/bin/bash
# Double-click to start the local Aier studio on macOS (the mac sibling of launch-aier.bat).
# The aier:// launcher app made by register-aier-mac.sh also opens this when the /ai-maker
# "Launch Aier server" button is pressed. Starts the FULL studio on port 3010 so the whole
# flow (download, freeze, Kling, render, Video downloader) runs on THIS Mac instead of Railway.
#
# AIER_UNGATED=1: the server is localhost-only and the browser can't send its SameSite=Lax
# auth cookie cross-origin, so we run it open (no password gate). The PATH line puts Homebrew's
# node/python on PATH (Finder/LaunchServices don't inherit your shell PATH).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export AIER_UNGATED=1
export YOUTUBE_DL_SKIP_PYTHON_CHECK=1
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/aier" || { echo "Can't find the aier/ folder next to this file."; exit 1; }
echo "Starting Aier studio -> http://localhost:3010   (leave this window open; Ctrl-C to stop)"
exec npm run dev
