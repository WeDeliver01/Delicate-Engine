# Delivery Time Window Overrides

Dispatchers can override a shipment's requested delivery window (`dAfter` / `dBefore`)
without touching the collection window. Overrides drive the optimizer, the trip
timeline, the driver app trip-sheet and ETA endpoints, and the outbound CRM
webhook payloads.

## Data model

- `projects.delivery_overrides` (jsonb) — `Record<shipmentId, { dAfter?, dBefore?, setAt, setBy? }>`.
- A new optional pair on `Shipment` — `origDAfter` / `origDBefore` — preserves
  the sender-requested window so the UI can render a "was 14:00–17:00" badge.

The override survives CSV re-imports because it lives on the project, not on
the shipment.

## Where it is applied

- `client/src/lib/routing.ts#applyDeliveryOverrides` — pure helper used by
  `dispatch.tsx` to feed the optimizer (`runOptimizer`), the schedule builder
  (`buildSched` via `dayShips`), and every shipment table.
- `server/routes/driver.ts#getActiveProjectAndStops` — applies the same map
  before building stops so `/api/driver/trip-sheet` and
  `/api/driver/trip-sheet/remaining-etas` clamp ETAs to the dispatcher window.

Because CRM webhooks derive `requestedDelivery*` and ETA values from the
already-overridden stops, no further plumbing is needed for outbound payloads.

## Manual verification

1. Sign in as a dispatcher (`testadmin` / `Test1234!`).
2. In the Ops tab, click a driver → open the Trip Overview modal.
3. In the Shipments table, click the pencil next to any delivery cell.
4. Change the window to one earlier than the original and Save.
5. Confirm:
   - The dialog reports "Saved & re-optimized" via toast.
   - The Shipments table now shows the new window with a "was …" badge.
   - The Trip Timeline reflects the new ETA and is re-ordered if the
     optimizer chose to move the stop earlier.
6. Re-open the dialog, click **Clear override**. The original window returns
   and another re-optimize runs.
7. As the assigned driver, refresh the PWA — the trip-sheet shows the new
   window for that stop.
