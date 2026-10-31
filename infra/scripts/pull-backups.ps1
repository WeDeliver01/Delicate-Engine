# Pulls new nightly backups (produced by infra/scripts/nightly-backup.sh) from the VPS
# down to this machine, so a lost VPS doesn't take the only copy with it. Only copies
# files not already present locally; never deletes anything on the VPS.
#
# Run manually, or via the "Delicate Engine Backup Pull" Scheduled Task (daily).

$RemoteHost = "root@45.77.227.115"
$RemoteDir  = "/srv/backups"
$LocalDir   = "C:\Users\Ashley\Desktop\Delicate Engine Backups"
$Scp = "C:\Windows\System32\OpenSSH\scp.exe"
$Ssh = "C:\Windows\System32\OpenSSH\ssh.exe"

New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null

$remoteFiles = & $Ssh -o BatchMode=yes $RemoteHost "find $RemoteDir -maxdepth 1 -type f \( -name '*.dump' -o -name '*.tar.gz.gpg' \) -printf '%f\n'"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Could not list remote backups (VPS unreachable?) -- nothing pulled this run."
    exit 1
}

$localFiles = Get-ChildItem -Path $LocalDir -File | ForEach-Object { $_.Name }
$toFetch = $remoteFiles | Where-Object { $_ -and ($localFiles -notcontains $_) }

if (-not $toFetch) {
    Write-Output "Nothing new to pull. $(Get-Date -Format o)"
    exit 0
}

foreach ($f in $toFetch) {
    Write-Output "Pulling $f ..."
    & $Scp -o BatchMode=yes "${RemoteHost}:${RemoteDir}/$f" "$LocalDir\$f"
}

Write-Output "Done. Pulled $($toFetch.Count) new file(s) at $(Get-Date -Format o)."
