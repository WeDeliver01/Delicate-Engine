# Delicate Engine — Architecture & Build Plan

Status: **SIGNED OFF** by Ashley, 2026-09-19. Phase 0 delivered the same day (see README phase table).

This is a fresh build. Everything under `_reference/` and `_archive/` is prior-attempt context
only; nothing from it is carried over as tested functionality. Where a reference contains a
design worth keeping (integer-cents ledgers, transactional outbox, treasury allocation
algorithm, slot capacity gating) it is re-implemented here, not copied.

---

## 1. What the engine is

One system where **every transaction begins and is accounted for**:

```
Marketing site ──► Portal (account · wallet · book) ──► ENGINE
                                                          │
        ┌─────────────────────────────────────────────────┼──────────────────────────────┐
        │ price it       gate it            confirm it    │ assign it        settle it   │
        │ (rate cards)   (wallet/credit +   (waybill,      │ (driver on shift, (actual km, │
        │                 slot capacity)     events)       │  capacity, proximity) earnings,│
        │                                                  │                     fuel, margin)│
        └──────────────────────────────────────────────────┴──────────────────────────────┘
                                                          │
                                              TREASURY: allocate margin, fund obligations,
                                              propose fuel-card loads & payouts → human executes
```

Decisions taken with Ashley (2026-09-19):

| Topic          | Decision                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fulfilment     | **Own drivers only.** No ShipLogic. We own waybills, tracking, POD, billing.                                                                                     |
| Customers      | Businesses **and** individuals. A business can own **several accounts** and users toggle between them freely.                                                    |
| Payments       | **Prepaid wallet + postpaid monthly account** (credit limit + statement). Providers: **PayFast, Yoco, BobPay, manual EFT** behind one adapter.                   |
| Pricing        | **Admin-configurable rate-card engine**: zone tables and/or per-km rates, package types, service levels, surcharges, minimums.                                   |
| Scheduling     | **Service levels + daily slots with capacity** derived from rostered drivers; cut-offs; blackouts.                                                               |
| Assignment     | **Auto-assign on confirmation, dispatcher can override.**                                                                                                        |
| Driver pay     | **Per-delivery earning**; **fuel loaded to the driver's fuel card via PayCentral** (paycentral.co.za). Treasury computes delivery cost + earning per assignment. |
| Money controls | **Always propose, human executes.** The engine never moves real money on its own.                                                                                |
| Driver app     | **Native iOS/Android** (Expo / React Native).                                                                                                                    |
| Identity & DB  | **Supabase Auth + Supabase Postgres.**                                                                                                                           |
| Hosting        | **Own VPS, Docker Compose.** No Replit anywhere.                                                                                                                 |
| Portal apps    | Tracking + POD · Statements/invoices/wallet history · Address book + bulk CSV · Loyalty/cashback.                                                                |
| Language       | **TypeScript everywhere.**                                                                                                                                       |

---

## 2. Stack

| Layer                  | Choice                                                                                                               | Why                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Monorepo               | pnpm workspaces + Turborepo                                                                                          | One repo, shared packages, cached builds.                                                                 |
| API (the engine)       | **NestJS** (TypeScript) on Node 24                                                                                   | Modules + DI + validation + OpenAPI out of the box; the domain is large enough to need structure.         |
| Data                   | **Drizzle ORM** + SQL migrations on Supabase Postgres                                                                | Explicit schema and migrations — non-negotiable for a ledger.                                             |
| Validation / contracts | **Zod** schemas shared between API, web and mobile via `packages/contracts`                                          | One definition of every event and DTO.                                                                    |
| Jobs & outbox          | Postgres transactional outbox drained by the worker (`FOR UPDATE SKIP LOCKED`, backoff, dead-letter)                 | Durable retries without Redis/Kafka; ADR 0002. A job queue (pg-boss) is added when scheduled jobs arrive. |
| Web                    | **Next.js 15** (App Router) — route groups `(marketing)`, `(portal)`, `(admin)`                                      | One deployable; marketing, customer portal and ops/finance console share auth and UI kit.                 |
| Driver app             | **Expo (React Native)**, EAS builds                                                                                  | Native iOS/Android in TypeScript; background location, push, camera for POD.                              |
| Auth                   | Supabase Auth (email/password, OAuth, magic link). API verifies Supabase JWTs; roles/memberships live in our tables. | Already chosen; works for web and native.                                                                 |
| Maps                   | Google Routes/Places for distance & autocomplete, OSRM fallback (cost control)                                       | Same pattern the old optimizer proved.                                                                    |
| Payments               | Adapter interface → PayFast, Yoco, BobPay, ManualEFT                                                                 | Wallet is credited only on a verified server-to-server webhook.                                           |
| Fuel cards             | PayCentral adapter (load proposals → execute on approval)                                                            | Real money; proposal-only by design.                                                                      |
| Notifications          | Email (Resend/SMTP), SMS/WhatsApp (provider TBD)                                                                     | Tracking + status comms.                                                                                  |
| Infra                  | Docker Compose on VPS: `api`, `worker`, `web`, `caddy` (TLS). Supabase external.                                     | Same compose for dev and prod. GitHub Actions → build images → deploy.                                    |
| Observability          | pino structured logs, OpenTelemetry traces, health endpoints, Sentry                                                 | Enterprise-grade means we can see what happened.                                                          |

Repo layout:

```
apps/
  api/        NestJS engine: HTTP API (dist/main.js) and worker entrypoint (dist/worker.js)
              running the outbox dispatcher and, later, scheduled jobs
  web/        Next.js: marketing + portal + admin
  driver/     Expo native app (Phase 2)
packages/
  db/         Drizzle schema, migrations, seed
  contracts/  Zod schemas: DTOs, domain events, enums (shared by all apps)
  config/     eslint/tsconfig/prettier presets
infra/
  docker/     Dockerfiles, compose.prod.yml, Caddyfile
.github/workflows/  CI (typecheck, tests, builds, images)
docs/         this file, ADRs, runbooks
_reference/   prior attempts (read-only context)
_archive/     original zips
```

---

## 3. Domain modules (bounded contexts in `apps/api/src/modules`)

### 3.1 Identity & Accounts

- `users` (mirror of Supabase user: id, email, profile), `organizations`, `accounts`
  (a billing account: belongs to an org or an individual; has **one wallet**, credit terms,
  billing details, VAT number), `memberships` (user ↔ account, role), `roles`:
  `customer_owner`, `customer_staff`, `driver`, `dispatcher`, `finance`, `super_admin`.
- Account switcher: a user's JWT identifies them; the active account is a header/claim
  validated against memberships on every request.

### 3.2 Catalog & Pricing

- `zones` (polygons or suburb/postcode lists), `package_types` (dimensions/weight classes),
  `service_levels` (same-day, next-day, express… with cut-offs and promised windows),
  `rate_cards` and `rate_rules` (zone→zone table, per-km with base, surcharges, minimums,
  account-specific overrides), effective-dated.
- `quote(request) → Quote` is a **pure function** over the rules; quotes are persisted with the
  rule snapshot that produced them so a charged booking can always explain its price.

### 3.3 Scheduling

- `slot_policies` (operating days, windows, default capacity, cut-off minutes),
  `delivery_slots` (date × window; capacity, booked_count, status), `blackout_dates`.
- Capacity can be **derived from rostered drivers** (sum of per-driver stop capacity) or set
  manually. Slot rows are locked in the booking transaction; two clients cannot both take the
  last space.

### 3.4 Bookings & Shipments

- `bookings` (quote → gates → confirmed/rejected with reason), `shipments` (waybill, collection
  & delivery addresses, parcels, recipient, service level, slot), `shipment_events`
  (immutable status history), `proof_of_delivery` (photo, signature, name, geo, time).
- Waybill format: `DC-YYMMDD-XXXXX`, unique, printable label + public tracking page.
- Lifecycle: `booked → assigned → collected → in_transit → delivered | failed | cancelled`.

### 3.5 Dispatch

- `drivers` (linked to a user, vehicle, fuel card ref, status), `vehicles`, `shifts`
  (start/end with odometer + fuel readings), `assignments` (shipment ↔ driver, sequence,
  planned km), `driver_locations` (latest + history, sampled).
- **Auto-assign** on booking confirmation: candidates = drivers rostered for the
  slot with remaining capacity; score = proximity to collection + current load + zone
  familiarity; best wins; emits `ShipmentAssigned`. Dispatcher override re-emits
  `DriverReassigned`. Stop ordering: nearest-neighbour + time windows now; full optimizer later.
- Driver app API: today's stops, arrive/collect/deliver/fail with evidence, optional odometer reading,
  log fuel, location pings.

### 3.6 Wallet & Billing

- Per account: `wallets` (balance cached, **derived from** `wallet_entries` append-only,
  integer cents), `holds` (funds reserved at booking, converted to charge at settlement or
  released on cancel), `top_ups` (provider, reference, status; credited only on verified
  webhook), `credit_terms` (limit, statement day, due days) for postpaid accounts.
- Gate at booking: `available = balance + credit_limit − holds ≥ price`.
- `invoices` (per shipment or per statement), `statements` (monthly, postpaid), VAT at 15%
  captured per line, PDF generation.

### 3.7 Settlement & Ledger (double-entry)

- `journals` + `journal_lines` — every economic event posts a balanced journal
  (lines sum to zero) with an idempotency key. Accounts: `CUSTOMER_RECEIVABLE`,
  `CUSTOMER_PREPAID_LIABILITY`, `REVENUE`, `FUEL_EXPENSE`, `DRIVER_EARNINGS_EXPENSE`,
  `DRIVER_EARNINGS_PAYABLE`, `FUEL_CARD_PAYABLE`, `VAT_OUTPUT`, `CASH_*`.
- `DeliveryCompleted` (with **actual km**) → settlement journal: revenue, fuel cost
  (km × rate), driver earning (per-delivery rule), margin. Forecast at assignment
  (planned km) lives in `settlement_forecasts`, never touches the ledger; variance reported.
- Balances are always derived; periodic checkpoints bound query cost.

### 3.8 Treasury

- `allocation_wallets` (cost / operating_expense / reserve / capital), `expense_obligations`
  (vendor, monthly amount, due day, priority), `funding_targets`, `allocation_rules`,
  `allocation_transactions` (append-only, idempotent, reversible).
- On each settlement: contribution margin = revenue − fuel − driver earning; fund obligations by
  need × due-date urgency (water-fill), cascade surplus to reserves by priority, remainder to
  retained earnings. Sum of allocations equals margin exactly.
- **Proposals**: `money_movements` (kind: `fuel_card_load` via PayCentral, `driver_payout`,
  `obligation_payment`; amount, target, evidence, status `proposed → approved → executed |
rejected | failed`). The engine only ever creates proposals; a `finance` user approves; the
  executor (PayCentral adapter, or a manual "mark paid with bank ref") runs and reconciles.
- Dashboard: health score, obligations coverage, at-risk debit orders, reserves, forecast.

### 3.9 Loyalty

- Tiers by monthly volume, milestones by lifetime volume, cashback % credited to the wallet as a
  `loyalty_cashback` entry keyed to the settled shipment (idempotent).

### 3.10 Notifications & Tracking

- Templates + channels (email, SMS/WhatsApp), outbound via worker with retries.
- Public tracking page by waybill; status + ETA + POD once delivered.

### 3.11 Platform

- **Transactional outbox**: every state change and its domain event are written in one DB
  transaction; the worker publishes/handles with retries and dead-lettering.
- **Domain events** (Zod-typed, versioned): `TopUpConfirmed`, `BookingConfirmed`,
  `BookingRejected`, `ShipmentAssigned`, `DriverReassigned`, `ShiftStarted`, `ShiftEnded`,
  `CollectionCompleted`, `DeliveryCompleted`, `DeliveryFailed`, `ShipmentCancelled`,
  `FuelLogged`, `SettlementPosted`, `TreasuryAllocated`, `MovementProposed/Approved/Executed`.
- `audit_log` for every admin/finance action (who, what, before/after).
- Idempotency keys on every write endpoint that can be retried.

---

## 4. Invariants (never violated)

1. Money is **integer cents**; rates in cents/km; shares in basis points. No floats.
2. Ledgers are **append-only**. Corrections are reversing entries, never edits.
3. Every journal **balances to zero** before commit.
4. A booking is confirmed only inside **one transaction** that locks the wallet and the slot.
5. Wallets are credited **only** from a verified provider webhook, never from a redirect.
6. Every external effect goes through the **outbox**; every inbound webhook through an
   **inbox** with dedupe.
7. The engine **proposes** money movements; a human **executes**.
8. Settlement uses **actual** distance from the driver app; forecasts are separate.
9. Every write that can be retried carries an **idempotency key**.
10. Everything an admin does is in the **audit log**.

---

## 5. End-to-end: one booking

1. Customer (active account: "Honey Bee Bakers – Menlyn") opens New Booking in the portal.
2. Enters collection/delivery (address book or autocomplete), package type, service level,
   picks a slot (only bookable slots shown). Engine returns a quote with breakdown.
3. Confirm → `POST /bookings` (idempotency key). In one transaction: lock wallet + slot; check
   `available ≥ price` and `remaining > 0`; create hold; increment slot; create shipment +
   waybill; write `BookingConfirmed` to outbox. Else reject with reason (402 / 409).
4. Worker: `BookingConfirmed` → auto-assign → `ShipmentAssigned` (forecast settlement at planned
   km; fuel reserve estimate) → notify driver (push) and customer (email/WhatsApp).
5. Driver app: today's stops appear as dispatch assigns them, navigate, collect → deliver with POD.
   Actual km from odometer/GPS track.
6. `DeliveryCompleted` → settlement journal (revenue, fuel, earning, margin), hold → charge
   (wallet entry or receivable for postpaid), loyalty cashback, `SettlementPosted`.
7. Treasury: allocate margin to obligations/reserves; accrue driver earning payable and
   fuel-card payable; create **proposals** (fuel load via PayCentral per driver per day; payouts
   per cycle).
8. Finance approves proposals in the admin console → adapter executes → reconciliation marks
   them executed with the provider reference. Statement/invoice generated at period end.

---

## 6. Phased delivery

| Phase                        | Outcome (demoable)                                                                  | Contents                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 Foundation**             | Repo boots locally and on the VPS; you can log in.                                  | Monorepo, Docker Compose, CI, Supabase auth wiring, DB + migrations, outbox/worker skeleton, audit log, admin shell, marketing site scaffold.                                                                       |
| **1 Book & pay**             | A customer tops up, gets a quote, books into a slot, sees a waybill; admin sees it. | Accounts/orgs/switcher, wallet + top-up (manual EFT + one provider), rate cards + quote engine, slots, bookings/shipments, tracking page (basic).                                                                   |
| **2 Deliver & settle**       | A driver on the native app completes it; the ledger shows the money.                | Drivers/vehicles/shifts, auto-assign + dispatcher override, Expo driver app (stops, POD, fuel log, location), settlement journals, forecast vs actual.                                                              |
| **3 Treasury & billing** ✅  | Finance sees allocations and approves fuel loads/payouts; statements go out.        | Allocation engine, proposals + approvals, PayCentral adapter, driver payouts, invoices/statements/VAT, postpaid credit. _Remaining payment providers moved to Phase 4._                                             |
| **4 Portal apps & comms** ✅ | The portal feels complete.                                                          | Notifications (email over SMTP; SMS/WhatsApp recorded and held until a provider is chosen), address book + bulk CSV import, cashback, reports and CSV exports, Yoco. Every business setting moved into the console. |
| **5 Hardening** ✅           | Production-grade.                                                                   | Route ordering, reconciliation report, rate limiting and security headers, verified backup/restore scripts, runbook, app-store release steps.                                                                       |

Each phase ends with: tests green, a short demo, and a sign-off before the next.

### Phase 6 — the integration seam (proposed, not yet signed off)

Added 2026-10-01, after the Delicate Courier API's migration analysis. Phases 0–5 built the
engine for customers who book through the portal. Phase 6 makes it bookable **by another
system** on a merchant's behalf, which is what moving Delicate off ShipLogic needs.

| Item                                                                                                          | State                                        |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Service credentials, scopes, account grants ([ADR 0004](adr/0004-service-credentials-for-machine-callers.md)) | Built                                        |
| `account_external_refs` — the caller keeps its own identifiers                                                | Built                                        |
| One-call booking with retry-safe quote semantics (`quote_used` / `quote_expired`)                             | Built                                        |
| Lookup by the caller's own reference, exact match                                                             | Built                                        |
| Date-conditional surcharges, framework in place and switched off                                              | Built                                        |
| Merchant wallets or agreed credit terms                                                                       | **Commercial, not built — gates everything** |
| Whether engine pricing must reproduce the ShipLogic rate card                                                 | **Decision outstanding**                     |

The last two are not engineering work and no amount of code removes them. Every booking still
passes the wallet gate, so a merchant cannot be migrated until its account is funded or on
credit terms.

### Phase 7 — the Command Center ✅

Added 2026-10-03 from Ashley's operations brief; delivered the same day. Phases 0-6 built an engine that prices, gates,
books, delivers and accounts for a job; it has drivers, shifts, assignment and a driver app, but
no single place a dispatcher stands all day. Phase 7 builds the operational cockpit: a **trip**
as the unit of dispatch, a dispatch board, arrival and at-risk events, and the old route
planner's constraint logic rebuilt as pure functions against this domain model.

Full design: [COMMAND-CENTER.md](COMMAND-CENTER.md). The shape of it:

| Item                                                                                                                                            | State                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `trips` + `trip_stops` — a persisted, owned sequence instead of one recomputed per request                                                      | Built (7a)                                                  |
| Dispatch board: lanes, exceptions carried on the card, driver rail, recommendations with a reason                                               | Built (7b)                                                  |
| Ported operational logic (service time, collection grouping, day sequencing, allocation scoring, vehicle constraints), plus a whole-day planner | Built (7c)                                                  |
| Live map, ETA projected from where the van is, route deviation, dispatcher advisories                                                           | Built (7e)                                                  |
| Timed windows sold to the customer: per-hour capacity gate, window surcharge, one ascending lock pass, `shipment.at_risk`, arrival events       | Built (7d), priced at zero until the business sets it       |
| Vehicle/account constraints as config rather than hard-coded ids                                                                                | Built; **the current fleet's values still need confirming** |
| Driver-to-driver handoffs                                                                                                                       | Dropped — rare, handled as dispatcher reassignment          |

Building starts at 7a (trips). Collection stays on the booking and the shipment stays the unit
of delivery and of money; the trip is added beside them, so nothing in this phase reaches into
the ledger. No Phase 7 event moves money: invariant 7 holds unchanged. Timed windows (7d) are
the one part that touches pricing and the booking transaction, and the exception lane has
nothing to measure against until they land.

---

## 7. Open items to confirm

- **PayCentral**: do we have API documentation / sandbox credentials? Until then a fuel load is
  proposed and instructed, and a person does it in the PayCentral portal — which the "engine
  proposes, human executes" invariant requires anyway, so this blocks nothing.
- **Company tax identity**: legal name, CIPC registration number, SARS VAT number and banking
  details for `company.tax_profile`. The seed carries placeholders and issues a plain "INVOICE"
  until a VAT number is set, so no document ever claims VAT we are not registered for.
- **Real monthly bills**: the treasury wallets are seeded with placeholder amounts and debit-order
  dates. Every allocation decision follows from these numbers, so they matter more than the
  rate card.
- **Supabase**: existing project to reuse, or create a fresh one for this build?
- **VPS**: OS/size, domain names (site, portal, api), who holds DNS.
- **Google Maps** API key (Places + Routes) — needed from Phase 1 for quotes.
- **VAT**: company VAT-registered? (Drives `company.vat_registered`, the invoice layout and the
  `VAT_OUTPUT` account.)
- **WhatsApp/SMS** provider preference (Twilio, Clickatell, WhatsApp Cloud API).
- **Service levels & zones** for the initial rate card (I can seed from the copy deck / old
  quote stepper, but you should confirm the numbers).
- **Fuel rate** (cents/km) and **driver earning rule** initial values.
- **Public holiday calendar**: the rate card can now carry a public-holiday surcharge and the
  quote engine will apply it, but nothing decides which dates qualify. Needs the list (and who
  maintains it each year) before that lever can be used. Weekends need no list and already work.

---

## 8. What is still open

Everything below needs a decision or a credential from the business; none of it blocks the
engine, and each one is visible in the console under **Settings → What is switched on**.

| Thing                   | Why it is not done                                                                                                                      | Where it goes                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| SMS / WhatsApp provider | Twilio, Clickatell and the WhatsApp Cloud API are all still on the table. Messages are recorded and held meanwhile, so nothing is lost. | One `send()` in `sms.transport.ts`    |
| BobPay                  | Money coming in is where a guessed API is silently dangerous. Needs the merchant documentation and a sandbox payment.                   | One `verifyNotification()`            |
| PayCentral fuel cards   | Deliberately manual: the engine proposes a load and a human executes it. An API would still need approval first.                        | Optional                              |
| Google Maps key         | Without it, quotes price on straight-line distance with a road factor rather than real roads.                                           | `GOOGLE_MAPS_API_KEY`                 |
| Supabase project        | Development tokens are not safe for real users.                                                                                         | `SUPABASE_URL`, `SUPABASE_JWT_SECRET` |
| Company tax identity    | The VAT number decides whether documents are tax invoices.                                                                              | Console → Settings                    |
| Real monthly bills      | The seeded amounts are placeholders, and every allocation decision follows from them.                                                   | Console → Treasury                    |
| Real rate card          | Seeded from the reference quote formula.                                                                                                | Console → Pricing                     |
