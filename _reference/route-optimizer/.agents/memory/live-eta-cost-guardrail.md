---
name: Live-ETA first-leg cost guardrail
description: How the dispatcher/driver/pusher share ONE Google Routes call per driver per active stop, and why the cache key must not include live coords.
---

# First-leg Google cost guardrail

The active first leg (driver → next pending stop) is the ONLY traffic-aware Google
Routes call in the live-ETA system. Everything downstream uses offline `calcDrive`
(haversine + bucket speed blended with the driver's observed GPS speed).

`firstLegEta` / `peekFirstLegCache` in `server/routes/driver.ts` cache results in
`firstLegCache` with a 45s TTL.

**Rule: the cache key is `firstleg:${driverId}:${stopKey}` — it must NOT include the
live origin coordinates.**

**Why:** an earlier version keyed on rounded live coords
(`${fromLat.toFixed(4)},${fromLng.toFixed(4)}`). At 15s polling a moving vehicle
moves >~11m every tick, changing the 4-dp rounding, so every poll was a cache MISS
and fired a fresh Google call — silently scaling cost with poll cadence × moving
drivers and breaking the "1 Google call/driver/45s" budget. The live origin is
still sent on the actual route call; we just reuse the last result for 45s.

**How to apply:** any new surface that needs the active-leg ETA must go through
`firstLegEta`/`peekFirstLegCache` (dispatcher all-stops chain, driver-app ETA, 15s
position pusher all share it). Never add position/time into the cache key — keep it
driver+stop so the 45s TTL is the only refresh trigger.
