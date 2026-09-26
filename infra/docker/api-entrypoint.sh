#!/bin/sh
# Apply pending migrations before the API starts. The worker sets RUN_MIGRATIONS=0 so only one
# container migrates; drizzle's migrator is transactional and idempotent, so a race would only
# cost a retry, never a half-applied schema.
set -e
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "applying migrations"
  node --input-type=module -e "import { runMigrations } from '@delicate/db'; await runMigrations(process.env.DATABASE_URL);"
fi
exec "$@"
