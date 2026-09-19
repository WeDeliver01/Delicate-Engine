# Runbook — VPS deployment

Target: one Linux VPS (Ubuntu 24.04, 2 vCPU / 4 GB is plenty for launch) running Docker
Compose; Postgres + Auth in Supabase; TLS by Caddy.

## First-time setup

1. Point DNS: `SITE_HOST` (e.g. `delicatecourier.co.za`) and `API_HOST`
   (e.g. `api.delicatecourier.co.za`) → the VPS IP.
2. On the VPS: install Docker Engine + compose plugin; create `/opt/delicate`.
3. Copy `infra/docker/compose.prod.yml` → `/opt/delicate/docker-compose.yml` and
   `infra/docker/Caddyfile` → `/opt/delicate/Caddyfile`.
4. Create `/opt/delicate/.env` from `.env.example`: production values for `DATABASE_URL`
   (Supabase **session pooler** URL), `SUPABASE_URL`, `SUPABASE_JWT_SECRET` (or leave empty
   for JWKS), `CORS_ORIGINS=https://<SITE_HOST>`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`,
   plus `SITE_HOST`, `API_HOST`, `IMAGE_API`, `IMAGE_WEB`. Never set `AUTH_DEV_SECRET`.
5. `docker login ghcr.io` with a read token, then `docker compose pull && docker compose up -d`.
6. Check `https://<API_HOST>/healthz` → `{"status":"ok"}` and the site loads.

## Deploying a new version

CI builds and pushes `engine-api` and `engine-web` images on every push to `main`
(tagged `latest` and the commit SHA). On the VPS:

```bash
cd /opt/delicate && docker compose pull && docker compose up -d
```

The `api` container applies pending migrations on start (`RUN_MIGRATIONS=1`); the worker
waits for the API to be healthy. Roll back by pinning `IMAGE_API`/`IMAGE_WEB` to a previous SHA.

## Operations

- Logs: `docker compose logs -f api worker web` (JSON lines, rotated).
- Outbox health: `/admin/outbox` in the console, or `GET /v1/admin/outbox/stats`.
  Dead messages are re-armed with **Requeue** (audited).
- Database backups: Supabase daily backups + PITR on the paid tier. Before a migration that
  touches money tables, take a manual backup in the Supabase dashboard.
- Secrets rotate in `/opt/delicate/.env`, then `docker compose up -d` (containers restart).
