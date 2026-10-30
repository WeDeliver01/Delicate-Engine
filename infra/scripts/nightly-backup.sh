#!/usr/bin/env bash
# Nightly dump of both Postgres databases plus an encrypted snapshot of both .env files,
# written to /srv/backups. Meant to run from cron; a separate machine then pulls the new
# files down over SCP (see infra/scripts/pull-backups.ps1) so a lost VPS doesn't lose
# everything with it. Old backups are pruned here after they've had time to be pulled.
#
# One-time setup on the VPS:
#   1. Put this file at /srv/scripts/nightly-backup.sh (chmod +x) -- outside both git
#      checkouts so it survives a `git clean` in either one.
#   2. Set BACKUP_ENCRYPT_PASSPHRASE in /srv/scripts/backup.env (chmod 600), a passphrase
#      only you know -- not committed anywhere. The .env snapshots are encrypted with it.
#   3. crontab -e as root:
#        15 2 * * * BACKUP_ENV=/srv/scripts/backup.env /srv/scripts/nightly-backup.sh >> /srv/backups/nightly-backup.log 2>&1
set -euo pipefail

OUT_DIR=/srv/backups
RETAIN_DAYS=14
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -n "${BACKUP_ENV:-}" && -f "$BACKUP_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$BACKUP_ENV"
fi
: "${BACKUP_ENCRYPT_PASSPHRASE:?set BACKUP_ENCRYPT_PASSPHRASE in the sourced backup.env}"

mkdir -p "$OUT_DIR"

dump_db() {
  local label="$1" container="$2" db="$3" user="$4"
  local file="$OUT_DIR/${label}-${STAMP}.dump"
  if docker exec "$container" pg_dump -U "$user" -d "$db" -F c -f "/tmp/${label}.dump"; then
    docker cp "$container:/tmp/${label}.dump" "$file"
    docker exec "$container" rm -f "/tmp/${label}.dump"
    echo "wrote $file ($(du -h "$file" | cut -f1))"
  else
    echo "WARNING: pg_dump failed for $label ($container)" >&2
  fi
}

dump_db prod delicate-prod-postgres-1 delicate delicate
dump_db dev  delicate-dev-postgres-1  delicate delicate

# Secrets snapshot: both .env files, tarred then symmetrically encrypted. Never left
# unencrypted on disk, even briefly -- piped straight into gpg.
ENV_FILE="$OUT_DIR/env-${STAMP}.tar.gz.gpg"
tar -czf - \
  -C /srv/delicate-prod/infra/docker .env \
  -C /srv/delicate-engine/infra/docker .env \
  2>/dev/null \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_ENCRYPT_PASSPHRASE" -o "$ENV_FILE"
echo "wrote $ENV_FILE ($(du -h "$ENV_FILE" | cut -f1))"

find "$OUT_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.tar.gz.gpg' \) -mtime "+${RETAIN_DAYS}" -print -delete

echo "nightly-backup.sh done at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
