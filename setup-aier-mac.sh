# =============================================================================
# setup-aier-mac.sh — one-paste macOS setup for the LOCAL Aier studio.
#
# FRESH MAC (the /ai-maker "First time?" dropdown shows this on macOS): open
# Terminal, paste this one line, press return —
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/lordacidity/angelstyle2/main/setup-aier-mac.sh)"
#
# (Use `bash -c "$(curl ...)"`, NOT `curl ... | bash` — the former keeps your keyboard
#  connected so Homebrew can ask for your Mac password; the pipe form can't.)
#
# It installs Homebrew + Git + Node + python3 if missing, clones the repo, installs the app
# (backend + client -> the yt-dlp + ffmpeg binaries), registers the aier:// "Launch Aier
# server" button + a double-click "Launch Aier.command", and starts the studio (port 3010).
# Re-runnable any time. After this: press the button on /ai-maker, or double-click the file.
#
# ALREADY HAVE THE REPO:  bash ./setup-aier-mac.sh   (sets up THIS clone)
#
# NOTE: the studio server runs on THIS Mac. An iPhone/iPad can't host it — but it can open the
# /ai-maker page if you point NEXT_PUBLIC_AIER_LOCAL_URL at this Mac's LAN address.
# =============================================================================
set -e

echo ""
echo "=== Aier studio setup (macOS) ==="

REPO_URL="https://github.com/lordacidity/angelstyle2.git"

have() { command -v "$1" >/dev/null 2>&1; }
# Put Homebrew's bin on PATH for THIS session (Apple Silicon: /opt/homebrew, Intel: /usr/local).
add_brew_path() {
  for d in /opt/homebrew/bin /usr/local/bin; do
    if [ -d "$d" ]; then case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac; fi
  done
  export PATH
}
add_brew_path

# ── Homebrew (the macOS package manager) ──────────────────────────────────────
# Run the official installer INTERACTIVELY (no NONINTERACTIVE) so it can prompt for the Mac
# password — it needs sudo once to create its prefix. This is why the one-paste uses
# `bash -c "$(curl ...)"` instead of `curl | bash`: stdin stays the keyboard.
if ! have brew; then
  echo "Installing Homebrew — it will ask for your Mac login password (type it; it stays hidden) ..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  add_brew_path
fi
if ! have brew; then
  echo "Homebrew isn't on PATH yet. Quit Terminal, open a new window, and paste the line again." >&2
  exit 1
fi

# ── Git + Node + python3 ──────────────────────────────────────────────────────
# python3: youtube-dl-exec ships yt-dlp as a Python zipapp on macOS, so it needs python3
# (recent macOS doesn't bundle it). ffmpeg comes from the ffmpeg-static npm package — no brew.
have git     || { echo "Installing Git ...";     brew install git; }
have node    || { echo "Installing Node ...";    brew install node; }
have python3 || { echo "Installing python3 ..."; brew install python; }
add_brew_path

# ── Repo: use this clone if run from inside it, else clone to ~/Desktop/angelstyle ──
SRC="${BASH_SOURCE[0]:-}"
if [ -n "$SRC" ] && [ -f "$(dirname "$SRC")/launch-aier.command" ]; then
  REPO="$(cd "$(dirname "$SRC")" && pwd)"
  echo "Using existing repo at $REPO"
else
  REPO="$HOME/Desktop/angelstyle"
  if [ -d "$REPO/.git" ]; then
    echo "Updating existing copy at $REPO ..."
    git -C "$REPO" pull --ff-only || true
  else
    echo "Cloning to $REPO ..."
    git clone "$REPO_URL" "$REPO"
  fi
fi

# ── Install app deps (backend + client; pulls yt-dlp + ffmpeg binaries) ───────
echo "Installing Aier app dependencies (this can take a minute) ..."
export YOUTUBE_DL_SKIP_PYTHON_CHECK=1
( cd "$REPO/aier" && npm run setup )

# ── Register the aier:// launcher + the double-click launcher ─────────────────
bash "$REPO/register-aier-mac.sh" "$REPO"

# ── Start it now (a Terminal window with the server logs) ─────────────────────
echo "Starting the Aier studio (port 3010) ..."
open "$REPO/launch-aier.command" 2>/dev/null || ( cd "$REPO/aier" && AIER_UNGATED=1 npm run dev )

echo ""
echo "======================================================================"
echo " All set! A Terminal window is starting the local Aier studio (3010)."
echo " From now on: press 'Launch Aier server' on /ai-maker, or double-click"
echo " 'Launch Aier.command' on your Desktop."
echo " Your first download may prompt to allow a local-network connection — click Allow."
echo "======================================================================"
