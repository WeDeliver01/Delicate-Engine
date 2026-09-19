#!/bin/bash
set -e

export DJANGO_DEBUG="${DJANGO_DEBUG:-0}"
export DJANGO_ALLOWED_HOSTS="${DJANGO_ALLOWED_HOSTS:-*}"
export DJANGO_TIME_ZONE="${DJANGO_TIME_ZONE:-Africa/Johannesburg}"

echo "==> Django backend on :8000 (DEBUG=$DJANGO_DEBUG, TZ=$DJANGO_TIME_ZONE)"
cd backend
source .venv/bin/activate 2>/dev/null || python -m venv .venv && source .venv/bin/activate
pip install -q -r requirements.txt 2>/dev/null || true

# Schema + idempotent seed data (safe to run on every boot)
python manage.py migrate
python manage.py seed_catalog        || true
python manage.py generate_slots      || true
python manage.py treasury_seed       || true

# Transactional outbox worker: delivers ShipLogic, engine and treasury events.
echo "==> Outbox dispatch worker"
python manage.py dispatch_outbox --loop --interval 2 &
WORKER_PID=$!

python manage.py runserver 0.0.0.0:8000 --insecure &
BACKEND_PID=$!
cd ..

echo "==> Next.js frontend on :3000"
cd frontend
if [ -f ".next/BUILD_ID" ]; then
  node_modules/.bin/next start -p 3000 &
else
  node_modules/.bin/next dev -p 3000 &
fi
FRONTEND_PID=$!
cd ..

echo "==> Up. backend=$BACKEND_PID worker=$WORKER_PID frontend=$FRONTEND_PID"
wait $BACKEND_PID $WORKER_PID $FRONTEND_PID
