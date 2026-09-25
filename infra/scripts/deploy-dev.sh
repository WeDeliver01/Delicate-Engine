#!/usr/bin/env bash
#
# Deploy the dev environment to this machine (dev.delicatecourier.co.za).
#
# Run it on the VPS, from the repository root:
#
#   infra/scripts/deploy-dev.sh            # build, migrate, start, check
#   infra/scripts/deploy-dev.sh --seed     # ...and seed the catalog and demo data (first run)
#   infra/scripts/deploy-dev.sh --no-build # restart without rebuilding
#
# It is safe to run again: images rebuild only what changed, migrations are idempotent, and the
# database volume is never touched.

set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE_DIR="infra/docker"
COMPOSE_FILE="$COMPOSE_DIR/compose.dev-host.yml"
ENV_FILE="$COMPOSE_DIR/.env"

SEED=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --no-build) BUILD=0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ── preflight: fail here rather than halfway through a deploy ────────────────
say "Checking the machine"
command -v docker >/dev/null || die "docker is not installed. See docs/RUNBOOK.md."
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing."
[[ -f "$ENV_FILE" ]] || die "no $ENV_FILE. Copy $COMPOSE_DIR/.env.dev.example to it and fill it in."

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

for required in DEV_HOST POSTGRES_PASSWORD DATABASE_URL SUPABASE_URL; do
  [[ -n "${!required:-}" ]] || die "$required is empty in $ENV_FILE."
done
if [[ "$DATABASE_URL" == *REPLACE_WITH_POSTGRES_PASSWORD* ]]; then
  die "DATABASE_URL still has the placeholder password in it."
fi
echo "  host      $DEV_HOST"
echo "  database  container postgres"
echo "  auth      ${SUPABASE_URL}"

# DNS has to resolve here before Let's Encrypt will issue anything.
RESOLVED="$(getent hosts "$DEV_HOST" | awk '{print $1}' | head -1 || true)"
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
if [[ -n "$RESOLVED" && -n "$PUBLIC_IP" && "$RESOLVED" != "$PUBLIC_IP" ]]; then
  echo
  echo "  warning: $DEV_HOST resolves to $RESOLVED but this machine is $PUBLIC_IP."
  echo "  Let's Encrypt will not issue a certificate until DNS points here."
elif [[ -z "$RESOLVED" ]]; then
  echo "  warning: $DEV_HOST does not resolve yet. TLS will fail until it does."
fi

# ── build ────────────────────────────────────────────────────────────────────
if [[ "$BUILD" == "1" ]]; then
  say "Building images (first run takes a few minutes)"
  # Available memory matters: the Next build is the hungry one.
  FREE_MB="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 9999)"
  if [[ "$FREE_MB" -lt 1500 ]]; then
    echo "  warning: only ${FREE_MB}MB available. If the web build is killed, add swap:"
    echo "    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build
fi

# ── start ────────────────────────────────────────────────────────────────────
say "Starting the stack"
# The API applies migrations on boot; the worker waits for it to be healthy.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

say "Waiting for the engine"
for i in $(seq 1 60); do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api \
      node -e "fetch('http://localhost:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "  healthy after ${i}0s" && break
  fi
  [[ "$i" == "60" ]] && die "the API did not come up. Logs: docker compose -f $COMPOSE_FILE logs api"
  sleep 10
done

# ── seed ─────────────────────────────────────────────────────────────────────
if [[ "$SEED" == "1" ]]; then
  say "Seeding the catalog"
  # Idempotent: existing rows are left alone, because they are the operator's.
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api \
    node --input-type=module -e "
      import { createDb } from '@delicate/db';
      import { seedCatalog } from '@delicate/db';
      const h = createDb(process.env.DATABASE_URL, { max: 1 });
      await h.db.transaction((tx) => seedCatalog(tx));
      await h.close();
      console.log('catalog seeded');
    "
fi

# ── prove it ─────────────────────────────────────────────────────────────────
say "Checking from the outside"
sleep 3
if curl -fsS --max-time 15 "https://$DEV_HOST/api/healthz" > /tmp/dev-health.json 2>/dev/null; then
  echo "  https://$DEV_HOST/api/healthz → $(cat /tmp/dev-health.json)"
  rm -f /tmp/dev-health.json
else
  echo "  could not reach https://$DEV_HOST/api/healthz yet."
  echo "  A new certificate can take a minute. Watch it: docker compose -f $COMPOSE_FILE logs -f caddy"
fi

say "Done"
cat <<SUMMARY
  Site       https://$DEV_HOST
  Portal     https://$DEV_HOST/portal
  Console    https://$DEV_HOST/admin
  Health     https://$DEV_HOST/api/healthz

  Logs       docker compose -f $COMPOSE_FILE logs -f api worker web
  Backup     KEEP_DAYS=30 BACKUP_DIR=/srv/backups infra/scripts/backup.sh
  Reconcile  open the console, Reconciliation — everything should pass

  First sign-in: create your user in Supabase, then give it a platform role:
    docker compose -f $COMPOSE_FILE exec -T postgres \\
      psql -U ${POSTGRES_USER:-delicate} -d ${POSTGRES_DB:-delicate} \\
      -c "update users set platform_role = 'super_admin' where email = 'you@example.co.za';"
SUMMARY
