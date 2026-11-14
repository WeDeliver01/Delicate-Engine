# Phase 9 — the driver workflow, over the finish line

Status: **built 2026-11-14**, from Ashley's brief of 2026-11-13: a booked and scheduled delivery
did not show on the driver's app in a way that was usable, and the Command Center was not yet a
place a dispatcher could run the day from. The brief asked for the chain to work end to end —
assigned work appears on the phone, the driver moves it through its tracking statuses, the phone
shares its position so recipients see the van coming, and a delivery closes with proof-of-delivery
photographs — borrowing from how ShipLogic, Uber and the like run a driver's day.

This document records what was actually broken, what changed, and the two design decisions that
reverse earlier ones.

---

## 1. What was wrong

Six faults, found by reading the chain from `booking.confirmed` to the driver's screen and back.

| #   | Fault                                                                                                                                                                                                                                                                                                 | Where                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | **The day query listed its statuses by hand and stopped at `in_transit`.** The moment a driver tapped "Out for delivery — start tracking", the parcel left their list. `on_hold` vanished the same way. The one status that starts the recipient's live map took the job off the driver's screen.     | `DispatchService.day()`                               |
| 2   | **Every assigned shipment, whatever its date, sat in one list.** A booking for Friday appeared on Monday's screen as the next thing to drive to, and counted against Monday's progress.                                                                                                               | `DispatchService.day()`                               |
| 3   | **Location only flowed while a rostered shift was open.** The main driver is auto-assigned every booking whether or not dispatch rostered them, but clocking on answered `null` without a roster row — so the van never appeared on the live map and the recipient's "live" page had nothing to show. | `FleetService.openShift`, `apps/driver/app/index.tsx` |
| 4   | **Background location alone.** Expo Go cannot run it, and a driver who answered "only while using the app" to the permission prompt had switched tracking off without knowing. Nothing reported positions while the app was open.                                                                     | `apps/driver/src/lib/location.ts`                     |
| 5   | **Auto-assigned work never reached a trip.** The dispatch board's lanes, the live map's progress and the trip sheet all read `trip_stops`. A shipment the engine assigned (the common case) was on no trip, so the Command Center was blind to it unless a dispatcher built a trip by hand.           | `OperationsModule` had no `shipment.assigned` handler |
| 6   | **Nothing woke the phone.** The app polled every sixty seconds; a new collection two suburbs away was a card the driver might notice on their next glance.                                                                                                                                            | no push at all                                        |

And three things that were not broken but were fragile: a delivery retried on a bad signal was
refused as an "invalid transition" after it had landed; a second "collected" tap got a 409; and one
photograph was the most a proof of delivery could carry.

---

## 2. What changed

### 2.1 Engine

- **`DRIVER_VISIBLE_STATUSES`** in contracts, derived from the status enum (everything but
  `booked`, `cancelled`, `returned_to_sender`), replaces the hand-written list in `day()`. Fault 1.
- **`DriverDay.upcoming`** — stops dated after today, within a month, returned separately and not
  counted in progress; overdue work stays on today. `isUpcoming()` is the pure rule, tested. Fault 2.
- **`DriverDay.trip`** and **`DriverStop.tripStopId` / `tripStopStatus`** — the released trip the
  day is read from, and the stop the app reports arrival against. Read through `TripPlanRegistry`,
  never the operations tables (module rule).
- **Going online rosters the driver.** `openShift` creates the shift row when none exists, audited
  as `shift.self_roster`. Decision 1, §3. Fault 3.
- **Auto-placement on assignment.** `shipment.assigned` → `TripService.placeOnDay`: find the
  driver's trip for the slot date (or today when overdue), create and release one if none, add the
  stop, resequence. A trip a dispatcher is drafting takes the stop and stays a draft. A completed
  trip given another stop reopens. A shipment already on one of that driver's live trips is left
  where the dispatcher put it, whatever the date. `shipment.unassigned` detaches; a cancellation or
  return closes the stop as skipped; a skipped stop whose shipment goes out again reopens. Fault 5.
- **Trips start themselves.** Arriving, collecting or delivering on a `released` trip marks it
  `started` with the same event and dedupe key as the button, so the board shows "working" for a
  driver who is three drops in, not "ready". The Start button remains and becomes a no-op after.
- **Idempotent driver actions.** A repeated `deliver` returns the proof already on file; a repeated
  `collect` returns the parcels already collected; a repeated `status` or `fail` returns the shipment
  as it is. No second event, no second journal. `DeliverRequest.attemptId` names the attempt.
- **Several photographs.** `DeliverRequest.photoDataUrls` (up to four with the first), stored in
  `proofs_of_delivery.photo_file_ids`; `photo_file_id` stays as the first for everything that reads
  one. `ProofOfDelivery.photoCount`; the settlement endpoint's `files.photoFileIds`.
- **Driver devices and push.** `driver_devices` (one row per Expo push token, moves with the token,
  disabled rather than deleted when Expo reports it dead). `POST/DELETE /v1/driver/device`.
  `DriverPushService` sends through Expo's push API on `shipment.assigned` (new job; and "job moved"
  to the previous driver), `shipment.unassigned`, an approved `shipment.change_decided`, and a
  cancellation or return. Best effort by design: a failed push is a warning in the system-events
  feed (`push.driver`), never an error, and never money. Fault 6.

### 2.2 Driver app

- **Today / Coming up.** Two sections; later days grouped by date with no "open" button.
- **Go online / Go offline.** Works for anyone with a driver profile. Tracking follows the work:
  on shift _or_ holding outstanding stops, the phone reports; otherwise it stops.
- **Foreground watcher beside background tracking.** `syncTracking(working)` runs a
  `watchPositionAsync` subscription while the app is open (works on Expo Go, works with
  "while using" permission) and the background task when the "always" permission is granted. The
  screen says which it has and what allowing "all the time" would add. Fault 4.
- **Push.** Token registered on launch and sign-in, forgotten on sign-out; a push received re-reads
  the day, a push tapped opens the stop. Needs `extra.eas.projectId` in `app.json` (EAS writes it;
  blank means no push, nothing else changes).
- **An outbox.** Every work action — collect, deliver, fail, status, arrive — goes through
  `submit()`. Sent at once when it can be; otherwise written to the app's document directory and
  retried on a timer, when the app comes to the front, and on pull-to-refresh. The stop shows
  "Sending…" until the engine agrees; a refusal the engine means is parked for the driver to retry
  or discard, never dropped silently. The pure half (`queue.ts`) is tested.
- **Arrival.** "I've arrived" on a stop that sits on a trip. On a drop it is what tells the
  recipient the van is outside (`trip.stop_arrived` → `shipment.driver_arriving`).
- **Up to three photographs** on a delivery, with thumbnails, each removable.
- **Refresh every 20 s**, and whenever the app comes to the front.

### 2.3 Console

`apps/web/components/shipments/pod-photos.tsx` renders the proof photographs from the files
endpoint behind the bearer token. It is not yet placed on a page: the shipment detail page was
being built in a parallel session when this landed, and the two will be joined there.

---

## 3. Two decisions that reverse earlier ones

**1. A driver can go online without being rostered.** Phase 2 answered `null` to a clock-on from an
unrostered driver, on the reasoning that a shift dispatch never scheduled would put a driver on
the board behind dispatch's back. That reasoning stopped holding when auto-assignment to the main
driver stopped requiring a roster (the `is_main` change): the engine was already handing the
driver work, and refusing to let them go online only hid their van. Dispatch still rosters;
rostering still drives capacity and auto-assign candidates. A self-rostered shift is simply a
shift, audited as the driver's own act. This is what every ride-hailing app does, and it is what
the brief asked to borrow.

**2. The engine places work on trips.** Phase 7 made the trip a dispatcher's decision, written
down. It still is: a dispatcher's trip is never overridden, their order (`sequenceSource =
dispatcher`) is never touched, and their draft stays a draft. What changed is the default when
nobody built one. An assignment is already dispatch's instruction to deliver; the trip is the
container the board reads from, and leaving it empty made the Command Center describe a day that
was not happening. Auto-created trips are released immediately for the same reason: there is
nothing in them a dispatcher has not already decided.

---

## 4. What did not change

- **Money.** No new journal, no new settlement path. Idempotent `deliver` returns without posting;
  the first call still settles exactly as before. Invariant 7 holds: a push is not a payment.
- **Statuses.** The transition table and `DRIVER_SETTABLE_STATUSES` are untouched; `delivered` still
  goes only through the proof flow.
- **The recipient's view.** `out_for_delivery` still gates the live map; the per-shipment token is
  still the authorisation. The map simply has a position to show now.

---

## 5. Still open

| Item                                                                                                      | Why                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `extra.eas.projectId` in `apps/driver/app.json`, and a rebuild of the app (`eas build --profile preview`) | Push cannot register without it. `eas init` writes it; it is not a secret.                                               |
| FCM credentials on the Expo project for Android pushes                                                    | Expo's push service needs a Firebase service account uploaded once (`eas credentials`). iOS uses APNs the same way.      |
| The POD photo gallery on the shipment detail page                                                         | The page was in flight in another session; the component exists and takes `fileIds`.                                     |
| A device-reachability column on the fleet desk                                                            | `FleetService.deviceCounts()` exists; nothing renders it yet.                                                            |
| Signature capture                                                                                         | The engine accepts one; the app does not draw one. Photographs were asked for; a signature pad is a day's work.          |
| Band-of-the-day ETA on the stop card                                                                      | `LiveService` projects ETAs for the console; the driver's own card could show the planned arrival minute it already has. |
