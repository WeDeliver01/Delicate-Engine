---
name: Delivery-only routing for already-collected shipments
description: Why already-collected (out-for-delivery/in-transit) shipments must be routed with no collection leg, and where that lives.
---

# Already-collected shipments route delivery-only

A shipment whose status is in the "collected / in-transit / out-for-delivery"
family is physically on a driver's vehicle — only its delivery leg remains. It
must be scheduled as a **delivery-only** stop (no collection leg).

**Why:** `interleaveSequence` (client/src/lib/routing.ts) only ever moves a
shipment into the delivery queue (`pendingDel`) *after* its collection batch is
processed. So every shipment used to be forced through a collection leg. For an
already-collected shipment that meant either a spurious duplicate pickup, or —
when the collected-state ShipLogic CSV omits collection GPS — a collection
batch anchored at `(0,0)` that corrupts the whole route, so the shipment never
produced a usable next-stop ETA / driver assignment. This is the real reason
"Out for Delivery" CSV rows looked like they "weren't picked up" by the planner
(it was NOT a status/import filter, and NOT a public-holiday/day-of-week gate —
date filtering is exact-date-string match and Saturday caps are soft only).

**How to apply:** `shared/status.ts` `isShipmentCollected(status)` is the
predicate (picked-up-but-not-terminal). `interleaveSequence` takes a
`preCollected` param that seeds `pendingDel`. `buildSched` and the optimizer
cost estimator `evalAssignment` both split `myRegularShips` into needs-collection
vs already-collected and pass the latter as `preCollected`. `optimizeRoutes`
pre-assignment prefers `preDelDriver` for collected ships (driver who has the
parcel). Keep all four call sites in lockstep — if one models a collection leg
the optimizer score and the emitted schedule diverge.
