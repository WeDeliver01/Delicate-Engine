# Delicate Event Engine

A standalone backend that turns real-world events (a completed delivery, an NFC
tag tap) into loyalty: cash-back wallets in Rands, tiers, and milestones. It runs
alongside the Route Optimizer as a separate service with its own database.

The core idea: this is an **event engine, not an NFC system**. A tag only carries
identity. The actor is whoever is authenticated when the tag is tapped. Money
never comes from a tap. Loyalty accrues only from actual delivery completions
pushed by the Route Optimizer, so a cloned or copied tag can never mint credit.

## Architecture

```
 NFC tap (driver/customer)            Route Optimizer
        │                                    │
        │ GET /t  or  POST /tags/resolve     │ POST /webhooks/route-optimizer
        ▼                                    ▼  (HMAC-signed, non-blocking)
 ┌──────────────────────────── Event Engine ───────────────────────────┐
 │  verify  →  ingest (idempotent)  →  dispatch (rules)                 │
 │                                        ├─ accrue_loyalty             │
 │                                        └─ send_webhook (fan-out)     │
 │  loyalty: append-only ledger (cents) · tiers · milestones           │
 └──────────────────────────────────────────────────────────────────────┘
        │                                    │
        ▼                                    ▼
 customer portal API                   outbound webhooks to subscribers
```

Stack: Node + Express + TypeScript, PostgreSQL via Drizzle ORM. Deployable on
Replit. Same stack as the Route Optimizer for maintainability.

## Money integrity

- The wallet is an **append-only ledger** in integer cents. The account balance
  is a cached sum, reconciled against the ledger every few hours.
- Every cash-back entry references the delivery event that earned it. A unique
  index on `(source_event_id, entry_type)` makes accrual idempotent: a duplicated
  completion webhook can never credit twice.
- Shipment counting is anchored to that same accrual entry, so a shipment is
  counted exactly once even at zero cash back.
- Tiers, milestones, and cash-back rates are configuration rows, not hardcoded.

## Setup

Requires Node 18+ and a PostgreSQL database (separate from the Route Optimizer).

```bash
npm install
cp .env.example .env        # then fill in the values
npm run db:push             # create tables (dev). For prod use db:generate + db:migrate
npm run seed                # tiers, milestones, rules, and a Honey Bee Baker sample
npm run dev                 # start on PORT (default 4000)
```

Check it is alive:

```bash
curl http://localhost:4000/health
```

### Key environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | This service's own Postgres |
| `CUSTOMER_JWT_SECRET` | Signs customer portal tokens |
| `ROUTE_OPTIMIZER_SESSION_SECRET` | Must equal the Route Optimizer's `SESSION_SECRET` so driver-app tokens validate here |
| `ADMIN_API_KEY` | Protects `/admin/*` (send as `x-admin-key`) |
| `ROUTE_OPTIMIZER_WEBHOOK_SECRET` | Shared secret for the inbound completion webhook |
| `NTAG_META_READ_KEY` / `NTAG_FILE_READ_KEY` | App-wide AES-128 keys for NTAG 424 DNA |

## Route Optimizer integration (push)

The Route Optimizer pushes completions here. See
`integrations/route-optimizer-patch/INSTALL.md` for the one additive,
env-gated, non-blocking change and its reliability trade-off (direct push vs an
outbox table for zero loss).

## NTAG 424 DNA tags

The resolver expects the common SDM "encrypted PICC + CMAC" layout. Each tap
URL carries:

- `picc_data`: AES-128-CBC encrypted PICC data (UID + tap counter)
- `cmac`: the 8-byte truncated SDMMAC

Personalize tags so that:

1. SDM is enabled with **encrypted PICC data mirroring** (UID + SDMReadCtr).
2. The **SDMMAC** is mirrored, computed with the SDM file-read key.
3. `NTAG_META_READ_KEY` matches the tag's SDM meta-read key, and
   `NTAG_FILE_READ_KEY` matches the SDM file-read key.
4. The NDEF URL points at `https://<host>/t` with the mirror placeholders for
   `picc_data` and `cmac` (param names are configurable via `NTAG_*_PARAM`).

The same app-wide keys can be used on every tag. That is safe: the keys live only
in the tag's secure memory and on this server, the tag never reveals them, and
each tap's signature is bound to the tag UID and an incrementing counter.
Clone protection comes from the unextractable key plus the monotonic counter,
not from per-tag keys.

### Verifying the crypto

The AES-CMAC primitive is validated against the RFC 4493 test vectors:

```bash
npm run ntag:selftest
```

The full SDM decode path should be validated against a **real tap** from one of
your encoded tags (hardware keys and counters cannot be faked safely):

```bash
npm run ntag:verify -- "https://yourhost/t?picc_data=...&cmac=..."
# prints UID, read counter, and whether the MAC verifies
```

Register a tag once you have its UID:

```bash
curl -X POST http://localhost:4000/admin/tags \
  -H "x-admin-key: $ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"tagUid":"04aabbccddee80","label":"HBB001","nodeId":"<node-uuid>"}'
```

## API surface

Public

- `GET  /health`
- `GET  /t` — tag NDEF target; reads `picc_data` and `cmac` from the query
- `POST /tags/resolve` — `{ picc, cmac, enc? }`; same logic, frontend-friendly.
  A driver bearer token makes the tap a collection confirmation; a customer token
  returns their wallet; no token returns node identity for portal login.

Customer (bearer token from `/customer/login`)

- `POST /customer/login` — `{ email, password }`
- `GET  /customer/wallet` — balance, tier, benefits
- `GET  /customer/ledger` — recent wallet movements
- `GET  /customer/milestones` — milestones reached
- `GET  /customer/activity` — recent events for the node

Admin (`x-admin-key`)

- `POST /admin/nodes`, `GET /admin/nodes`
- `POST /admin/tags`, `PATCH /admin/tags/:id`
- `POST /admin/customer-users`
- `POST /admin/nodes/:nodeId/adjust` — manual wallet adjustment
- `POST /admin/webhook-endpoints` — register an outbound subscriber
- `GET  /admin/events`, `/admin/dispatch-log`, `/admin/inbound-webhooks`,
  `/admin/webhook-deliveries` — observability

Webhooks

- `POST /webhooks/route-optimizer` — inbound completion receiver (HMAC-signed)

## Loyalty program

Tiers (by monthly shipments) and milestones (by lifetime shipments) are seeded
from `src/config/program.ts`. Edit that file before seeding, or change the
`tier_config` / `milestones` rows live. Cash back climbs from 2% (Bronze) to 5%
(Platinum and above), matching the program doc.

## What is in this build

In scope: the event engine, the NTAG 424 DNA verifier, the inbound completion
webhook, the loyalty ledger with cash-back accrual, tiers, milestones, the
customer/driver/ops APIs, outbound webhook fan-out, seed data, and the Route
Optimizer patch.

Out of scope for now (the engine already exposes what they need): the customer
dashboard frontend, and the full referral and redemption flows. The tables and
admin adjustment exist; the customer-facing UI for them is a later phase.

## Background workers

On startup the service runs three workers: webhook delivery retries (30s), a
monthly tier rollover that resets monthly shipment counts at month boundaries
(hourly), and a ledger reconciliation that corrects any cached-balance drift
against the ledger (every 6 hours).
