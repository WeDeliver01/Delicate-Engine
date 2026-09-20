# Repairs Docker Desktop on Windows when it dies at startup with
#   "rename ...\sailor-ingest.sock ... The file cannot be accessed by the system."
# The stale Unix-socket reparse points cannot be deleted, but the folders can be renamed
# out of the way; Docker recreates them. Usage (from any PowerShell):
#   powershell -ExecutionPolicy Bypass -File infra\scripts\fix-docker-desktop.ps1
$ErrorActionPreference = "SilentlyContinue"
Get-Process | Where-Object { $_.ProcessName -like "*docker*" } | Stop-Process -Force
Start-Sleep -Seconds 3
$stamp = Get-Date -Format yyyyMMddHHmmss
$targets = @("$env:LOCALAPPDATA\Docker\run", "$env:LOCALAPPDATA\docker-secrets-engine")
foreach ($d in $targets) {
  if (Test-Path $d) {
    Rename-Item $d "$d.stale-$stamp"
    if (Test-Path $d) { Write-Host "could not move $d" } else { Write-Host "moved $d aside" }
  }
}
# Old stale folders pile up; they are empty shells, remove the ones that will let go.
Get-ChildItem "$env:LOCALAPPDATA\Docker" -Directory -Filter "run.stale-*" | ForEach-Object { cmd /c "rmdir /s /q `"$($_.FullName)`"" 2>$null }
Get-ChildItem "$env:LOCALAPPDATA" -Directory -Filter "docker-secrets-engine.stale-*" | ForEach-Object { cmd /c "rmdir /s /q `"$($_.FullName)`"" 2>$null }
Start-Process "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
Write-Host "Docker Desktop restarting; give it ~30s, then: docker compose up -d postgres"
