#!/bin/bash
set -e

npm install

# Apply versioned SQL migrations (idempotent) before drizzle-kit push,
# so manual analytics migrations land cleanly in dev/prod.
if [ -n "$DATABASE_URL" ] && [ -d migrations ]; then
  for f in migrations/*.sql; do
    [ -f "$f" ] || continue
    echo "[post-merge] applying $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
fi

# Sync any remaining schema drift. --force handles non-interactive runs.
npm run db:push -- --force || npm run db:push
