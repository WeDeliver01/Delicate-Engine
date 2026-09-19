# Vehicle Logs — API Contract & Verification Checklist

## Adopted API field names

The driver-side endpoints use explicit, prefixed field names that mirror the
persisted column names. Consumers (mobile/PWA clients, dispatcher UI, any
external integrations) must use these exact names.

### POST `/api/driver/trips/start`
```
{
  "startOdometer": number,           // required, >= 0
  "startFuelLevel": "F"|"3/4"|"1/2"|"1/4"|"E",   // required
  "startClusterPhoto": string,       // required, data URL or remote URL
  "startLat": number?,               // optional
  "startLng": number?,               // optional
  "projectId": string?,              // optional; resolved server-side if omitted
  "notes": string?
}
```

### POST `/api/driver/trips/:id/end`
```
{
  "endOdometer": number,             // required, >= startOdometer
  "endFuelLevel": "F"|"3/4"|"1/2"|"1/4"|"E",     // required
  "endClusterPhoto": string,         // required
  "endLat": number?,
  "endLng": number?,
  "notes": string?
}
```

### POST `/api/driver/trips/:id/stops`
```
{
  "stopKey": string,                 // required (idempotency key, usually waybill)
  "waybill": string?,
  "stopType": "pickup"|"delivery",   // required
  "lat": number?,
  "lng": number?,
  "photoUrl": string?,
  "notes": string?
}
```

### POST `/api/driver/trips/:id/expenses`
```
{
  "expenseType": "fuel"|"toll"|"service",  // required
  "amount": number,                        // required
  "litres": number?,                       // fuel only
  "receiptUrl": string?,                   // required when expenseType === "fuel"
  "lat": number?,
  "lng": number?,
  "notes": string?
}
```

Naming rationale: `startOdometer`/`endOdometer`, `startClusterPhoto`/
`endClusterPhoto`, `photoUrl`, and `receiptUrl` are preferred over the
shorter generic forms (`odometer`, `clusterPhoto`, `photo`, `receipt`)
because they keep the request payloads symmetric with the database column
names and make `start`/`end` halves unambiguous in logs and dispatcher views.

## Driver retrieval endpoints

### GET `/api/driver/trips/active`
Returns `{ trip, stops, expenses }` for the caller's currently active trip,
or `{ trip: null, stops: [], expenses: [] }` if no active trip exists.
Clients should treat `trip === null` as "no active shift". The reason for
returning stops/expenses inline is so the dashboard can hydrate the
post-arrive evidence list and floating fuel pill in a single request.

### GET `/api/driver/trips/:id`
Returns `{ trip, stops, expenses }` for any trip owned by the caller
(403 otherwise). Used by the driver-side post-shift summary screen.

## Dispatcher endpoints

- `GET /api/vehicle-logs/trips` — supports query params `driverId`
  (alias `driverAccountId`), `status`, `from`, `to`, `limit`. Returns
  trips with denormalized stops/expenses summary.
- `GET /api/vehicle-logs/trips/:id` — full trip detail (trip, driver,
  stops, expenses, and computed summary). Backed by
  `IStorage.getTripDetail(id)`.

## Schema rollout

The Vehicle Logs tables (`driver_trips`, `driver_trip_stops`,
`driver_trip_expenses`) are added to `shared/schema.ts`. Replit's
deployment uses Drizzle's runtime `db:push` (no separate migration
artifacts in this repo), so the new tables are created automatically on
the first server boot of any environment that points at a fresh
database. For environments that already exist, a `npm run db:push` is
required as part of the deployment step before traffic is routed to the
new build. There are no destructive changes in this rollout.

## Manual verification checklist

Use `driver1` / `delicate2024` for driver login.

1. **Start-shift gate blocks dashboard** — Toggle online without an active
   trip. The dashboard must show the Start Shift gate; route list and
   actions are not interactive.
2. **Start without cluster photo → 400** — POST `/api/driver/trips/start`
   without `startClusterPhoto` returns 400.
3. **Start with all fields → 201** — Returns `{ trip: { status: "active" } }`.
4. **Active trip pill visible on mobile** — The header pill
   `pill-active-trip` renders at all viewport widths and shows
   `Trip #<id> · started HH:MM`.
5. **Arrive evidence** — Tap arrive on a stop. The Stop Evidence sheet
   opens; submitting (or skipping) creates a `driver_trip_stops` row
   linked to the active trip.
6. **Fuel without receipt → 400** — POST expense with
   `expenseType: "fuel"` and no `receiptUrl` returns 400.
7. **Fuel with receipt → 201** — Persists a `driver_trip_expenses` row.
8. **Toll/service without receipt → 201** — Receipt is fuel-only.
9. **Stops/expenses on closed trip → 409** — After end-shift, further
   POSTs to `/trips/:id/stops` or `/trips/:id/expenses` return 409.
10. **End-shift summary** — POST `/api/driver/trips/:id/end` returns
    `{ trip: { status: "closed", endOdometer, endFuelLevel } }` and the
    driver UI navigates to `/driver/summary` with totals.
11. **Dispatcher list** — `GET /api/vehicle-logs/trips?driverId=<id>`
    returns the trip with stops/expenses summary.
12. **Dispatcher detail** — `GET /api/vehicle-logs/trips/:id` returns
    `{ trip, driver, stops, expenses, summary: { stopCount, distanceKm,
    fuelTotal, litresTotal } }`.

## Automated regression script

`scripts/verify-vehicle-logs.sh` runs the 11 critical API checks above
against a live dev server (uses `driver1` / `delicate2024` by default).
It exits non-zero on the first failure. Recommended cadence: run before
each release candidate and paste the tail (`All Vehicle Logs API checks
passed.`) into the release notes.

```
./scripts/verify-vehicle-logs.sh
# or against a different host
BASE_URL=https://staging.example.com ./scripts/verify-vehicle-logs.sh
```
