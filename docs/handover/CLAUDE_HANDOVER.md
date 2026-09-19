# CLAUDE_HANDOVER.md

## Delicate Courier: Event-Driven Financial Operating System

This is the design and build handover for moving Delicate Courier from two
loosely-coupled systems to one event-driven financial operating system. Every
financial transaction originates from an operational event produced by the
Route Optimizer. The Financial Engine never invents money.

It is grounded in the code as it exists today, not a greenfield fantasy. Where
the existing code already does the right thing, the design keeps it. Phase 1 is
already built and ships in this handover (see section 11).

---

## 0. The two systems, and the one rule between them

The Route Optimizer owns operational truth: what happened, where, which driver,
how far, when. It already produces stop-completion events and already fires an
HMAC-signed CRM webhook the moment a delivery stop is completed
(`server/routes/driver.ts`, the `crmStatus === "delivered"` branch). That branch
is the seam we hook into.

The Financial Engine owns financial truth: what was earned, spent, reserved,
payable, profitable. It already has an append-only wallet ledger keyed by
`idempotencyKey`, a `deliveries` settlement snapshot, pricing-rule precedence
(driver > bakery > zone > global), and a Tuesday vesting cycle.

The one rule: **operational events flow one way, into the engine, and become
money there.** The optimizer never computes earnings. The engine never computes
routes. This is already true; the work is making the handoff an explicit,
durable, replayable event instead of an implicit coupling.

---

## 1. Event bus architecture

We do not need Kafka to run a 3-driver fleet, and adding a broker now would buy
operational complexity we cannot yet justify. We need the _guarantees_ a broker
gives (durability, at-least-once delivery, idempotent consumption, replay), and
those come from the **transactional inbox/outbox pattern** on the Postgres we
already run.

```
  Route Optimizer                         Financial Engine
  ┌──────────────────┐   HTTP + HMAC      ┌────────────────────────────────┐
  │ stop completed   │ ─────────────────▶ │ POST /api/events               │
  │ emit Delivery... │                    │   verify signature             │
  │ (outbox-able)    │                    │   validate envelope (Zod)      │
  └──────────────────┘                    │   INSERT event_inbox           │
                                          │     unique(eventId)            │
                                          │     unique(dedupeKey)          │
                                          │   process inline (Phase 1)     │
                                          │     handleEvent -> settle      │
                                          │   mark processed | failed      │
                                          └────────────────────────────────┘
```

**Inbox (consumer side, built now).** Every inbound event is written to
`event_inbox` before anything else happens. Two unique constraints give two
independent dedupe layers:

- `event_id` is unique per _emission_. It stops literal at-least-once redelivery
  of the same HTTP call.
- `dedupe_key` is unique per _business fact_ (`delivery:WB12345`). It stops two
  different emissions that describe the same real-world delivery from settling
  twice.

The row is immutable history. `status` only moves forward
(`received -> processed | failed`), and `attempts` / `last_error` make every
event replayable and auditable. Nothing is deleted, per the ledger philosophy.

**Outbox (producer side, Phase 1.5).** Today the optimizer emits fire-and-forget
straight from the request. That is fine for launch, because the inbox is the
durability layer. The moment a dropped emit costs real money, we add an
`event_outbox` table on the optimizer: the stop action writes the event in the
same DB transaction as the stop status, and a small poller drains it to the
engine with retries. Same envelope, same endpoint, zero engine changes.

**When to introduce a real broker.** When any one of these is true: more than
one consumer needs the same event, ordered partitioned throughput matters, or we
cross a few thousand events per day. At that point `POST /api/events` becomes a
thin producer into the broker and the inbox becomes the consumer's offset store.
The envelope below is broker-ready, so this is a transport swap, not a redesign.

---

## 2. Event schemas

One envelope for every event. The payload is discriminated by `eventType`.
Money is integer cents, distance is kilometres (used only to derive cents),
time is UTC ISO-8601.

```ts
interface EventEnvelope<T extends string, P> {
  eventId: string; // uuid, unique per emission
  eventType: T;
  eventVersion: number; // start at 1; bump on breaking payload change
  source: "route-optimizer";
  dedupeKey: string; // business key, stable across retries
  occurredAt: string; // when it happened operationally (UTC ISO)
  payload: P;
}
```

The full set the engine will consume. Phase 1 processes `DeliveryCompleted`
only; every other type is durably stored and acknowledged so we never lose an
event we do not yet handle.

| Event                 | dedupeKey                          | Drives                            |
| --------------------- | ---------------------------------- | --------------------------------- |
| `ShipmentCreated`     | `shipment:{waybill}`               | reference data, future forecast   |
| `ShipmentAssigned`    | `assign:{waybill}:{driverId}`      | forecast settlement, fuel reserve |
| `DriverReassigned`    | `reassign:{waybill}:{seq}`         | release old reserve, re-forecast  |
| `CollectionCompleted` | `collect:{waybill}`                | leg confirmation, ETA truth       |
| `DeliveryCompleted`   | `delivery:{waybill}`               | **settlement (Phase 1)**          |
| `DeliveryCancelled`   | `cancel:{waybill}`                 | reversal journal, release reserve |
| `DriverStartedShift`  | `shift_start:{driverId}:{shiftId}` | fuel/odometer baseline            |
| `DriverEndedShift`    | `shift_end:{driverId}:{shiftId}`   | actual fuel reconciliation        |
| `FuelLogged`          | `fuel:{driverId}:{receiptId}`      | fuel spend, efficiency signals    |

Representative payloads (the rest follow the same shape):

```ts
// The only settlement trigger in Phase 1.
interface DeliveryCompletedPayload {
  driverId: string; // Financial Engine UUID (resolved on emit)
  bakeryId: string; // Financial Engine UUID
  waybill: string;
  priceCents: number; // bakery-facing price for this delivery
  distanceKm: number; // ACTUAL executed distance from the optimizer
  zone?: string | null;
  currency: string; // "ZAR"
  customer?: { lat: number; lng: number; address?: string | null };
}

interface ShipmentAssignedPayload {
  driverId: string;
  bakeryId: string;
  waybill: string;
  priceCents: number;
  plannedDistanceKm: number; // forecast input, not settlement
  zone?: string | null;
}

interface DeliveryCancelledPayload {
  waybill: string;
  reason: string;
}
```

The key decision: `DeliveryCompleted` carries the **actual** distance. The engine
settles against that number instead of recomputing a haversine route, which is
the entire reason for going event-driven. The optimizer already measured it.

---

## 3. Idempotent settlement workflow

Settlement is the act of turning one `DeliveryCompleted` into immutable money.
It must be safe to run any number of times.

```
DeliveryCompleted
   │
   ├─ event_inbox INSERT (unique eventId, unique dedupeKey)
   │     └─ conflict ? -> 202 {duplicate:true}, stop.
   │
   ├─ settleDelivery(dedupeKey)
   │     ├─ deliveries row already settled ? -> return it, no writes
   │     ├─ INSERT deliveries (unique idempotencyKey = dedupeKey)
   │     │     └─ lost the race ? re-read; if settled, stop
   │     ├─ resolve pricing rule (driver>bakery>zone>global)
   │     ├─ compute settlement (integer cents)
   │     ├─ UPDATE deliveries -> settled (+ snapshot)
   │     ├─ wallet.post fuel    leg  idempotencyKey = fuel:{deliveryId}
   │     └─ wallet.post earning leg  idempotencyKey = earning:{deliveryId}
   │
   └─ event_inbox UPDATE status=processed
```

Three idempotency keys defend the money path, each on a unique constraint with
`ON CONFLICT DO NOTHING`:

1. `event_inbox.dedupe_key` (`delivery:{waybill}`): one settlement per delivery.
2. `deliveries.idempotency_key` (= dedupe_key): one delivery row.
3. `wallet_transactions.idempotency_key` (`fuel:{id}`, `earning:{id}`): one leg each.

Re-sending the same event ten times yields exactly one delivery row, one fuel
leg, one earnings leg, one set of revenue. This is exactly what the Phase 1
integration test asserts (`settleDelivery.test.ts`).

State machine for an inbox row: `received -> processed` on success;
`received -> failed` (with `last_error`) on handler error, leaving the event
captured for replay; an unhandled type stays `received`. Settlement and
forecasts are separate: a forecast can change, a settlement cannot. To correct a
settled delivery we post a reversing journal and a correction event. We never
overwrite history.

---

## 4. Double-entry accounting ledger

Today's `wallet_transactions` is the driver side of the books only: it records
what we owe the driver (earnings) and the fuel credit we grant. The company side
lives implicitly in the `deliveries` snapshot. To answer profitability questions
rigorously and to be audit-defensible for real money movement, every economic
event must post a **balanced journal** where the lines sum to zero.

### 4.1 Accounts

An account is identified by `(accountType, ownerType, ownerId)`. The five
ledgers the brief asks for map to account types:

| Account type              | Normal side | Owner   | Maps to brief           |
| ------------------------- | ----------- | ------- | ----------------------- |
| `DRIVER_EARNINGS_PAYABLE` | credit      | driver  | Driver earnings ledger  |
| `DRIVER_FUEL_PAYABLE`     | credit      | driver  | Driver fuel ledger      |
| `COMPANY_REVENUE`         | credit      | company | Company revenue ledger  |
| `COMPANY_EXPENSE`         | debit       | company | Company expense ledger  |
| `BAKERY_RECEIVABLE`       | debit       | bakery  | (settlement / clearing) |

`SETTLEMENT` is not a sixth pile of money; it is the requirement that every
settlement is one balanced journal across these accounts.

### 4.2 The settlement journal

For one delivery with price `P`, fuel cost `F`, driver pay `D`, margin
`M = P - F - D`:

```
Journal: settle delivery {id}
  Dr  BAKERY_RECEIVABLE        P     (we will collect P from the bakery)
  Cr  COMPANY_REVENUE          P
  Dr  COMPANY_EXPENSE          F     (fuel cost recognised)
  Cr  DRIVER_FUEL_PAYABLE      F     (fuel credit granted to driver)
  Dr  COMPANY_EXPENSE          D     (driver pay recognised)
  Cr  DRIVER_EARNINGS_PAYABLE  D     (owed to driver, vesting gate on this line)
                              ────
  debits = credits  ⇒  P + F + D  on each side, journal balances to zero
```

P&L falls out as Revenue P minus Expense (F + D) = M. The driver wallet the app
shows today is exactly the running balance of that driver's
`DRIVER_EARNINGS_PAYABLE` and `DRIVER_FUEL_PAYABLE` accounts, with availability
governed by the `availableFrom` (Tuesday vesting) timestamp on the earnings
line. Nothing about the driver experience changes; the company side simply stops
being implicit.

### 4.3 Schema

```ts
// journals: one row per economic event. Balanced or it does not commit.
export const journals = pgTable("journals", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // settlement | reversal | fuel_reserve | payout | adjustment
  refType: text("ref_type"), // delivery | payout | reservation
  refId: text("ref_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ledger_lines: the journal legs. Sum of amountCents per journalId must be 0.
export const ledgerLines = pgTable("ledger_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalId: uuid("journal_id")
    .notNull()
    .references(() => journals.id),
  accountType: text("account_type").notNull(),
  ownerType: text("owner_type").notNull(), // driver | bakery | company
  ownerId: uuid("owner_id"), // null for company-wide accounts
  amountCents: integer("amount_cents").notNull(), // debit > 0, credit < 0
  currency: text("currency").notNull().default("ZAR"),
  availableFrom: timestamp("available_from", { withTimezone: true }), // vesting gate
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

The sum-to-zero invariant is enforced inside the settlement transaction before
commit (assert `SUM(amountCents) = 0` for the journal). Balances are always
derived, never stored: `SELECT SUM(amount_cents) WHERE accountType=? AND
ownerId=?`. `wallet_checkpoints` already exists and becomes the periodic
snapshot that bounds how many lines a balance query has to sum.

### 4.4 Migration path (no big-bang)

`wallet_transactions` stays the write path through Phase 1. In Phase 2,
`settleDelivery` writes the balanced journal instead, and the existing driver
wallet queries read from `ledger_lines` filtered to that driver's payable
accounts. `wallet_transactions` is kept as a backfilled compatibility view until
every reader is migrated, then frozen. Historic rows are backfilled into
`ledger_lines` by replaying settled deliveries through the new journal template,
which is safe because the settlement snapshot is already on every delivery row.

---

## 5. Projected versus actual

Forecasts help decisions. Settlements move money. They live apart.

- **Forecast at assignment.** On `ShipmentAssigned`, run the same pricing math
  against `plannedDistanceKm` and write to `settlement_forecasts`
  (deliveryRef, predicted revenue/fuel/driverPay/margin). Forecasts are mutable
  and never touch the ledger.
- **Settle at completion.** On `DeliveryCompleted`, run the math against actual
  `distanceKm` and post the immutable journal (section 4).
- **Variance.** `actual - forecast` per dimension, surfaced per shipment, driver,
  bakery, and zone. Distance variance is the leading indicator: planned vs
  executed km is where margin leaks, and it is the number the optimizer is
  uniquely able to give us.

```ts
interface SettlementForecast {
  waybill: string;
  driverId: string;
  bakeryId: string;
  predictedRevenueCents: number;
  predictedFuelCents: number;
  predictedDriverPayCents: number;
  predictedMarginCents: number;
  plannedDistanceKm: number;
  createdAt: string;
}
interface SettlementVariance {
  waybill: string;
  revenueDeltaCents: number;
  fuelDeltaCents: number;
  driverPayDeltaCents: number;
  marginDeltaCents: number;
  distanceDeltaKm: number;
}
```

---

## 6. Shipment profitability engine

This already exists as the settlement snapshot on `deliveries`
(`companyRevenueCents`, `fuelCents`, `driverPayoutCents`, `cogsCents`,
`marginBps`). The engine formalises it as a typed read model:

```ts
interface ShipmentProfit {
  deliveryId: string;
  waybill: string;
  revenueCents: number; // price
  fuelCostCents: number;
  driverPayCents: number;
  grossProfitCents: number; // revenue - fuel - driverPay
  grossMarginBps: number; // grossProfit / revenue * 10000
}
```

No new computation, just a stable contract over the snapshot. Margin in basis
points, never a float.

---

## 7. Driver-bakery profitability engine

A rollup keyed on the `(driverId, bakeryId)` pair, refreshed on every settlement
journal (event-sourced, so it is always reconstructable from the ledger):

```ts
interface DriverBakeryProfit {
  driverId: string;
  bakeryId: string;
  deliveries: number;
  revenueCents: number;
  fuelCostCents: number;
  driverPayCents: number;
  grossProfitCents: number;
  grossMarginBps: number;
  profitPerDeliveryCents: number;
  profitPerKmCents: number;
  marginTrendBps: number[]; // trailing N weeks, for direction
  lastSettledAt: string;
}
```

**Recommended assignments.** Rank candidate pairs by gross profit per km and per
delivery, penalised by depot-to-pickup proximity and capped by the optimizer's
existing capacity rules (Saturday caps, vehicle limits). The engine recommends;
a human approves; the optimizer executes the assignment, which emits
`ShipmentAssigned`, which closes the loop. AI never moves money or auto-assigns.
This is the Phase 4 surface; the rollup that feeds it is Phase 3.

---

## 8. Fuel reserve accounting

Fuel is the largest controllable cost, so it is treated as a tracked asset with
a reserve lifecycle rather than a number that appears at settlement.

```
ShipmentAssigned  -> RESERVE   estimated fuel = plannedKm * fuelRate
DeliveryCompleted -> CONSUME   actual fuel    = actualKm  * fuelRate
                  -> RELEASE   reserved - consumed (back to available)
DeliveryCancelled -> RELEASE   full reservation
```

Modelled as a `fuel_reservations` table plus balanced internal journals that
move cents between three fuel sub-accounts on the driver fuel ledger:
`FUEL_AVAILABLE`, `FUEL_RESERVED`, `FUEL_SPENT`.

```ts
export const fuelReservations = pgTable("fuel_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull(),
  waybill: text("waybill").notNull(),
  reservedCents: integer("reserved_cents").notNull(),
  consumedCents: integer("consumed_cents").notNull().default(0),
  releasedCents: integer("released_cents").notNull().default(0),
  status: text("status").notNull().default("reserved"), // reserved|consumed|released
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Reserve, consume, and release are each idempotent on their own key, so a replayed
assignment or completion never double-reserves or double-releases. The reserved
total per driver is a balance derived from open reservations, which gives the
projected-vs-actual fuel number the brief asks for, per driver, bakery, route,
and vehicle.

---

## 9. Service boundaries and endpoints

```
api-server/src/
  events/
    schemas.ts          // envelope + payload Zod schemas        [built]
    settleDelivery.ts   // the settlement workflow               [built]
    handlers.ts         // eventType -> handler dispatch          [built]
  services/
    walletService.ts    // append-only ledger (today)            [exists]
    ledgerService.ts    // balanced journals (Phase 2)           [next]
    pricingService.ts   // rule resolution + settlement math     [exists]
    forecastService.ts  // forecast at assignment (Phase 2)      [next]
    fuelReserveService.ts // reserve/consume/release (Phase 2)   [next]
    profitabilityService.ts // rollups (Phase 3)                 [later]
    assignmentService.ts    // recommendations (Phase 4)         [later]
  routes/
    events.ts           // POST /api/events                      [built]
```

Service rules: the event layer is the only thing that turns events into ledger
writes. The ledger service is the only thing that writes balanced journals.
Pricing is pure (no I/O beyond reading rules). The Route Optimizer keeps every
operational responsibility and gains exactly one new one: emitting events.

API surface (admin auth unless noted):

| Method | Path                                     | Purpose                           | Phase     |
| ------ | ---------------------------------------- | --------------------------------- | --------- |
| POST   | `/api/events`                            | ingest (HMAC-signed, internal)    | 1 (built) |
| POST   | `/api/events/:id/replay`                 | re-run a stored inbox event       | 2         |
| GET    | `/api/admin/forecasts?waybill=`          | forecast vs actual                | 2         |
| GET    | `/api/admin/ledger?ownerType=&ownerId=`  | journal lines + derived balance   | 2         |
| GET    | `/api/admin/profitability/shipments`     | per-shipment profit               | 3         |
| GET    | `/api/admin/profitability/driver-bakery` | pair rollups + trends             | 3         |
| GET    | `/api/admin/fuel/reservations`           | open reserves, consumed, released | 2         |
| GET    | `/api/admin/assignments/recommendations` | ranked pairs (human approves)     | 4         |

---

## 10. Phased implementation plan

**Phase 1, event foundation (DONE, in this handover).** `event_inbox`,
`POST /api/events` with Zod validation and HMAC verification, `settleDelivery()`
reusing the current wallet ledger, the optimizer emit hook, one integration test
proving double-send yields one settlement. No redesign of payouts, vesting, or
pricing.

**Phase 2, settlement engine.** Add `journals` + `ledger_lines` and the double-
entry settlement template; move `settleDelivery` onto it; migrate wallet reads to
derived balances; backfill historic deliveries. Add `forecastService` on
`ShipmentAssigned` and `fuelReserveService` (reserve/consume/release). Add the
optimizer outbox for guaranteed emit. Handle `DeliveryCancelled` as a reversal.

**Phase 3, profitability analytics.** Event-sourced rollups for shipment and
driver-bakery profitability, margin trends, variance reporting. Admin dashboards
read the rollups. Everything reconstructable from the ledger.

**Phase 4, intelligent assignment.** `assignmentService` ranks driver-bakery
pairs by profit per km and per delivery within the optimizer's capacity and
proximity constraints, recommends, and a human approves. Recommendations flow
back as `ShipmentAssigned`, closing the learning loop.

---

## 11. Phase 1: what is in this handover and how to apply it

Financial Engine (new and changed):

```
lib/db/src/schema/events.ts                         event_inbox table
lib/db/src/schema/index.ts                          export events
lib/db/migrations/0001_event_inbox.sql              idempotent raw migration
artifacts/api-server/src/events/schemas.ts          Zod envelope + payloads
artifacts/api-server/src/events/settleDelivery.ts   idempotent settlement
artifacts/api-server/src/events/handlers.ts         dispatch
artifacts/api-server/src/routes/events.ts           POST /api/events
artifacts/api-server/src/routes/index.ts            mount /events
artifacts/api-server/src/app.ts                     capture rawBody for HMAC
artifacts/api-server/src/events/settleDelivery.test.ts  integration test
```

Route Optimizer (integration):

```
server/lib/financial-events.ts        emitDeliveryCompleted (HMAC-signed)
server/routes/driver.patch.ts         the one-line emit at the delivered branch
```

Apply:

1. Copy the schema file in, then `pnpm --filter @workspace/db run push`
   (or apply `0001_event_inbox.sql`). This is the only schema change.
2. Copy the `events/` files, the updated `app.ts`, and `routes/index.ts`.
3. Set `EVENTS_WEBHOOK_SECRET` on the engine, and the same value plus
   `FINANCIAL_ENGINE_URL` on the optimizer. Restart the API server.
4. On the optimizer, add `server/lib/financial-events.ts`, apply the
   `driver.patch.ts` snippet, and seed the two app settings
   `financial_driver_map` and `financial_bakery_map`.
5. Run the test:
   ```
   pnpm --filter @workspace/api-server add -D tsx
   # package.json: "test": "tsx --test src/**/*.test.ts"
   pnpm --filter @workspace/api-server run test
   ```
   It asserts that the same `DeliveryCompleted` processed twice produces exactly
   one settled delivery, one earnings leg, and one fuel leg.

---

## 12. Open seams, called out so they are not silent

1. **Identity mapping.** The engine only ever sees its own UUIDs. The optimizer
   translates `driverAccountId` and client name to engine `driverId` / `bakeryId`
   via the two app-settings maps in `financial-events.ts`. An unmapped pair skips
   the emit and logs, rather than guessing. The clean Phase 2 version is a small
   mapping table managed in the admin UI.
2. **Actual distance source.** The emit prefers the optimizer's executed km for
   the waybill. Confirm the field name on the shipment object (`actualKm` /
   `plannedKm`) and wire the real one in the patch. If absent, the engine can fall
   back to computing a route, but that defeats the purpose, so getting actual km
   onto the event is the highest-value follow-up.
3. **Price source.** The patch reads `shipment.rate` (rand) and converts to
   cents. If a delivery should price off a zone rate instead, pass `zone` and let
   the engine resolve the rate it already stores.
4. **Inline vs queued processing.** Phase 1 processes inline and returns 202.
   That is correct for current volume. The outbox (1.5) and a worker drain (2)
   are the upgrade path, and the envelope is already shaped for it.
