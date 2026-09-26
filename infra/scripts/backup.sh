#!/usr/bin/env bash
#
# Back up the Delicate Engine database.
#
# This is an append-only money system: the ledger, the wallet entries and the audit log cannot be
# reconstructed from anywhere else, so a backup is the only thing standing between a bad day and
# not knowing what anyone was owed. Run it on a schedule, and — the part people skip — restore it
# somewhere else once a month to prove it works. A backup nobody has restored is a hope.
#
#   infra/scripts/backup.sh                 # write a backup, prune old ones
#   KEEP_DAYS=30 BACKUP_DIR=/srv/backups infra/scripts/backup.sh
#
# Cron, daily at 02:15, keeping a month:
#   15 2 * * * cd /srv/delicate && KEEP_DAYS=30 infra/scripts/backup.sh >> /var/log/delicate-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  # Fall back to the project's .env, so the script works the same by hand and from cron.
  if [[ -f .env ]]; then
    DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)"
  fi
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set and no .env was found" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/delicate-$STAMP.dump"

echo "backing up to $OUT"
# Custom format: compressed, and restorable table by table when only one thing went wrong.
pg_dump --format=custom --no-owner --no-privileges --file="$OUT" "$DATABASE_URL"

# Prove the file is readable before trusting it. A dump that cannot be listed is not a backup.
if ! pg_restore --list "$OUT" > /dev/null 2>&1; then
  echo "the dump could not be read back; treating this run as failed" >&2
  rm -f "$OUT"
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "wrote $OUT ($SIZE), verified readable"

# Prune, but never leave zero backups behind — if pruning would empty the directory, stop.
REMAINING="$(find "$BACKUP_DIR" -name 'delicate-*.dump' -type f | wc -l)"
if [[ "$REMAINING" -gt 1 ]]; then
  find "$BACKUP_DIR" -name 'delicate-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete
fi

echo "done. $(find "$BACKUP_DIR" -name 'delicate-*.dump' -type f | wc -l) backup(s) kept."
