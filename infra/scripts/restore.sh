#!/usr/bin/env bash
#
# Restore a Delicate Engine backup.
#
# Restoring over a live database is destructive and irreversible, so this refuses to touch one
# unless you say the database name back to it. The usual and safer use is restoring into a
# scratch database to check a backup is good, or to look at what something used to say.
#
#   infra/scripts/restore.sh backups/delicate-20260925T021500Z.dump delicate_restore_check
#   CONFIRM=delicate infra/scripts/restore.sh backups/latest.dump delicate     # the real thing
#
# After restoring, run the reconciliation report (Admin → Reconciliation). If the books do not
# balance in the restored copy, the backup caught a torn write and an earlier one should be used.

set -euo pipefail

DUMP="${1:-}"
TARGET_DB="${2:-}"

if [[ -z "$DUMP" || -z "$TARGET_DB" ]]; then
  echo "usage: restore.sh <dump-file> <target-database>" >&2
  exit 1
fi
if [[ ! -f "$DUMP" ]]; then
  echo "no such dump: $DUMP" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set and no .env was found" >&2
  exit 1
fi

# Everything up to the database name, so we can address the server without naming a database.
SERVER="${DATABASE_URL%/*}"
LIVE_DB="${DATABASE_URL##*/}"
LIVE_DB="${LIVE_DB%%\?*}"

if [[ "$TARGET_DB" == "$LIVE_DB" && "${CONFIRM:-}" != "$LIVE_DB" ]]; then
  cat >&2 <<MSG
Refusing to overwrite the live database "$LIVE_DB".

This replaces every row, including the ledger and the audit log, and cannot be undone.
If that is genuinely what you want, say the name back:

  CONFIRM=$LIVE_DB $0 "$DUMP" "$TARGET_DB"
MSG
  exit 1
fi

echo "restoring $DUMP into $TARGET_DB"
psql "$SERVER/postgres" -v ON_ERROR_STOP=1 -c "drop database if exists \"$TARGET_DB\";"
psql "$SERVER/postgres" -v ON_ERROR_STOP=1 -c "create database \"$TARGET_DB\";"
pg_restore --no-owner --no-privileges --dbname "$SERVER/$TARGET_DB" "$DUMP"

echo
echo "restored. Now prove it:"
echo "  1. point the API at $TARGET_DB and open Admin → Reconciliation"
echo "  2. every check should pass; if the ledger does not balance, use an earlier backup"
