# =============================================================================
# Phonedeck — one-shot setup + launch for a brand-new machine.
#
# The friend just opens Windows PowerShell and pastes ONE line:
#
#   irm https://raw.githubusercontent.com/lordacidity/angelstyle/main/setup.ps1 | iex
#
# This script then, with no further input:
#   1. Installs Git + Node.js (via winget) if they're missing.
#   2. Installs scrcpy + adb (the Android tools the server shells out to).
#   3. Clones the repo to the Desktop (or updates it if already there).
#   4. Installs the server's npm dependencies.
#   5. Registers the phonedeck:// "Launch server" protocol.
#   6. Starts the local server in its own terminal window.
#
# Re-running it later just updates the repo and restarts the server — safe to
# run again any time. UAC / "Allow this app to make changes" prompts during the
# installs are expected; click Yes.
# =============================================================================

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '=== Phonedeck setup ===' -ForegroundColor Cyan

$repoUrl = 'https://github.com/lordacidity/angelstyle.git'
$dest    = Join-Path ([Environment]::GetFolderPath('Desktop')) 'angelstyle'

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# Pull the freshly-updated PATH into THIS session so a tool we just installed is
# usable without opening a new window.
function Update-SessionPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
}

function Winget-Install($id, $label) {
  Write-Host "Installing $label ..." -ForegroundColor Cyan
  # Tolerate winget's non-zero "already installed / no upgrade" exit codes.
  try {
    winget install --id $id -e --silent `
      --accept-package-agreements --accept-source-agreements --disable-interactivity
  } catch { }
  Update-SessionPath
}

# ── 0. winget must exist (ships with App Installer on Win10/11) ────────────────
if (-not (Have winget)) {
  Write-Host 'winget is not available. Install "App Installer" from the Microsoft Store, then re-run this.' -ForegroundColor Red
  return
}

# ── 1. Git + Node ─────────────────────────────────────────────────────────────
if (-not (Have git))  { Winget-Install 'Git.Git'          'Git' }
if (-not (Have node)) { Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js LTS' }

Update-SessionPath
foreach ($c in 'git','node','npm') {
  if (-not (Have $c)) {
    Write-Host ''
    Write-Host "$c was installed but isn't on PATH in this window yet." -ForegroundColor Yellow
    Write-Host 'Close this window, open a NEW PowerShell, and paste the same line again.' -ForegroundColor Yellow
    return
  }
}

# ── 2. scrcpy + adb (Android device tools) ────────────────────────────────────
# The server calls `adb` and `scrcpy` off the PATH. winget's scrcpy doesn't put
# the bundled adb.exe on PATH, so if either is missing we download the official
# scrcpy-win64 release (which contains BOTH exes) to a known folder and point the
# server at them via PHONEDECK_ADB / PHONEDECK_SCRCPY (set at User scope so the
# Launch-server button picks them up on future runs too).
if (-not (Have adb) -or -not (Have scrcpy)) {
  Write-Host 'Getting scrcpy + adb ...' -ForegroundColor Cyan
  $toolsDir = Join-Path $dest 'tools'
  $scrcpyExe = $null
  try {
    $rel = Invoke-RestMethod 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest' `
            -Headers @{ 'User-Agent' = 'phonedeck-setup' }
    $asset = $rel.assets | Where-Object { $_.name -match 'win64' -and $_.name -match '\.zip$' } | Select-Object -First 1
    if ($asset) {
      New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
      $zip = Join-Path $toolsDir $asset.name
      Invoke-WebRequest $asset.browser_download_url -OutFile $zip
      Expand-Archive -Path $zip -DestinationPath $toolsDir -Force
      Remove-Item $zip -Force
      $scrcpyExe = (Get-ChildItem -Path $toolsDir -Recurse -Filter 'scrcpy.exe' | Select-Object -First 1).FullName
    }
  } catch {
    Write-Host "  Could not auto-download scrcpy: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  if ($scrcpyExe) {
    $adbExe = Join-Path (Split-Path $scrcpyExe) 'adb.exe'
    [Environment]::SetEnvironmentVariable('PHONEDECK_SCRCPY', $scrcpyExe, 'User')
    [Environment]::SetEnvironmentVariable('PHONEDECK_ADB',    $adbExe,    'User')
    $env:PHONEDECK_SCRCPY = $scrcpyExe
    $env:PHONEDECK_ADB    = $adbExe
    Write-Host "  scrcpy + adb ready at $(Split-Path $scrcpyExe)" -ForegroundColor Green
  } else {
    Write-Host '  Skipping — phone mirroring/pushing may not work until adb + scrcpy are installed.' -ForegroundColor Yellow
  }
}

# ── 3. Clone or update the repo ───────────────────────────────────────────────
if (Test-Path (Join-Path $dest '.git')) {
  Write-Host "Updating existing copy at $dest ..." -ForegroundColor Cyan
  git -C $dest pull --ff-only
} else {
  Write-Host "Cloning to $dest ..." -ForegroundColor Cyan
  git clone $repoUrl $dest
}

# ── 4. Install server dependencies ────────────────────────────────────────────
Write-Host 'Installing server dependencies ...' -ForegroundColor Cyan
Push-Location (Join-Path $dest 'server')
npm install
Pop-Location

# ── 5. Register the phonedeck:// launch protocol ──────────────────────────────
& (Join-Path $dest 'register-phonedeck-protocol.ps1')

# ── 6. Start the server in its own window ─────────────────────────────────────
$serverDir = Join-Path $dest 'server'
Write-Host 'Starting the Phonedeck server ...' -ForegroundColor Green
Start-Process cmd -ArgumentList '/k', "cd /d `"$serverDir`" && npm run dev"

Write-Host ''
Write-Host '======================================================================' -ForegroundColor Green
Write-Host ' All set!' -ForegroundColor Green
Write-Host ' 1. A new window is starting the server — wait for:'
Write-Host '       Phonedeck listening on http://0.0.0.0:8080'
Write-Host ' 2. Plug the phone in over USB and tap "Allow USB debugging" on it.'
Write-Host ' 3. Open  https://angelstyle.vercel.app  and click ALLOW on the'
Write-Host '    local-network / private-network prompt.'
Write-Host '======================================================================' -ForegroundColor Green
