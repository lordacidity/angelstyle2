# Registers the phonedeck:// URL protocol for the CURRENT USER (no admin needed),
# so the Vercel-hosted Studio "Launch server" button can start the local Express
# backend. The browser/Vercel page cannot spawn a process itself — this protocol
# handler is the bridge, exactly like "Open in Zoom" / vscode:// deep links.
#
# Run ONCE per team PC, from the repo root:
#   powershell -ExecutionPolicy Bypass -File .\register-phonedeck-protocol.ps1
#
# Afterwards, clicking "Launch server" in Studio (or visiting phonedeck://launch
# in the address bar) runs launch-server.bat, which opens a terminal and starts
# the server. To undo:  Remove-Item HKCU:\Software\Classes\phonedeck -Recurse

$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
$bat = Join-Path $repoRoot 'launch-server.bat'
if (-not (Test-Path $bat)) {
  throw "launch-server.bat not found next to this script (looked for: $bat)"
}

$base = 'HKCU:\Software\Classes\phonedeck'

# Root key: presence of an (empty) 'URL Protocol' value is what marks this as a
# launchable URL scheme to Windows.
New-Item -Path $base -Force | Out-Null
New-ItemProperty -Path $base -Name '(default)'    -Value 'URL:Phonedeck Protocol' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $base -Name 'URL Protocol' -Value ''                       -PropertyType String -Force | Out-Null

# shell\open\command: the command Windows runs when phonedeck://... is opened.
# %1 is the full URL handed over by Windows; launch-server.bat ignores it.
$cmdKey = Join-Path $base 'shell\open\command'
New-Item -Path $cmdKey -Force | Out-Null
$command = '"{0}" "%1"' -f $bat
New-ItemProperty -Path $cmdKey -Name '(default)' -Value $command -PropertyType String -Force | Out-Null

Write-Host ""
Write-Host "Registered phonedeck://  ->  $bat" -ForegroundColor Green
Write-Host "Test it now: paste  phonedeck://launch  into your browser address bar."
Write-Host ""
