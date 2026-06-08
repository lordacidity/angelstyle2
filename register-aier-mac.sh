#!/bin/bash
# Registers the aier:// URL scheme on macOS (so the /ai-maker "Launch Aier server" button
# works) and drops a double-click "Launch Aier.command" on the Desktop. The mac sibling of
# register-aier-protocol.ps1. Called by setup-aier-mac.sh; safe to re-run.
#
# macOS has no registry — a custom URL scheme needs an .app bundle that declares it, so we
# generate a tiny launcher app whose only job is to `open` launch-aier.command.
#
# Arg 1 = repo root (defaults to this script's own folder).
set -e

REPO="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
CMD="$REPO/launch-aier.command"
chmod +x "$CMD" 2>/dev/null || true

# ── 1) aier:// handler app in ~/Applications ──────────────────────────────────
APP="$HOME/Applications/Aier Launcher.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

# Info.plist declares the aier:// scheme. LSUIElement hides it from the Dock/switcher.
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Aier Launcher</string>
  <key>CFBundleIdentifier</key><string>com.pauv.aier.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>Aier</string>
      <key>CFBundleURLSchemes</key><array><string>aier</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

# The app's executable: when aier://launch is opened, just open the launcher command (which
# starts the server in a Terminal window). The full URL is ignored, like launch-aier.bat's %1.
cat > "$APP/Contents/MacOS/launch" <<LAUNCH
#!/bin/bash
open "$CMD"
LAUNCH
chmod +x "$APP/Contents/MacOS/launch"

# Tell Launch Services about the new handler so aier:// resolves without a logout.
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREG" ]; then "$LSREG" -f "$APP" || true; fi

# ── 2) Desktop double-click launcher (absolute path baked in — works from anywhere) ──
DESK="$HOME/Desktop/Launch Aier.command"
cat > "$DESK" <<DESKCMD
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
export AIER_UNGATED=1
export YOUTUBE_DL_SKIP_PYTHON_CHECK=1
cd "$REPO/aier" || { echo "Can't find the aier/ folder."; exit 1; }
echo "Starting Aier studio -> http://localhost:3010   (leave this window open; Ctrl-C to stop)"
exec npm run dev
DESKCMD
chmod +x "$DESK"

echo ""
echo "Registered aier:// -> $APP"
echo "Either press 'Launch Aier server' on /ai-maker, or double-click 'Launch Aier.command' on your Desktop."
