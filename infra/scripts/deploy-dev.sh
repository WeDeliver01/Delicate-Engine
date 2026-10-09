#!/usr/bin/env bash
#
# Deploy the dev environment to this machine (dev.delicatecourier.co.za).
#
# Run it on the VPS, from the repository root:
#
#   infra/scripts/deploy-dev.sh            # pull the images CI built, start, check
#
# Migrations are NOT run here. The api container applies them from its own entrypoint before
# the server starts, so they run wherever the image runs rather than only where this script
# does — and the worker sits them out so only one container migrates.
#   infra/scripts/deploy-dev.sh --seed     # ...and seed the catalog (first run)
#   infra/scripts/deploy-dev.sh --build    # build here instead of pulling (slow on 2 vCPU)
#   infra/scripts/deploy-dev.sh --edge     # also run Caddy on 80/443 (dedicated machine only)
#
# Images come from CI. This machine runs live services on two cores, so compiling a Next.js app
# on it would starve them for minutes; pulling takes seconds.
#
# By default this touches nothing on ports 80 or 443. The stack binds to loopback and whatever
# already serves the web on this box proxies to it — this VPS also hosts a live client site, and
# a deploy that fights for the edge would take that down rather than just failing.
#
# It is safe to run again: images rebuild only what changed, migrations are idempotent, and the
# database volume is never touched.

set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE_DIR="infra/docker"
COMPOSE_FILE="$COMPOSE_DIR/compose.dev-host.yml"
ENV_FILE="$COMPOSE_DIR/.env"

SEED=0
BUILD=0
EDGE=0
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --build) BUILD=1 ;;
    --no-build) BUILD=0 ;;   # accepted for habit; pulling is already the default
    --edge) EDGE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done
PROFILE=()
[[ "$EDGE" == "1" ]] && PROFILE=(--profile edge)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ── preflight: fail here rather than halfway through a deploy ────────────────
say "Checking the machine"
command -v docker >/dev/null || die "docker is not installed. See docs/RUNBOOK.md."
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing."
[[ -f "$ENV_FILE" ]] || die "no $ENV_FILE. Copy $COMPOSE_DIR/.env.dev.example to it and fill it in."

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

for required in DEV_HOST POSTGRES_PASSWORD DATABASE_URL SUPABASE_URL SUPABASE_JWT_SECRET; do
  [[ -n "${!required:-}" ]] || die "$required is empty in $ENV_FILE."
done
if [[ "$DATABASE_URL" == *REPLACE_WITH_POSTGRES_PASSWORD* ]]; then
  die "DATABASE_URL still has the placeholder password in it."
fi
# Anything NEXT_PUBLIC_ is compiled into the browser bundle when the web image is built, not
# read at run time. Missing them produces a site that looks fine and that nobody can sign in
# to, and the only fix is another build — so fail here instead, while it is cheap.
for required in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY; do
  [[ -n "${!required:-}" ]] || die "$required is empty in $ENV_FILE.
  It is baked into the browser bundle at build time, so sign-in would fail and setting it
  afterwards would not help without rebuilding. Fill it in first."
done
# Every tracking link the engine sends is built from WEB_PUBLIC_URL, and it defaults to
# localhost when unset. A recipient's "follow your delivery" link is an SMS that has already
# been paid for by the time anyone notices it points at a machine they do not have.
case "${WEB_PUBLIC_URL:-}" in
  "") die "WEB_PUBLIC_URL is empty in $ENV_FILE.
  Tracking links in emails and texts are built from it, and it falls back to
  http://localhost:3000 — so every recipient would be sent a link to their own machine.
  Set WEB_PUBLIC_URL=https://$DEV_HOST." ;;
  *"$DEV_HOST"*) ;;
  *) die "WEB_PUBLIC_URL ($WEB_PUBLIC_URL) does not mention $DEV_HOST. Tracking links sent to
  customers and recipients would point somewhere else. Set WEB_PUBLIC_URL=https://$DEV_HOST." ;;
esac

# The hostname the engine believes it lives at is also compiled in, by way of CORS. A mismatch
# here is a browser console full of CORS errors and a login that goes nowhere.
case "${CORS_ORIGINS:-}" in
  *"$DEV_HOST"*) ;;
  *) die "CORS_ORIGINS (${CORS_ORIGINS:-empty}) does not mention $DEV_HOST. The browser will be
  refused by the engine. Set CORS_ORIGINS=https://$DEV_HOST." ;;
esac
echo "  host      $DEV_HOST"
echo "  database  container postgres"
echo "  auth      ${SUPABASE_URL}"
echo "  links     ${WEB_PUBLIC_URL}/live/... in customer messages"
if [[ "$EDGE" == "1" ]]; then
  echo "  edge      Caddy on 80/443"
  # Refuse rather than race: something already on the edge is probably another site.
  for port in 80 443; do
    if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
      die "port $port is already in use on this machine. Run without --edge and let the existing web server proxy to ${WEB_BIND_PORT:-8090}; see infra/docker/nginx-dev.conf."
    fi
  done
else
  echo "  edge      none — nginx (or whatever serves this box) proxies to 127.0.0.1"
  echo "  web       127.0.0.1:${WEB_BIND_PORT:-8090}"
  echo "  api       127.0.0.1:${API_BIND_PORT:-8091}"
fi

# DNS has to resolve here before Let's Encrypt will issue anything. In proxy mode the existing
# web server owns the certificate, so this is informational.
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
if [[ "$BUILD" == "0" ]]; then
  say "Pulling the images CI built"
  if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "${PROFILE[@]}" pull --quiet api web; then
    cat >&2 <<'MSG'

  Could not pull. If the repository has been made private, the images are private too:

    echo <a-github-token-with-read:packages> | docker login ghcr.io -u <your-github-username> --password-stdin

  Or build on this machine instead with --build (slower, and it competes with live services).
MSG
    exit 1
  fi
else
  say "Building images here (a few minutes on two cores)"
  # Available memory matters: the Next build is the hungry one.
  FREE_MB="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 9999)"
  if [[ "$FREE_MB" -lt 1500 ]]; then
    echo "  warning: only ${FREE_MB}MB available. If the web build is killed, add swap:"
    echo "    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "${PROFILE[@]}" build
fi

# ── start ────────────────────────────────────────────────────────────────────
say "Starting the stack"
# The API applies migrations on boot; the worker waits for it to be healthy.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "${PROFILE[@]}" up -d

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
say "Checking it answers"
sleep 3
LOCAL_API="http://127.0.0.1:${API_BIND_PORT:-8091}/healthz"
if curl -fsS --max-time 10 "$LOCAL_API" > /tmp/dev-health.json 2>/dev/null; then
  echo "  $LOCAL_API → $(cat /tmp/dev-health.json)"
  rm -f /tmp/dev-health.json
else
  die "the engine is not answering on $LOCAL_API. Logs: docker compose -f $COMPOSE_FILE logs api"
fi
if curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:${WEB_BIND_PORT:-8090}/" 2>/dev/null; then
  echo "  http://127.0.0.1:${WEB_BIND_PORT:-8090}/ → the site is up"
fi
if curl -fsS --max-time 15 "https://$DEV_HOST/api/healthz" >/dev/null 2>&1; then
  echo "  https://$DEV_HOST/api/healthz → reachable from outside"
else
  echo "  https://$DEV_HOST is not answering yet — expected until DNS points here and the"
  echo "  proxy vhost is in place (infra/docker/nginx-dev.conf)."
fi

say "Done"
cat <<SUMMARY
  Site       https://$DEV_HOST
  Portal     https://$DEV_HOST/portal
  Console    https://$DEV_HOST/admin
  Health     https://$DEV_HOST/api/healthz

  Local      http://127.0.0.1:${WEB_BIND_PORT:-8090}  (before the proxy is wired up)

  Logs       docker compose -f $COMPOSE_FILE logs -f api worker web
  Backup     KEEP_DAYS=30 BACKUP_DIR=/srv/backups infra/scripts/backup.sh
  Reconcile  open the console, Reconciliation — everything should pass

  First sign-in: create your user in Supabase, then give it a platform role:
    docker compose -f $COMPOSE_FILE exec -T postgres \\
      psql -U ${POSTGRES_USER:-delicate} -d ${POSTGRES_DB:-delicate} \\
      -c "update users set platform_role = 'super_admin' where email = 'you@example.co.za';"
SUMMARY
