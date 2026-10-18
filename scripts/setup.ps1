# One-shot setup for Windows.
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# Installs missing tools with winget, installs Node and Python packages, creates .env, then runs the doctor.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Need($cmd, $wingetId) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { Write-Host "  ok    $cmd"; return }
  Write-Host "  get   $cmd ($wingetId)"
  winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Host "`nTools"
Need node    "OpenJS.NodeJS.LTS"
Need ffmpeg  "Gyan.FFmpeg"
Need python  "Python.Python.3.12"

Write-Host "`nPackages"
npm ci
python -m pip install -r requirements.txt

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "`nCreated .env. Open it and paste your KIE_API_TOKEN and ELEVENLABS_API_KEY."
}

node scripts/doctor.mjs
