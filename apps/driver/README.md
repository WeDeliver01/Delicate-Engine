# Delicate Driver

The app a driver carries: their day's stops, proof of delivery, fuel, and the position trail
that the engine settles distance against and that customers see as a live ETA.

## Running it while developing

```bash
pnpm --filter @delicate/driver run start
```

Scan the QR code with Expo Go. A phone cannot reach your laptop's `localhost`, so point it at
the machine's address on the network — or at the dev site, which is simpler:

```bash
EXPO_PUBLIC_API_URL=https://dev.delicatecourier.co.za/api pnpm --filter @delicate/driver run start
```

Expo Go cannot do background location. Tracking only runs in a development build or a real
build, so on Expo Go the position trail stays empty and settlement falls back to planned
distance. Everything else works.

## Putting it on a driver's phone

Android, because that is what the drivers have. Install the CLI once, sign in to Expo, then:

```bash
pnpm --filter @delicate/driver exec eas build --platform android --profile preview
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

- A position ping roughly every 60 seconds or 250 metres while a shift is open. The customer's
  live ETA treats anything older than 10 minutes as stale and stops quoting minutes rather than
  guess from a position that has gone cold.
- Collection, delivery and failure posted as they happen, not batched at the end of the day.
  Each one is what moves the shipment's status, which is what the customer is watching and what
  triggers their notification.
- Proof of delivery with a name, and a signature or photo where the service level asks for one.
