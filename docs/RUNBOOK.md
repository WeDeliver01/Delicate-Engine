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

## Backups

Supabase takes daily backups (and point-in-time recovery on the paid tier), but this is an
append-only money system: the ledger, wallet entries and audit log exist nowhere else, so keep
your own copy too.

```bash
KEEP_DAYS=30 BACKUP_DIR=/srv/backups infra/scripts/backup.sh
```

The script verifies the dump is readable before keeping it, and refuses to prune down to zero.
Run it nightly from cron:

```
15 2 * * * cd /opt/delicate && KEEP_DAYS=30 BACKUP_DIR=/srv/backups infra/scripts/backup.sh >> /var/log/delicate-backup.log 2>&1
```

**Restore a backup into a scratch database once a month.** A backup nobody has restored is a
hope, not a backup.

```bash
infra/scripts/restore.sh /srv/backups/delicate-20260925T021500Z.dump delicate_restore_check
```

Then point an API at the restored copy and open **Admin → Reconciliation**. Every check should
pass. If the ledger does not balance in the restored copy, that backup caught a torn write — use
an earlier one, and find out why.

Take a manual backup before any migration that touches a money table.

## When something is wrong

**The books do not balance.** Admin → Reconciliation says which promise broke and by how much,
and names the rows that disagree. It repairs nothing deliberately: fix the cause, not the
symptom. A wallet cache out of step with its entries is a bug in whatever wrote it; the entries
are the truth.

**Margin is not all earmarked.** Usually a `settlement.posted` event that has not been delivered
yet — check Admin → Outbox. If events are dead, requeue them; the handlers are idempotent, so a
replay is safe.

**An event is dead.** Admin → Outbox, Requeue (audited). Dead means it exhausted its retries: the
delivery happened, but something the event was supposed to cause — a treasury allocation, an
invoice, a notification — did not. Reconciliation will keep reporting it until it does.

**A payment provider is down.** Nothing breaks: top-ups fail at the point of payment and the
wallet is untouched, because it is credited only from a verified webhook. Customers can still pay
by EFT. Watch Admin → Settings → What is switched on.

**Email is not going out.** Admin → Notifications shows each channel's state and a count of what
is queued or held. Messages are written down before they are sent, so nothing is lost while a
mail host is down — they send when it returns. A message with nowhere to go is marked
`suppressed` with the reason, not discarded.

**A driver was paid the wrong amount.** Do not edit anything. Payments are proposals with an
audit trail: reject or cancel the proposal, correct the settlement rules or the settlement, and
propose again. Reconciliation proves earned − paid = owed for every driver.

**The engine is refusing public requests (429).** Rate limiting is per API instance and per
caller. Legitimate traffic that trips it means the limits in `apps/api/src/common/rate-limit.ts`
need raising; a single IP walking `/v1/public/track` is someone enumerating waybills.

## Releasing the driver app

The driver app is Expo (`apps/driver`). It is not published by CI, because an app store release
is deliberate.

```bash
cd apps/driver
pnpm exec eas build --platform android --profile production
pnpm exec eas build --platform ios --profile production
pnpm exec eas submit --platform android   # and --platform ios
```

Before submitting:

- point `EXPO_PUBLIC_API_URL` at the production API,
- bump `version` in `app.json` (and let EAS handle the build number),
- check the permission strings still describe what the app does — background location is
  explained as tracking deliveries while on shift, and the camera as proof of delivery. App
  review rejects vague ones, and the driver deserves an honest answer anyway,
- install the build and complete one real delivery against staging: shift, collect, POD, deliver.

Over-the-air updates (`eas update`) are fine for JavaScript-only fixes. Anything touching
permissions, native modules or the app config needs a new build.
