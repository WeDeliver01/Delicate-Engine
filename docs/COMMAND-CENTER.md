# Phase 7 — Command Center (Operations)

Status: **PROPOSED**, awaiting sign-off. Written 2026-10-03 from Ashley's operations brief.

Phases 0–6 built an engine that prices, gates, books, delivers and accounts for a job. It is
already event-driven and already has drivers, shifts, assignment and a driver app. What it does
not have is a **place a dispatcher stands all day**. That is what this phase builds.

The brief asked for the old route planner's operational logic rebuilt against this engine's
domain model rather than transplanted. This document says exactly which logic, where it lands,
and what it must not bring with it.

---

## 1. Read this first: most of the brief is already built

The brief proposed five phases. Three of them largely exist. Rebuilding them would be the most
expensive mistake available here, so this table is the starting point for the whole phase.

| Brief's item                      | State in the engine today                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Shipment queue                    | **Built.** `/v1/admin/shipment-search`, `/shipment-counts`, filter bar + table shared with the portal.                      |
| Driver management                 | **Built.** `drivers`, `vehicles` (+ CRUD at `/v1/admin/drivers`, `/vehicles`).                                              |
| Driver availability               | **Built.** `shifts` (scheduled · open · closed), one row per driver per date, odometer and fuel readings.                   |
| Assignment                        | **Built.** `AssignmentService`: auto-assign on `booking.confirmed`, dispatcher override, history kept, forecast written.    |
| Trip sheets                       | **Not built.** This is the real gap — see §3.                                                                               |
| Trip status                       | **Not built.** Follows from the trip not existing.                                                                          |
| Driver app synchronisation        | **Built.** `GET /v1/driver/day` assembles stops; collect / deliver / fail / fuel / location all post back.                  |
| Shipment status synchronisation   | **Built.** `shipment_events` is immutable history; every transition emits `shipment.status_changed`.                        |
| Phase 2 — routing                 | **Built, thin.** `optimiseRoute` (nearest-neighbour + 2-opt, precedence, time windows) is a pure function in `contracts`.   |
| Phase 3 — event-driven operations | **Built.** The transactional outbox _is_ the engine's backbone (ADR 0002); the brief's event list is mostly in the catalog. |
| Phase 4 — live operations         | **Partly.** `driver_positions` (latest) and `driver_location_history` (trail) exist and are already used to measure km.     |
| Phase 5 — intelligence            | Not built, and correctly last.                                                                                              |

The brief's event list maps onto the existing catalog almost one-for-one:

| Brief                                                                                  | Catalog entry                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------- |
| `DriverAssigned`                                                                       | `shipment.assigned`                      |
| `ShipmentCollected`                                                                    | `collection.completed`                   |
| `ShipmentOutForDelivery`                                                               | `shipment.status_changed` → `in_transit` |
| `ShipmentDelivered`                                                                    | `delivery.completed`                     |
| `ShipmentDeliveryFailed`                                                               | `delivery.failed`                        |
| `ShipmentCancelled`                                                                    | `booking.cancelled`                      |
| `DriverArrivedAtCollection`, `DriverArrivedAtDelivery`, `TripStarted`, `TripCompleted` | **missing — added in §6**                |

So the honest scope of this phase is narrower and sharper than the brief assumed: **a trip
object, a dispatch board, arrival events, and the old planner's constraint logic.** Everything
else is wiring work on top of parts that already carry production invariants.

---

## 2. The model decision: where the brief and the engine disagree

The brief says make the shipment the central operational object, and sketches a shipment
carrying both a `collection_window` and a `delivery_window`.

The engine today is shaped differently, and deliberately:

```
BOOKING  ── one quote, one hold, one COLLECTION point, one slot
   └── SHIPMENT (×N) ── one waybill, one recipient, one DELIVERY address, one POD
```

`bookings.collection` holds the pickup; a shipment is already _a drop_. `DispatchService.day()`
emits one collection stop per booking and one drop per shipment. `plannedKm` is
depot → collection → drop. Settlement divides the booking's subtotal across its live drops.

**Recommendation: keep it. Do not move collection onto the shipment.**

Three reasons, the third being the strongest:

1. It is the true shape of the work. A florist hands the driver nine parcels at one counter.
   One collection, nine drops. Copying the collection onto nine shipments creates nine ways for
   it to disagree with itself.
2. The old planner independently confirms it. Its `buildBatches()` spends its first act
   _re-deriving_ this grouping from flat CSV rows — merging pickups that share a suburb and sit
   within 15 minutes of each other. It is solving a problem the engine simply does not have.
3. A shipment is the unit the **money** is accountable to: one waybill, one POD, one settlement
   row, one journal. Changing what a shipment _is_ reaches into the ledger. Nothing in the
   operational brief is worth that.

What the brief is actually reaching for is a layer that does not exist yet — an object that owns
a driver's day. That object is the **trip**, and adding it costs nothing in the ledger.

```
BOOKING ──► SHIPMENT ──► ASSIGNMENT ──► TRIP_STOP ──► TRIP ──► DRIVER · VEHICLE · SHIFT
 (commercial)  (the drop,    (who owes    (sequence,    (the day)
               the money)     this drop)   ETA, arrival)
```

Shipment stays the unit of delivery and of money. Trip becomes the unit of **dispatch**.

---

## 3. Trips and trip sheets

Today a driver's day is _recomputed on every request_: `day()` reads active assignments, groups
them, and calls `optimiseRoute` fresh each time. That has one fatal property for a dispatcher —
**nothing is a decision**. There is no row recording that the dispatcher put the Menlyn drop
third, no ETA to compare an arrival against, nothing to print, nothing to reassign.

Two new tables, both in `packages/db/src/schema/operations.ts`:

**`trips`** — one driver, one date, one shift.
`id · driverId · shiftId · vehicleId · date · status(planned|released|started|completed|abandoned)
· plannedKm · plannedMinutes · startedAt · completedAt · sequenceSource(auto|dispatcher)
· routeSnapshot(jsonb) · timestamps`
Unique on `(driverId, date)` where status <> 'abandoned'.

**`trip_stops`** — the sequenced stop, and the row the whole board reads from.
`id · tripId · kind(collection|drop) · sequence · bookingId · shipmentId(null on collection)
· plannedArrivalMinute · plannedServiceMinutes · legKm · legMinutes
· arrivedAt · completedAt · status(pending|arrived|done|skipped)
· windowStartMinute · windowEndMinute · windowSource(slot|dispatcher|pinned) · groupKey · note`
Unique on `(tripId, sequence)`; unique on `(tripId, shipmentId)` where kind = 'drop'.

This is the point where the brief's trip sheet becomes real, because the sequence is now
**persisted and owned**, not re-derived:

```
Trip #DC-20261003-001   Refiloe · i10 Cargo 01 · 07:00–12:00 · 9 stops · 64.2 km

  1  ✓ 08:15  Collection   Honey Bee Bakers, Menlyn        3 parcels
  2  ✓ 08:47  Collection   Protea Florist, Lynnwood        2 parcels
  3  ✓ 09:42  Delivery     DC-261003-00412  Hatfield
  4  → 10:15  Collection   Lebo's Kitchen, Brooklyn        1 parcel     ETA 10:22 (+7)
  5  ○ 11:20  Delivery     DC-261003-00418  Centurion      window 11:00–13:00
```

`optimiseRoute` keeps its job: it **proposes** the sequence. Writing the proposal into
`trip_stops` is a separate, explicit act, and a dispatcher's hand-ordering overwrites it and sets
`sequenceSource = 'dispatcher'`. The driver app then reads the trip rather than recomputing, so
the order a driver sees is the order a dispatcher agreed to — which is also the fix for a bug
latent in `day()` today: the route can silently rearrange itself between two refreshes.

---

## 4. The dispatch board

One screen at `/admin/dispatch`, replacing nothing — `/admin/shipments` stays as the searchable
record. The board is about _today_.

Columns are the brief's lanes, read from `shipments.status` joined to trip state:
Unassigned · Assigned · En route to collection · Collected · In transit · Out for delivery ·
Delivered · Failed · Exception.

Two of those lanes are not statuses and must be derived, not stored:

- **En route to collection** — assigned, on a started trip, whose next pending stop is its
  collection. Derived from `trip_stops`, which is why the trip has to exist first.
- **Exception** — any shipment that is late against its window, has a failed drop, has an
  approved change request the driver has not yet seen (`shipmentChangeRequests`, already built),
  or sits unassigned inside its own cut-off. A computed lane, never a status column, because an
  exception stops being one the moment the cause is fixed.

A card carries what the brief listed — both addresses, both windows, customer, recipient,
parcels, service level, declared value, instructions, status, driver, ETA, priority. Every field
is already on `bookings`/`shipments` **except the two windows and priority** (see §7).

The right-hand rail is the brief's live operations panel, from `driver_positions` and trip
progress: driver, status, `4/8 completed`, and a drill-down into the trip sheet of §3.

Polling at 15s on `GET /v1/admin/dispatch/board`. Not websockets — a dispatcher refreshing a
board is not worth a new transport, and the engine has no socket layer to extend. Revisit when
live maps arrive in 7e.

---

## 5. What to port from the old planner, function by function

This is the part the brief cared most about: the real-world knowledge is in the constraints, not
the optimiser. All of it lands as **pure functions in `packages/contracts`**, beside
`optimiseRoute`, `quote` and the allocation engine — testable, deterministic, no DB, no UI.

| Old planner (`client/src/lib/routing.ts`)                 | Lands as                                           | Why it is worth having                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svcTime(type, pcs)` (geo.ts)                             | `serviceMinutes()`                                 | Service time scales with piece count and differs collection (5–15 min) from delivery (3–15). `optimiseRoute` currently takes it as a caller-supplied constant.                                                                                                                      |
| `buildBatches()`                                          | `groupCollections()`                               | Same-suburb pickups within 15 min become one stop. The engine gets this free _within_ a booking, but not _across_ bookings at one address — a real case for regular senders.                                                                                                        |
| `interleaveSequence()`                                    | `sequenceDay()`                                    | The genuinely hard logic: interleaving pickups and drops, refusing to idle >20 min at a collection while drops are pending, and the tiered deadline-urgency curve (<10, <20, <40, <60 min). `optimiseRoute` has none of this — it optimises distance and merely _reports_ lateness. |
| `evalAssignment()`                                        | `scoreAllocation()`                                | Multi-driver scoring: cost/km, quadratic lateness, overtime past shift end, load balance, idle-driver penalty. Today's `candidates()` scores one shipment at a time as `distance + load × 2`, which cannot see a whole day.                                                         |
| `evalVehicleConstraints()`, `VITZ_RULES`, `I10_RULES`     | `vehicleConstraints()` + **config, not constants** | No 3-tier cakes in a Vitz; platter and parcel caps; one account only on the i10. Exactly the knowledge worth keeping — and exactly the thing that must not be hard-coded again (§7).                                                                                                |
| `SAT_MORNING_CAP` / `SAT_AFTERNOON_CAP`                   | capacity policy                                    | 12 deliveries before noon on a Saturday, 8 after. This belongs in `slot_policies`, which already carries per-window capacity.                                                                                                                                                       |
| `applyDeliveryOverrides()` / `applyCollectionOverrides()` | `trip_stops.window*` + change requests             | Dispatcher window overrides with **pinned times**, preserving the original so the UI can show "was 14:00–17:00". The preserved-original discipline is the good idea here.                                                                                                           |
| `mergeWarnings()`, `stopsCanMerge()` (always `true`)      | `groupingAdvisories()`                             | The operational philosophy in one function: the dispatcher has authority, the system advises and never blocks. This is the brief's "the algorithm assists dispatch rather than becoming the dispatcher", already written down in code. Keep it verbatim in spirit.                  |
| `autoGenerateHandoffs()`, `suggestHandoffs()`             | **deferred — needs a decision (§7)**               | Driver-to-driver relay at a handoff point when a job crosses town and another driver's depot is ≥30% closer to the drop. The engine has no concept of a parcel changing hands, and custody is a POD question, not a routing one.                                                    |
| `generateInsights()`                                      | 7e, as dispatcher advisories                       | Road, fuel, punctuality, capacity categories. Useful, and the natural seam for the brief's Phase 5 AI layer — sitting on operational data, as the brief argued.                                                                                                                     |

### What must not come across

- **CSV as an interface.** The brief is right and this is non-negotiable. Nothing in the
  Command Center imports a shipment. `bulk CSV` in the portal creates _bookings_ through the
  normal path, which already gates them against wallet and slot.
- **Client-side computation of operational truth.** In the old planner the optimiser, the
  constraints and the trip sheet all run in the browser, with `localStorage` autosave. Every
  rule listed above runs server-side here. The board renders what the engine decided.
- **Hard-coded fleet and account identifiers.** `VEHICLE_VITZ_IDS`, `VEHICLE_I10_IDS`, and
  `acc === "SWE001"` are real rules written as constants. They become
  `vehicles.constraints` (jsonb) and an account-level `requiresVehicleClass`, editable in the
  console like every other business setting.
- **Replit anything**, and the `.replit` / Capacitor build path. Already a ground rule.
- **Its status vocabulary.** `shared/status.ts` has its own statuses and a
  `toDispatchStopStatus()` translation layer. The engine's `shipment_status` enum plus
  `SHIPMENT_TRANSITIONS` is the only lifecycle, and `trip_stops.status` is about _the stop_, not
  the parcel.

---

## 6. New events

Appended to `packages/contracts/src/events/catalog.ts` and the discriminated union. No existing
payload changes, per the ground rules.

| Event                   | Payload                                                          | Consumers                                             |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `trip.planned`          | tripId, driverId, date, stopCount, plannedKm                     | board, audit                                          |
| `trip.released`         | tripId, driverId, date                                           | driver push ("today's trip is ready")                 |
| `trip.started`          | tripId, driverId, shiftId, startedAt                             | board, live ops                                       |
| `trip.completed`        | tripId, driverId, stopsDone, stopsSkipped, actualKm              | board, driver productivity                            |
| `trip.stop_arrived`     | tripId, stopId, kind, bookingId, shipmentId, arrivedAt, location | ETA accuracy, recipient "driver is here" notification |
| `trip.stop_resequenced` | tripId, by, from[], to[]                                         | audit                                                 |
| `shipment.at_risk`      | shipmentId, waybill, reason, windowEndMinute, etaMinute          | board exception lane, dispatcher alert                |

`trip.stop_arrived` is the brief's `DriverArrivedAtCollection` / `DriverArrivedAtDelivery`, as
one event with a `kind`. Two events whose only difference is a field they both already carry is
two code paths to keep in step for no gain.

**No event in this phase touches money.** Settlement stays triggered by `delivery.completed`
with actual km, and the trip's existence does not change `SettlementService` at all. Invariant 7
holds unchanged: the Command Center proposes work, never a payment.

---

## 7. Decisions needed before building

Four of these are genuine forks. The first is the only one that blocks a start.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                    | Recommendation                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Per-shipment time windows.** The brief's board shows "requested collection 09:00–10:00, delivery 11:00–13:00". The engine has no such field: it has a _slot window_ (`morning`, `afternoon`) shared by the whole booking, and slot capacity, cut-offs and pricing all hang off it. The old planner had real per-shipment `cAfter/cBefore/dAfter/dBefore`. These are different businesses. | Keep the slot as the **commercial promise** (what the customer bought, what capacity is gated on) and add the narrow window as an **operational target** on `trip_stops`, defaulted from the slot and overridable by a dispatcher. Nothing in pricing or capacity moves. |
| 2   | **Vehicle and account constraints.** The real rules exist (no 3-tier cake in a Vitz; SWE001 only on the i10) but as constants against specific vehicle ids.                                                                                                                                                                                                                                 | `vehicles.constraints` jsonb + account `requiresVehicleClass`, seeded from the old constants, editable in the console. Needs the current list confirmed — vehicles change.                                                                                               |
| 3   | **Handoffs.** Does a parcel ever change hands between drivers today, in practice?                                                                                                                                                                                                                                                                                                           | If no: drop it entirely, do not carry the code. If yes: it needs custody events and its own POD step, and that is its own phase — not a routing feature.                                                                                                                 |
| 4   | **Who sequences.** Auto-sequence on release with dispatcher override, or dispatcher-first?                                                                                                                                                                                                                                                                                                  | Auto-propose, dispatcher confirms, `sequenceSource` records which. Matches the existing auto-assign posture and the old planner's own dispatcher-authority philosophy.                                                                                                   |

Also carried forward, unchanged, from `ARCHITECTURE.md` §7: the Google Maps key matters more
here than anywhere so far. Sequencing a day on straight-line distance with a road factor is
acceptable for _ordering_; quoting an ETA to a recipient on it is not.

---

## 8. Sub-phases

Each ends with tests green and a demo, as every other phase has.

| Sub-phase                   | Outcome                                                                                      | Contents                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **7a Trips**                | A dispatcher builds tomorrow's trips and prints a trip sheet; the driver app reads the trip. | `operations` module, `trips` + `trip_stops`, plan/release/resequence, `day()` reads the trip, trip events, trip sheet UI.                                 |
| **7b Dispatch board**       | One screen runs the day.                                                                     | `/v1/admin/dispatch/board`, the nine lanes, exception derivation, driver rail, drag-to-assign onto a trip, assignment recommendations with a reason.      |
| **7c Operational logic**    | Sequencing respects how the business actually works.                                         | `serviceMinutes`, `groupCollections`, `sequenceDay`, `scoreAllocation`, `vehicleConstraints`, `groupingAdvisories` — ported as pure functions with tests. |
| **7d Exceptions & windows** | Lateness is seen before the customer phones.                                                 | Window targets on stops, dispatcher overrides with pinned times and preserved originals, `shipment.at_risk`, arrival events, recipient "driver is here".  |
| **7e Live operations**      | The map.                                                                                     | Live positions on a map, ETA from the trail, route deviation, late-stop detection, dispatcher advisories from `generateInsights`.                         |

The brief's Phase 5 (AI allocation advice, at-risk triage) is a phase of its own after this, and
genuinely belongs last: it is only as good as `trip_stops` and the at-risk signal beneath it.

---

## 9. Where it lives

```
apps/api/src/modules/operations/        ← new bounded context
  operations.module.ts
  trip.service.ts            plan · release · resequence · start · complete
  trip-stop.service.ts       arrive · complete · skip · window override
  board.service.ts            the dispatch board read model
  recommendation.service.ts  which driver, and why (wraps scoreAllocation)
  operations.controller.ts   /v1/admin/dispatch/*
  handlers/                  booking.confirmed → draft trip placement
packages/contracts/src/
  operations.ts              pure: serviceMinutes, groupCollections, sequenceDay,
                             scoreAllocation, vehicleConstraints, groupingAdvisories
  dto/operations.ts          Trip, TripStop, Board DTOs
  events/catalog.ts          + the seven events in §6
packages/db/src/schema/
  operations.ts              trips, trip_stops
apps/web/app/(admin)/admin/dispatch/    ← the board
```

`operations` owns trips and stops. It reads shipments and drivers through `BookingService`,
`FleetService` and `AssignmentService`, never by reaching into their tables — the module rule in
CLAUDE.md. `AssignmentService` keeps owning who-owes-this-drop; `operations` owns where it sits
in a day. Dispatch keeps owning the driver's actions and settlement, untouched.
