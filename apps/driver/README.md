# Delicate Driver

The app a driver carries: their day's stops, proof of delivery, fuel, and the position trail
that the engine settles distance against and that customers see as a live ETA.

## Signing in

Email and password, the same Supabase identity the office uses. The engine links the signed-in
user to a driver row **by email** on first contact, so there is nothing to issue by hand:

1. Create the user in Supabase (Authentication → Users).
2. Create the driver in the console at `/admin/drivers` with **the same email**.
3. Sign in on the phone.

A build needs to be told where that identity lives, or the sign-in form has nothing to talk to:

```
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Add them to the profile's `env` in `eas.json` before building. They are deliberately **not**
in the file as empty placeholders: EAS validates the whole file rather than just the profile
being built, and refuses an empty value, so a placeholder breaks every build until somebody
notices it.

Do not commit real values — this repository is public. The anon key is public by design and
row-level security is what protects the data, but a key in a public repo still invites people
to hammer your auth endpoints. Keep the edit local, or use `eas env:create` to store them on
Expo's servers.

Without them the app falls back to the dev-token box and says so on screen — which a production
engine refuses anyway, so an unconfigured build cannot sign anyone in.

### Check before you build

A build takes about twenty minutes and an unsigned-in app looks identical whichever link in the
chain is broken. Check the chain first, from the repository root:

```bash
infra/scripts/check-driver-signin.sh driver@delicatecourier.co.za
```

It asks for the password rather than taking it as an argument, then walks the chain in the order
it breaks: the values are filled in and not a pasted placeholder, the anon key belongs to the
project the URL names and is not the `service_role` key, the project answers, the account exists
and is confirmed, the engine is configured for that same project, and — the only step that proves
anything — the engine accepts a real token from it and agrees this login is an active driver.

It reads the profile's `env` from `eas.json`, or takes exported values if you keep them in
`eas env:create` instead:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
  infra/scripts/check-driver-signin.sh driver@delicatecourier.co.za
```

Run it on the VPS if you can: that is the only place `infra/docker/.env` exists, so it is the
only place the engine's half of step 5 can be checked.

The session is kept in the device keystore and renewed a minute before it expires. That matters
more than it sounds: a Supabase access token lasts about an hour and a shift lasts five, so
without renewal a driver is signed out somewhere around the fourth delivery. Renewal is
single-flighted, because the day screen fires several requests at once and Supabase rotates the
refresh token on use — two refreshes racing would spend the token twice and sign out a driver
who did nothing wrong.

If the engine ever answers 401 the session is dropped and the driver is returned to sign-in,
rather than left tapping through a day where everything fails for no stated reason.

## Running it while developing

```bash
pnpm --filter @delicate/driver run start
```

Scan the QR code with Expo Go. A phone cannot reach your laptop's `localhost`, so point it at
the machine's address on the network — or at the dev site, which is simpler:

```bash
EXPO_PUBLIC_API_URL=https://dev.delicatecourier.co.za/api pnpm --filter @delicate/driver run start
```

In a development build the sign-in screen also offers a dev-token box, for the tokens
`pnpm --filter @delicate/api run dev:token <driver>` mints. It is hidden in release builds.

Expo Go cannot do background location. Tracking only runs in a development build or a real
build, so on Expo Go the position trail stays empty and settlement falls back to planned
distance. Everything else works.

The pure parts of the session logic have tests, because deciding a token is still good when it
is not is the kind of mistake that is only discovered mid-round:

```bash
pnpm --filter @delicate/driver run test
```

## The day, and what a driver does with it

There is no shift to start. Dispatch rosters the driver and assigns the work; it appears on the
day screen and they get on with it. Nothing a driver does is gated on having pressed a button
first — that gate existed, and it meant someone standing at a customer's door with the parcel
in their hand could be refused by their own app for a step nobody had told them about.

The screen answers three questions without being asked:

- **What is next** — outstanding stops first, in the order dispatch released or the planner
  worked out; finished ones underneath, dimmed.
- **How much is left** — three tabs, `All`, `Collect` and `Deliver`, each showing what is still
  outstanding in it, or a tick when that part of the day is cleared.
- **Am I finished** — "All done for today" once every stop is worked. This is not the same as an
  empty list, and the distinction is the whole point: a day with nothing assigned yet reads
  "Nothing assigned yet", because telling a driver who has been given no work that they have
  finished sends them home mid-shift.

A stop counts as done when it is delivered, or when the attempt failed and dispatch will
reassign it, or — for a collection — when nothing on the booking is still waiting to be picked
up. The rule lives in `stopIsDone` in `@delicate/contracts` and is used by both sides, so the
engine and the app cannot disagree about whether somebody is finished.

Odometer readings are optional and the driver volunteers them whenever they remember. The first
of a day is kept as the opening reading and the latest as the closing one, so the pair still
spans the van's running without anybody being made to type before their first collection.

## Putting it on a driver's phone

Android, because that is what the drivers have. `eas-cli` is not a dependency of this package,
so run it with `npx`:

```bash
cd apps/driver
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

On a headless box (a VPS over SSH) browser login cannot work — the CLI listens on _its own_
`localhost` and your browser is somewhere else entirely. Use a token from
expo.dev → Account settings → Access tokens instead:

```bash
read -rs EXPO_TOKEN && export EXPO_TOKEN     # paste; keeps it out of shell history
npx eas-cli@latest build --platform android --profile preview
```

That produces an `.apk` and a link. Send the link to the driver, they tap it and install — no
Play Store, no review. `preview` points at the dev site; `production` is the profile to use
once there is a production API, and produces an `.aab` for the Play Store instead.

The first build asks to create a keystore. Let EAS manage it: losing that key means never being
able to update the installed app.

## Permissions the driver has to grant

On first sign-in the app asks for location, then for "Allow all the time", then the camera. The
second one is the one people decline by reflex, and without it the trail stops the moment the
phone is pocketed — which is most of the shift. The wording in `app.json` explains why we are
asking, and it is worth explaining again in person.

Battery optimisation on Samsung and Xiaomi phones kills background tasks aggressively. If a
driver's trail keeps stopping, exempt the app in the phone's battery settings.

## What the engine expects from it

- A position ping roughly every 60 seconds or 250 metres while the driver has stops left. The
  customer's live ETA treats anything older than 10 minutes as stale and stops quoting minutes
  rather than guess from a position that has gone cold. The first ping of a day is also what
  opens the driver's roster row and sets the time their day began — nobody clocks on, so the
  van moving is the only honest signal.
- Collection, delivery and failure posted as they happen, not batched at the end of the day.
  Each one is what moves the shipment's status, which is what the customer is watching and what
  triggers their notification.
- Proof of delivery with a name, and a signature or photo where the service level asks for one.
