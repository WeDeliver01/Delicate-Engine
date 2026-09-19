---
name: Operational constraints lockstep
description: The fleet's hard routing constraints live in two places that must stay in sync.
---

# Operational constraints must stay in lockstep across optimizer + suggestion endpoint

The hard fleet constraints are duplicated and MUST be kept consistent in both:
- `client/src/lib/routing.ts` — `evalVehicleConstraints` (vehicle rules) and `evalAssignment` (Saturday caps), the simulated-annealing optimizer.
- `server/routes.ts` — `GET /api/dispatch/reassignment-suggestions` (the live auto-suggestion pre-filter).

The constraints:
- 3-tier cakes must NOT go on the Vitz (VEHICLE_VITZ_IDS).
- SWE001-account parcels must go on an i10 (VEHICLE_I10_IDS).
- Vitz capacity: `VITZ_RULES.maxParcels` (6) total `pcs`, `maxPlatterConsignments` (3) platter `pcs`. Values in `client/src/lib/fleet.ts`.
- Saturday delivery caps are PER HALF-DAY, not aggregate: `SAT_MORNING_CAP` (12) before 12:00 (720 min), `SAT_AFTERNOON_CAP` (8) after. Classification is by each delivery's *arrival time*, simulated leg-by-leg.

**Why:** A reassignment suggestion that violates an optimizer constraint would push work onto a driver the optimizer would never have chosen, undoing the optimization. The server endpoint can't import the client fleet module cleanly, so the rules are hardcoded with comments — if you change a cap or rule in one place, change it in the other.

**How to apply:** When editing any vehicle rule, parcel cap, or Saturday cap, grep for the constant name across both `routing.ts`/`fleet.ts` and `server/routes.ts` and update both. The server suggestion sim uses an approximate fixed dwell (`SIM_DWELL_MIN`) for Saturday period bucketing because the server lacks `svcTime`; this can drift slightly near the noon cutover and is acceptable for an advisory pre-filter.
