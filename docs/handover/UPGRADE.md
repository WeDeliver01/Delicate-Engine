# Delicate Courier — Finance & Event Backbone Upgrade

This upgrade adds the event-driven financial backbone to the existing Django +
Next.js codebase. The booking portal now prices a job, gates it against a local
wallet balance, charges it, and pushes every money movement to the financial
engine and to ShipLogic. Everything is persisted locally first and reattempted
until it lands, so nothing is ever lost and anything can be reconciled.

Nothing in the existing `quotes` app was changed. All new code lives in a new
`backend.finance` app plus three lines of wiring (INSTALLED_APPS, root urls,
settings config block).

## The core pattern: transactional outbox

Every state change and the event announcing it are written in the **same**
database transaction (`OutboxMessage`). A dispatcher delivers those messages
later with retries. This is the guarantee you asked for: every event, booking,
transaction and top-up is saved in the database AND pushed automatically, and
because the row persists, any push can be reattempted or reconciled.

```
booking portal / webhook
        |
        v
  services.py  (atomic: mutate wallet + append ledger + write OutboxMessage)
        |
        v
  OutboxMessage (durable)  --->  dispatch_outbox  --->  financial engine (HMAC push)
                                                  \-->  ShipLogic (shipment + billing)
```

The financial engine stays the system of record for money. These tables are the
local durable record, the gating balance, and the outbox. They reconcile against
the engine, never the other way around.

## What was added (`backend/backend/finance/`)

- `models.py` — `Wallet` (gating balance, integer cents), `LedgerEntry`
  (append-only, signed cents, balance snapshot), `TopUp`, `Booking`,
  `OutboxMessage` (the durable queue), `ProviderEvent` (inbound webhook dedupe),
  `ShipLogicShipment`, `ShipLogicBillingTxn` (with a unique guard preventing a
  double-charge per booking).
- `services.py` — atomic domain ops: `confirm_topup`, `charge_booking` (holds the
  balance gate), `reverse_booking`. Each mutates the wallet, appends a ledger
  entry, and enqueues outbox events in one transaction.
- `outbox.py` — the dispatcher: claims due messages (row-locked, `skip_locked`
  where supported), routes by topic to handlers, soft-retries unconfigured
  integrations forever, backs off hard errors exponentially, dead-letters after
  `max_attempts`.
- `clients/engine.py`, `clients/shiplogic.py`, `clients/payments.py` — the three
  external boundaries.
- `signing.py` — HMAC-SHA256 sign/verify, shared by the engine push and inbound
  webhook verification (same scheme as the Delicate API Adapter).
- `money.py` — the single cents/rands conversion boundary. Money is integer cents
  everywhere in this app; rands only appear when talking to ShipLogic.
- `api.py` + `urls.py` — the HTTP surface the portal/frontend calls.
- `management/commands/dispatch_outbox.py`, `reconcile_finance.py`.
- `tests.py` — 12 tests covering money, the gate, append-only ledger,
  idempotency, soft-retry, and the full fund→book→dispatch chain. All pass.

## Money flow

1. **Top-up.** `POST /api/finance/topups {client_id, amount_cents}` returns a
   payment link. The wallet is credited only on the provider's server-to-server
   webhook (`POST /api/finance/webhooks/payment`), never on the redirect. The
   credit emits a `topup.confirmed` engine event and a ShipLogic `payment` so the
   client's statement stays honest.
2. **Booking.** `POST /api/finance/bookings {client_id, reference, price_cents | quote_id, ...}`.
   The gate checks the local wallet balance under a row lock. Funded → debit,
   `booking.charged` engine event, and a queued ShipLogic dispatch. Unfunded →
   `402` and a persisted `rejected_insufficient_funds` booking, no charge.
3. **Dispatch.** The shipment handler creates the R0 catch-all ShipLogic shipment,
   stores the waybill, then chains the `admin-debit` for the real price linked to
   that waybill, and tells the engine the shipment is live.
4. **Reversal.** `reverse_booking(reference)` credits the wallet back, emits
   `booking.reversed`, and posts a ShipLogic `admin-credit`. Idempotent.

## Configuration (Replit Secrets / environment)

Everything is optional. With nothing set, the system runs fully: engine and
ShipLogic messages queue and soft-retry forever until wired, and payments run in
`stub` mode. Set each when the integration is ready.

| Variable                                | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `ENGINE_INGEST_URL`                     | Financial engine event ingest endpoint         |
| `ENGINE_HMAC_SECRET`                    | Shared secret for signing engine pushes        |
| `SHIPLOGIC_TOKEN`                       | ShipLogic Admin API bearer token               |
| `SHIPLOGIC_PROVIDER_ID`                 | Your ShipLogic provider id                     |
| `SHIPLOGIC_CATCHALL_SERVICE_LEVEL_CODE` | The R0 catch-all service level (default `SPX`) |
| `PAYMENTS_PROVIDER`                     | `stub` (default) or `bobpay`                   |
| `PAYMENTS_API_URL` / `PAYMENTS_API_KEY` | Live payment provider credentials              |
| `PAYMENTS_WEBHOOK_SECRET`               | HMAC secret for verifying payment webhooks     |

Per-client identity: set `Wallet.shiplogic_account_id` (and later
`engine_account_ref`) for each client. Until a client's ShipLogic account id is
set, that client's dispatch messages soft-retry rather than fail.

## Running it

```bash
cd backend
python manage.py migrate
python manage.py dispatch_outbox --loop     # the worker that drains the outbox
python manage.py reconcile_finance           # health + ledger integrity report
python manage.py reconcile_finance --requeue # re-arm dead-lettered messages
python manage.py test backend.finance        # 12 tests
```

On Replit, run `dispatch_outbox --loop` as a background worker alongside the web
process.

## Sandbox validation gate (do before going live)

Three things are assumed but not yet verified against a live ShipLogic account.
Confirm them in sandbox before flipping `SHIPLOGIC_TOKEN` to production:

1. **Catch-all resolves.** `POST /rates` with a real out-of-zone address returns
   the catch-all service level. If it returns "no service levels available", the
   service level is not configured wide enough yet.
2. **It bills R0.** Create one shipment under the catch-all and confirm the
   statement line is genuinely R0, so the client is not double-billed alongside
   the `admin-debit`.
3. **VAT and direction.** Post one `admin-debit` and one `payment` against a test
   account, pull the statement PDF, confirm the VAT line resolves the way you
   need (ShipLogic does not recompute VAT on manual transactions) and that a
   debit increases what the client owes. Set the account credit limit high enough
   that ShipLogic never gates booking on its own balance.

## Note: latent bug found in existing code

`quotes/models.py` `Client.save()` re-passes `force_insert` to its second
internal save, so `Client.objects.create()` raises a duplicate-key error. Your
admin/forms call `instance.save()` so they never hit it, but any code using
`.create()` will. Worth fixing when convenient; left untouched here to keep this
upgrade additive.

---

# Booking Capacity & Slots (`backend.scheduling`)

A new app that governs how many bookings each delivery window can take, closes
slots automatically as they fill, lets the super admin close or reopen any slot
by hand, and lets clients watch availability fall in real time.

## Model

- `SlotPolicy` — the rules: which weekdays operate, the time windows, the default
  capacity per window, and the lead-time cutoff (minutes before a window starts
  after which it stops accepting bookings). One active policy at a time.
- `BlackoutDate` — a date with no deliveries; all its slots are unbookable.
- `DeliverySlot` — the concrete bookable instance for a date + window. Materialized
  lazily from the policy on first view or booking. Holds `capacity`, `booked_count`,
  and `status` (`open` / `closed_full` / `closed_manual`).

## How capacity is enforced

`finance.charge_booking` now takes an optional `slot_date` + `slot_window`. Inside
one transaction it locks the slot row and the wallet row, checks both gates
(capacity and balance), and only then consumes the space AND debits the wallet.
If either gate fails, neither happens: a booking that cannot get a slot is
recorded `rejected_slot_unavailable`, one that cannot pay is
`rejected_insufficient_funds`, and capacity is never silently consumed. The slot
auto-closes the moment `booked_count` reaches `capacity`. Reversing a booking
releases its space and reopens an auto-closed slot.

The lock means two clients racing for the last space cannot both win.

## Endpoints

Client-facing:

- `GET /api/slots/availability?date_from=&date_to=` — every operating window in the
  range with `capacity`, `booked`, `remaining`, `bookable`, and a `closed_reason`
  (`full` / `closed` / `blackout` / `cutoff_passed`). Defaults to today..+14 days.

Super admin (staff session required):

- `GET|PUT /api/admin/capacity/policy` — read or update windows, weekdays, default
  capacity, lead time.
- `GET /api/admin/capacity/slots?date_from=&date_to=` — ops view of every slot.
- `POST /api/admin/capacity/close` — `{date, window_key, closed}` manual close/reopen.
- `POST /api/admin/capacity/set` — `{date, window_key, capacity}` override one slot.
- `GET|POST|DELETE /api/admin/capacity/blackout` — manage blackout dates.

To place a booking against a slot: `POST /api/finance/bookings` with `slot_date`
and `slot_window` alongside the existing fields. A full or closed slot returns
`409 slot_unavailable`; an unfunded wallet still returns `402 insufficient_funds`.

## Commands

```bash
python manage.py generate_slots --days 21   # optional: pre-create the horizon
```

## Note on time zones

Slot window times are interpreted in `settings.TIME_ZONE` (currently UTC). Set
`TIME_ZONE = 'Africa/Johannesburg'` so cutoffs line up with local delivery times.

---

# Quote-to-Booking, Catalog & Universal Identity

The fast path that undercuts ShipLogic on steps: a quote prices on addresses and
parcels alone, and a happy quote converts to a booking in place. Contact details
are demanded only at the booking step, never at quote time.

## Catalog (`backend.catalog`)

Configurable, not hardcoded. `PackageType` (name + default L/W/H/weight, so picking
a type prefills dimensions) and `ParcelCategory` (name + perishable/fragile flags,
since Delicate carries perishables). Read by the booking form via `GET /api/catalog`.
Seed a starter set with `python manage.py seed_catalog`. Edit in the super admin.

## Book from quote

`POST /api/finance/book-from-quote` with `{client_id, quote_id, collection,
delivery, parcels, slot_date, slot_window, liability_cover, declared_value_cents,
customer_reference, custom_tracking_ref}`.

- Contacts required to finalise: collection and delivery `contact.name` and
  `contact.phone`. Missing any returns `422 missing_contact_details` with the list,
  and nothing is created. The quote itself never required these.
- Price = quote revenue + optional liability premium (`LIABILITY_RATE_PERCENT` of
  declared value, default 0).
- Runs the slot and wallet gates (`409 slot_unavailable`, `402 insufficient_funds`).
- On success: parcels become `Parcel` rows (with volumetric and charged weight
  derived, charged = max(actual, volumetric)), and every identifier is indexed.
- The response includes the rate breakdown (base + fuel levy) and charged weight,
  matching the rate display in the reference screenshots.

## Universal identity resolver

Every external id for a job is indexed in `BookingIdentifier` (unique on value),
and `Booking.resolve(value)` returns the one booking for ANY of them: our
reference, the waybill, a custom tracking ref, the customer reference, the
ShipLogic id, the route planner id, or a parcel's alternate tracking ref. This is
the join key for the synced network: when ShipLogic, the route planner, the CRM,
or the loyalty engine sends an event keyed by their own id, it resolves to the
same booking, so nothing slips through the cracks. The ShipLogic dispatch handler
now records the waybill and ShipLogic id as identifiers automatically.

## Branding

`DESIGN_TOKENS.md` captures the colours and fonts pulled from the existing
quote-generator frontend. The whole system uses these, so the booking portal and
both dashboards stay uniform with the main site.

---

# Adopted from the API platform + Unified Shipments (`backend.tracking`)

Read the .NET API platform and lent the parts that were already proven, rather
than reinventing them. Three things adopted, one new capability built.

## What was adopted (steal like an artist)

1. **ShipLogic payload shapes, with the bug-knowledge.** `finance/clients/shiplogic.py`
   now builds the exact platform shapes: address uses `street_address` / `local_area`
   / `code` / `zone`, and omits `lat`/`lng` entirely when unset (ShipLogic rejects a
   payload that carries null lat/lng). Parcels use `packaging` (shows as PACKAGE TYPE)
   and `parcel_description` (PARCEL CATEGORY) with `submitted_*_cm` / `submitted_weight_kg`.
   Contacts are siblings of the address on shipment creation. `customer_reference` and
   `custom_tracking_reference` are passed through.
2. **The ShipLogic tracking webhook shape.** This was the interface I was blocked on.
   The platform's handler keys on `shipment_id`, `short_tracking_reference`, and
   `custom_tracking_reference`, dedupes events on the event `id`, and acks unknown
   shipments with 200 so ShipLogic does not retry. Replicated exactly.
3. **The DAA signing scheme.** `finance/signing.py` now has `daa_sign` / `daa_verify`
   (base64 HMAC-SHA256 of the raw body, constant-time compare), matching the platform's
   `DaaSigUtil`, so the portal and the platform speak the same security language across
   the federation channel.

## Unified shipment view: one dashboard, every source

`backend.tracking.Shipment` is one read-model that both sources project into:

- **Portal bookings** project on creation and on dispatch (`project_booking`).
- **API / website shipments** from the platform arrive at `POST /api/sync/shipments`
  (DAA-signed; `X-DAA-Token` is the client's ShipLogic account id, mapped to our client
  via the wallet), handled by `ingest_api_shipment`.

Then one inflow updates them all, regardless of origin:

- `POST /api/webhooks/shiplogic/tracking` (shared-secret auth) resolves the shipment by
  any identity through `BookingIdentifier`, advances the normalised stage (created →
  collected → in transit → out for delivery → delivered), and appends deduped tracking
  events. This is the source of truth for status, as decided.
- `POST /api/sync/driver-position` (DAA-signed) attaches the live driver fix and ETA from
  the route planner to the out-for-delivery shipment.

The dashboard reads `GET /api/portal/shipments/<client_id>?stage=&date_from=&date_to=`,
which returns portal and API shipments together, filtered. Demonstrated end to end: a
WooCommerce shipment and a portal booking show in one client list, and a ShipLogic webhook
moves the portal one to out for delivery.

## Still needed to close the loop

- The platform's **push side**: it adds a signed `POST` to `/api/sync/shipments` when it
  creates or updates a shipment (the additive, non-blocking push pattern its DAA channel
  already uses), or we add a pull-sweep here. Either way the contract above is fixed.
- The **route planner** live feed posts to `/api/sync/driver-position` (contract defined),
  with a poll fallback to be added once its read API is known.

---

# Portal Identity, federated on Supabase (`backend.accounts`)

Client auth is net-new and now runs on Supabase Auth, the same identity provider
the API platform uses, so a bakery signs in once across the whole estate and the
two systems agree on who someone is. This is federation, not a merge: the portal
stays the client front door and system of record for bookings, capacity, wallet,
and loyalty; the platform stays the website and API integration engine; they
share one identity provider and the sync contract.

- `PortalUser` maps a Supabase user (`sub`) to OUR client (the bakery) and a role
  (`client_admin` or `super_admin`), the same shape as the platform's `User` row
  mapping a Supabase user to a tenant + app_role.
- `accounts/auth.py` validates the HS256 access token with `SUPABASE_JWT_SECRET`,
  checks audience and issuer, reads `sub` / `email` / `app_role` / `client_id`, and
  lazily provisions the `PortalUser`. Role comes from the same `app_role` claim the
  platform's custom access token hook stamps.
- `@require_portal` and `@require_super_admin` gate endpoints. `GET /api/portal/me`
  returns the caller's identity; `GET /api/portal/my-shipments` returns only the
  caller's bakery's shipments. The capacity admin endpoints now accept a Supabase
  super-admin (with a Django-staff session as fallback).

Config (set per environment): `SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`
(issuer), `SUPABASE_AUD` (default `authenticated`). Until the secret is set, the
JWT path is inert and the staff-session fallback still protects admin routes.

---

# Real rates (`finance/rates_api.py`)

The rate is no longer a magic number. `POST /api/quote/rate` with `{distance_km,
client_id?|rate_card_id?}` computes the price through the quote generator's exact
`compute_price` (cogs = km × cost/km, base = cogs ÷ (1 − margin), fuel = base ×
fuel%, floored at the minimum) and returns base, fuel levy, and total in cents.
The card is resolved per client via their active quote link, falling back to the
default. `GET/PUT /api/admin/rate-cards` (super-admin only) lists and edits the
per-client cards, so changing a client's cost/km moves their live quotes. The
preview mirrors this formula exactly, and its Rate cards screen edits the same
levers.
