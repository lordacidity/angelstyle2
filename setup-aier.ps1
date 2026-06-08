# =============================================================================
# setup-aier.ps1 — one-paste setup for the LOCAL Aier video downloader.
#
# FRESH MACHINE (the "First time?" button on /ai-maker shows this): paste ONE line
# into Windows PowerShell —
#
#   irm https://raw.githubusercontent.com/lordacidity/angelstyle2/main/setup-aier.ps1 | iex
#
# It then, with no further input: installs Git + Node.js if missing, clones the repo,
# installs the downloader's deps (the yt-dlp + ffmpeg binaries), registers the aier://
# "Launch Aier server" button, and starts the downloader in its own terminal.
#
# ALREADY HAVE THE REPO: run it as a file from the repo root and it sets up THIS clone:
#   powershell -ExecutionPolicy Bypass -File .\setup-aier.ps1
#
# Re-running later is safe (updates + re-registers). After this, you never run it again —
# just press "Launch Aier server" (bottom-right on /ai-maker) each time. UAC / "Allow this
# app to make changes" prompts during the installs are expected; click Yes.
# =============================================================================

$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/lordacidity/angelstyle2.git'

Write-Host ''
Write-Host '=== Aier downloader setup ===' -ForegroundColor Cyan

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# Pull the freshly-updated PATH into THIS session so a tool we just installed is usable
# without opening a new window.
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

# ── Decide the repo root ───────────────────────────────────────────────────────
# Run as a file from inside the repo (launch-aier.bat sits next to this script) → set up
# THAT clone, no git needed. Piped via `irm | iex` (no $PSScriptRoot) → bootstrap a fresh
# clone on the Desktop, installing Git + Node first.
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'launch-aier.bat'))) {
  $repoRoot = $PSScriptRoot
  Write-Host "Using existing repo at $repoRoot" -ForegroundColor Cyan
} else {
  if (-not (Have winget)) {
    Write-Host 'winget is unavailable. Install "App Installer" from the Microsoft Store, then re-run this.' -ForegroundColor Red
    return
  }
  if (-not (Have git))  { Winget-Install 'Git.Git'           'Git' }
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
  $repoRoot = Join-Path ([Environment]::GetFolderPath('Desktop')) 'angelstyle'
  if (Test-Path (Join-Path $repoRoot '.git')) {
    Write-Host "Updating existing copy at $repoRoot ..." -ForegroundColor Cyan
    git -C $repoRoot pull --ff-only
  } else {
    Write-Host "Cloning to $repoRoot ..." -ForegroundColor Cyan
    git clone $repoUrl $repoRoot
  }
}

# ── Node is required for `npm install` (local-mode may have skipped the install above) ──
if (-not (Have node)) {
  if (Have winget) { Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
  if (-not (Have node)) {
    Write-Host 'Node.js is required but not on PATH. Install Node LTS, then re-run this.' -ForegroundColor Red
    return
  }
}

# ── Install the downloader's deps (downloads the yt-dlp + ffmpeg binaries) ──────
# youtube-dl-exec's installer has an overzealous Python check; the binary it pulls bundles
# Python, so we skip the check (mirrors aier/README.md).
Write-Host 'Installing the downloader dependencies (yt-dlp + ffmpeg) ...' -ForegroundColor Cyan
$env:YOUTUBE_DL_SKIP_PYTHON_CHECK = '1'
Push-Location (Join-Path $repoRoot 'aier')
npm install
Pop-Location

# ── Register the aier:// launch protocol ───────────────────────────────────────
& (Join-Path $repoRoot 'register-aier-protocol.ps1')

# ── Start the downloader now, so the first time works without a second click ────
$aierDir = Join-Path $repoRoot 'aier'
Write-Host 'Starting the Aier downloader ...' -ForegroundColor Green
Start-Process cmd -ArgumentList '/k', "cd /d `"$aierDir`" && node downloader.js"

Write-Host ''
Write-Host '======================================================================' -ForegroundColor Green
Write-Host ' All set! A terminal is starting the local downloader (port 3011).' -ForegroundColor Green
Write-Host ' From now on just press "Launch Aier server" (bottom-right on /ai-maker).'
Write-Host ' Your first download may prompt to allow a local-network connection — click Allow.'
Write-Host '======================================================================' -ForegroundColor Green
