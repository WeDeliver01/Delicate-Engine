# Phase 8 — tracking statuses, driver-driven updates, and who may watch a van

Status: **proposed**, not signed off. Written from the flow given on 2026-10-08.

The flow asked for: a driver works a shipment from their app, moving it through tracking
statuses; notifications go out at each step, some automatic and some the driver chooses to
send; the recipient can be told the driver is minutes away; and on delivery both parties get
the proof of delivery and where it was dropped.

Most of the machinery exists. This document is mainly about the four places it does not, and
about two things in the request that would have gone wrong if built literally.

## 1. What already works

| Piece                                | State                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatcher assigns → driver sees it  | **Built.** Collections / Deliveries / All tabs, finished work kept on the day.                                                                                                |
| Stop detail, POD photo, deliver/fail | **Built.** `apps/driver/app/stop/[id].tsx`, settles on delivery.                                                                                                              |
| Notification engine                  | **Built.** Email over SMTP, SMS and WhatsApp over Twilio, `{{placeholder}}` templates, dedupe, per-account opt-out, suppression recorded with a reason rather than discarded. |
| Kinds for this flow                  | **Built.** `shipment.collected`, `shipment.out_for_delivery`, `shipment.driver_arriving`, `shipment.delivered`, `shipment.failed`.                                            |
| Live position, distance, ETA         | **Built.** `LiveTrackingService` — driver position with staleness, destination, distance, ETA minutes, stops-away, POD. Exposed to the account and to dispatchers.            |

So the gap is narrower than it looks: statuses to name the steps, a driver-facing way to move
between them, a way to let the recipient watch, and proof in the delivered email.

## 2. Two corrections to the request

### 2.1 `failed_delivery_attempt` already exists, as `failed`

`failed` is not terminal — `failed: ["assigned", "in_transit"]`. It already means "this attempt
did not succeed and the parcel can go out again", which is what a failed delivery attempt is.
Adding a second status for it would give two codes for one fact and a reporting split that
never reconciles.

**Decision:** no new status. `failed` is relabelled **"Failed delivery attempt"** everywhere it
is shown. If what is wanted is _how many times_ delivery was attempted, that is a counter on
the shipment and a different change; it is not in this phase.

### 2.2 A live driver position must not hang off the waybill

Waybills are `DC-YYYYMMDD-00001`, sequential per day. Anything keyed on a waybill can be
enumerated by counting. Public status lookup already works this way and leaks a little; adding
a driver's continuous GPS to the same surface means anyone who can count can watch every van in
the fleet move all day. The driver is a person, and that is their whole shift, not one parcel.

**Decision:** the recipient's view is reached by an unguessable per-shipment token, issued when
the shipment goes out for delivery and carried in the SMS or email link. It answers for one
shipment, and only while that shipment is out for delivery — the same rule
`LiveTrackingService` already applies to the account's view.

**Built.** `shipment_tracking_tokens` holds one `trk_`-prefixed token per shipment, minted the
first time the parcel is written about to its recipient and reused after that, so the link in
yesterday's SMS still works today. `GET /v1/public/live/:token` answers it without a login;
`/timeline` beside it gives the history without the notes. The page is
`apps/web/app/live/[token]`, `noindex` because the link is the authorisation.

Three things it withholds that the account's own view shows: the driver's phone number, their
surname, and the street address. A link sent by SMS gets forwarded, and none of those three are
needed by the person waiting — they know their own address, and the driver's mobile is theirs.

128 bits rather than 256, because every character of the URL is billed on an SMS. The
`/v1/public/live` prefix gets its own rate-limit bucket so a page polling every twenty seconds
does not spend the one the rest of `/v1/public` shares.

## 3. The status model

Three statuses are added. `in_transit` stays and keeps its meaning.

| Status               | Means                                                                               | Live position? |
| -------------------- | ----------------------------------------------------------------------------------- | -------------- |
| `collected`          | Picked up from the sender. In the driver's keeping.                                 | no             |
| `in_transit`         | Moving, but not on the final leg — between legs or at depot.                        | no             |
| `out_for_delivery`   | On the van, on the way to **this** recipient.                                       | **yes**        |
| `on_hold`            | Held and not moving: awaiting instruction, address problem, customer asked to wait. | no             |
| `returned_to_sender` | Came back. Terminal.                                                                | no             |

`out_for_delivery` is the one the existing code has been missing rather than lacking: at
`live-tracking.service.ts:118` the gate is `in_transit` while the message it returns says
"Live tracking starts when it is out for delivery."

Transitions:

```
booked             → assigned, collected, cancelled
assigned           → collected, booked, cancelled, on_hold
collected          → out_for_delivery, in_transit, delivered, failed, on_hold
in_transit         → out_for_delivery, delivered, failed, on_hold
out_for_delivery   → delivered, failed, in_transit, on_hold
on_hold            → assigned, in_transit, out_for_delivery, returned_to_sender, cancelled
failed             → assigned, in_transit, out_for_delivery, on_hold, returned_to_sender
delivered          → (terminal)
returned_to_sender → (terminal)
cancelled          → (terminal)
```

A driver may set `collected`, `out_for_delivery`, `on_hold`, `failed` and — through the proof of
delivery flow, not as a bare status change — `delivered`. `returned_to_sender` is a
dispatcher's decision: it ends the job and bears on what the customer is charged.

## 4. Notifications the driver chooses to send

Automatic notifications stay as they are. Added on top is a notify action the driver takes,
because the useful moments are ones only the driver knows about.

- **Who:** the collection contact, or the recipient.
- **How:** email, SMS, or a phone call. A call is a `tel:` link — the phone dials, the engine
  records that the driver was given the number.
- **What:** for the recipient on the way, an ETA message with a chosen gap — 5, 10 or 30
  minutes, or "I have arrived". One template with an `{{eta}}` placeholder, not four templates,
  so the wording is edited in one place.

**SMS goes out two ways, by configuration.** Twilio is implemented but has no credentials, so
every SMS today is recorded and suppressed rather than sent. Where Twilio is configured the
engine sends, records and dedupes it. Where it is not, the app opens the phone's own messaging
app with the text pre-filled and the driver sends it from their own number. The second is
free, works now, and comes from a number the recipient can reply to; what it cannot give is a
delivery receipt, and the app says which of the two just happened rather than implying a
record exists when it does not.

## 5. Proof in the delivered email

Today the customer gets an email linking to the proof and the recipient gets an SMS. The flow
asks for the proof itself, and where it was dropped, to reach both.

- The POD photo rides as an **inline attachment** (`cid:`), not a `data:` URI — Gmail and
  Outlook strip `data:` images, so the one that renders everywhere is the attachment. It goes
  only to the addressed recipient, so no new public surface is created for photographs of
  people's doorsteps.
- Where it was delivered is a **link to a map** at the captured coordinates, not an embedded
  map image: a static map costs an API call per email and quota per month, and the link is
  free and opens in whatever the reader already uses.
- The recipient gets the email **when we have an address for them**, which is optional at
  booking. No address means the SMS alone, as now — recipients are not made to supply an email
  to receive their parcel.

## 5a. Three things that were already broken

Found while wiring the above, fixed with it:

- `LiveTrackingService.coordsOf` read `lat`/`lng` off the delivery address, but a stored
  `Address` keeps them under `location`. Every tracking view had a null destination, a null
  distance and a null ETA — the map drew one pin and the ETA said "—".
- The same query named the driver from `users.fullName`, which is null until that driver has
  signed in and a user row exists. It now reads `drivers.fullName`, which is never null.
- `GET /v1/account/shipments/:id/timeline` took an id and no account, so any signed-in
  customer could read any other customer's timeline.
- Every notification links to `/track?waybill=…` and that page only ever read `?w=`, so all of
  them landed on an empty form. It now accepts both.

## 6. Deliberately not in this phase

- **A charge rule for `returned_to_sender`.** Whether a customer pays for a parcel that came
  back is a commercial decision, and the engine proposes money movements rather than inventing
  them. The status is recorded; settlement is untouched and a human decides.
- **Attempt counting.** See §2.1.
- **Live position for the collection contact before collection.** Asked for, and left out on
  purpose: before a parcel is collected the driver's position is about their whole run and
  other people's parcels. Once there is a reason to show it — the driver is on the way to
  _this_ collection — it is the same mechanism as the delivery leg and worth adding then.
- **WhatsApp.** The transport exists. Templates need Meta approval, which is bought outside
  this code; SMS and email first.
