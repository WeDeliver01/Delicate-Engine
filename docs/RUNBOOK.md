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

## The dev environment (dev.delicatecourier.co.za)

One Ubuntu 24 VPS running the whole stack: Caddy, the engine, the worker, the web app and
Postgres in a container. One hostname, one certificate; Caddy sends `/api` straight to the engine
so webhook bodies reach it untouched, and everything else to the web app.

Auth is Supabase even here. The runtime image is a production build and refuses development
tokens: a public host with dev tokens would be a real hole, and the login your customers will use
is the one worth testing. A free Supabase project is enough.

### Once, on a new machine

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker

# 2. A 2 GB swapfile. The Next build needs headroom on a 4 GB box.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 3. Only 22, 80 and 443 open. Postgres is not published to the host at all.
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable

# 4. The code
sudo mkdir -p /opt/delicate && sudo chown "$USER" /opt/delicate
git clone <your-repo> /opt/delicate   # or rsync the working tree up
```

Point an **A record** for `dev.delicatecourier.co.za` at the VPS IP before deploying — Let's
Encrypt validates over port 80 and will not issue a certificate until DNS resolves here.

### This VPS is shared

It already runs other things — a Next.js app on :3000 and nginx serving a WordPress site that
redirects to melindaskitchen.operandis.co.za. So the engine **does not take ports 80 and 443**.
It binds to loopback and the existing nginx proxies to it. The worst a mistake can then do is
break this stack, never a client's live site.

```
  browser ──► nginx :443 ──► 127.0.0.1:8090  web
                        └──► 127.0.0.1:8091  engine (/api)
```

### Deploy

```bash
cd /opt/delicate
cp infra/docker/.env.dev.example infra/docker/.env
$EDITOR infra/docker/.env          # host, database password, Supabase keys
infra/scripts/deploy-dev.sh --seed # first run; drop --seed afterwards
```

The script checks the machine before it starts — Docker, a filled-in env, no placeholder
password, DNS, free memory — builds both images, applies migrations on boot, waits for health
and proves the engine answers. It is safe to run again.

Then put nginx in front, once:

```bash
sudo cp infra/docker/nginx-dev.conf /etc/nginx/sites-available/dev.delicatecourier.co.za
sudo ln -s /etc/nginx/sites-available/dev.delicatecourier.co.za /etc/nginx/sites-enabled/
sudo nginx -t                      # parses every site: catches anything that would break the others
sudo systemctl reload nginx
sudo certbot --nginx -d dev.delicatecourier.co.za
```

`nginx -t` before every reload, without exception. It validates the whole configuration, so it
also catches a mistake that would have taken the other sites down with it.

On a machine where nothing else serves the web, `deploy-dev.sh --edge` runs Caddy on 80/443 and
handles TLS itself instead. It refuses to start if either port is already in use.

### First sign-in

Create your user in Supabase, sign in once at `https://dev.delicatecourier.co.za/portal` so the
engine mirrors the account, then grant yourself a role:

```bash
docker compose -f infra/docker/compose.dev-host.yml exec -T postgres   psql -U delicate -d delicate   -c "update users set platform_role = 'super_admin' where email = 'you@example.co.za';"
```

Then open **Settings → What is switched on** and fill in the company tax identity and the real
monthly bills. Until the VAT number is set, documents issue as plain invoices.

### Afterwards

```bash
git pull && infra/scripts/deploy-dev.sh          # update
infra/scripts/deploy-dev.sh --no-build           # just restart
docker compose -f infra/docker/compose.dev-host.yml logs -f api worker web
KEEP_DAYS=30 BACKUP_DIR=/srv/backups infra/scripts/backup.sh
```

After any deploy, open **Reconciliation** in the console. Every check should pass.

### Going to production later

Two changes: point `DATABASE_URL` at Supabase and drop the `postgres` service, and use
`compose.prod.yml` with images from a registry rather than building on the box. Everything else
is the same file with a different hostname.

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
