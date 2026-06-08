# Registers the aier:// URL protocol for the CURRENT USER (no admin needed), so the
# Vercel-hosted /ai-maker "Launch Aier server" button can start the local download server.
# The browser/Vercel page can't spawn a process itself — this protocol handler is the bridge,
# exactly like the sibling phonedeck:// registration (register-phonedeck-protocol.ps1) and
# "Open in Zoom" / vscode:// deep links.
#
# Run ONCE per PC, from the repo root (setup-aier.ps1 calls this for you):
#   powershell -ExecutionPolicy Bypass -File .\register-aier-protocol.ps1
#
# Afterwards, clicking "Launch Aier server" (or visiting aier://launch in the address bar)
# runs launch-aier.bat, which opens a terminal and starts the full Aier studio on port 3010.
# To undo:  Remove-Item HKCU:\Software\Classes\aier -Recurse

$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
$bat = Join-Path $repoRoot 'launch-aier.bat'
if (-not (Test-Path $bat)) {
  throw "launch-aier.bat not found next to this script (looked for: $bat)"
}

$base = 'HKCU:\Software\Classes\aier'

# Root key: the (empty) 'URL Protocol' value is what marks this as a launchable URL scheme.
New-Item -Path $base -Force | Out-Null
New-ItemProperty -Path $base -Name '(default)'    -Value 'URL:Aier Protocol' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $base -Name 'URL Protocol' -Value ''                  -PropertyType String -Force | Out-Null

# shell\open\command: what Windows runs when aier://... is opened. %1 is the full URL handed
# over by Windows; launch-aier.bat ignores it.
$cmdKey = Join-Path $base 'shell\open\command'
New-Item -Path $cmdKey -Force | Out-Null
$command = '"{0}" "%1"' -f $bat
New-ItemProperty -Path $cmdKey -Name '(default)' -Value $command -PropertyType String -Force | Out-Null

Write-Host ''
Write-Host "Registered aier://  ->  $bat" -ForegroundColor Green
Write-Host 'Test it now: paste  aier://launch  into your browser address bar.'
Write-Host ''
