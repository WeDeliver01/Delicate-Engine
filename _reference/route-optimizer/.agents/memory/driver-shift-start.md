---
name: Driver shift-start auto-closes stale shifts
description: Why starting a shift must not be blocked by an existing active driver_trip
---

A `driver_trips` row can get stuck in status "active" when a driver's app closes
before they tap End Shift. The shift-start endpoint used to reject a new start
with 409 "An active shift already exists" whenever an active row existed, which
permanently locked those drivers out of going online.

**Rule:** Starting a shift must always succeed. On start, auto-close *all* of the
driver's lingering active trips (not just the most recent) before creating the
new one, and never let a close failure block the new start.

**Why:** Drivers reported being unable to go online/live even though they had no
shift they were aware of — the blocker was orphaned active rows.

**How to apply:** Auto-closed shifts are ended with zero distance (end odometer =
start odometer) and a notes marker "Auto-closed: superseded by a new shift
start", since there's no real end reading. Online/live presence is driven by
driverAccounts.isOnline + location pings, NOT by driver_trips.status, so this
does not affect the live map. Trip-count KPIs may include these zero-distance
closeouts; distance/fuel totals stay conservative (not inflated).
