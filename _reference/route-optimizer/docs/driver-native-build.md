# Delicate Driver — Native App Build & Distribution Runbook

This document covers building and distributing the **native** Delicate Driver
app on iOS and Android. The native shell is a thin Capacitor wrapper around the
existing driver PWA (`/driver/*` routes) and exists for one reason only: **24/7
background GPS** that the browser cannot reliably provide on iOS.

The dispatcher web app is unaffected — it stays browser-only.

---

## 1. Why Capacitor?

The driver app is already a React PWA. Capacitor wraps the existing build and
swaps the geolocation hook for a native plugin. We did **not** rewrite anything
in React Native — every screen, hook, API call and CSS file is shared between
the web and native versions.

When the app runs natively, `Capacitor.isNativePlatform()` returns `true` and
`useDriverLocation` delegates to `@capacitor-community/background-geolocation`
instead of the browser fallbacks (visibility-change polling, silent audio,
wake lock, beacon). On the web, none of that changes.

---

## 2. Prerequisites

You can scaffold and develop the project from any machine, but to actually
build a runnable iOS app you need a **Mac with Xcode**. Android builds work on
any OS (macOS / Linux / Windows).

| What | Used for |
| --- | --- |
| Node.js 20+ | Capacitor CLI, `npx cap …` commands |
| Xcode 15+ on macOS | iOS build, signing, TestFlight upload |
| Apple Developer Program ($99/yr) | iOS code signing + TestFlight |
| Android Studio (latest) | Android build, emulator, APK signing |
| Java 17 (bundled with AS) | Gradle |
| Android SDK 34 (bundled with AS) | Target SDK |

---

## 3. One-time scaffold (run on a workstation, not on Replit)

The Capacitor packages and `capacitor.config.ts` are already committed in this
repo. The first time you set up a development workstation, run:

```bash
npm install               # if you haven't already
npm run build             # produces dist/public used by Capacitor
npx cap add ios           # creates the ios/ folder (macOS only)
npx cap add android       # creates the android/ folder
```

Commit the resulting `ios/` and `android/` folders. Capacitor regenerates
internal files on every `cap sync`, so day-to-day rebuilds do **not** need
re-scaffolding.

> **Replit-specific note:** `npx cap add ios` cannot run on Replit (no Xcode);
> `npx cap add android` *can* run on Replit but requires the Android SDK,
> which is heavy and not installed by default. Do the scaffolding on the
> developer workstation that already has Android Studio installed.

---

## 4. Daily dev loop

```bash
# 1. Build the web app (Vite outputs to dist/public)
npm run build

# 2. Copy the freshly built web assets into both native projects
npx cap sync

# 3a. iOS — opens the project in Xcode
npx cap open ios

# 3b. Android — opens the project in Android Studio
npx cap open android
```

For live-reload during UI work, point the native shell at the running dev
server by temporarily setting `server.url` in `capacitor.config.ts` to your
machine's LAN IP (e.g. `http://192.168.1.42:5000`). Remove this before every
production build.

---

## 5. iOS — required settings

Open `ios/App/App/Info.plist` and confirm the following keys are present (the
runbook below assumes you've reviewed them after the first `cap add ios`):

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Delicate Driver tracks your location while you are on duty so dispatch can give customers accurate ETAs.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Delicate Driver keeps tracking your location while the app is in the background or your screen is locked. This is required to keep dispatch and customers informed about your live ETA.</string>

<key>NSMotionUsageDescription</key>
<string>Used to detect when you are moving or stationary so we can throttle GPS updates and save battery.</string>

<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>fetch</string>
</array>
```

Other Xcode settings:

* **Deployment target:** iOS 14.0 or higher.
* **Signing & Capabilities → Team:** select your Apple Developer team.
* **Signing & Capabilities → Background Modes:** tick "Location updates" and
  "Background fetch".
* **Bundle identifier:** `za.co.delicate.driver` (matches `capacitor.config.ts`).
* **Display name:** Delicate Driver.

### Building & uploading to TestFlight

1. In Xcode: **Product → Scheme → Edit Scheme → Run → Build Configuration**:
   set to **Release**.
2. Choose **Any iOS Device (arm64)** as the run target.
3. **Product → Archive**.
4. When the Organizer opens, click **Distribute App → App Store Connect →
   Upload**. Walk through the signing prompts.
5. Log in to <https://appstoreconnect.apple.com>, open the Delicate Driver app,
   go to **TestFlight**, wait for processing (~5–15 min), then add internal
   testers (your drivers' Apple IDs).
6. Drivers receive an email and install Apple's TestFlight app, then accept the
   invite. After install, drivers **must** grant location permission as
   "Always Allow" — not "While Using" — for background tracking to work.

---

## 6. Android — required settings

After `npx cap add android`, ensure
`android/app/src/main/AndroidManifest.xml` declares these permissions inside
`<manifest>` and the `LocationService` foreground service inside `<application>`:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

In `android/app/build.gradle`:

```gradle
android {
    compileSdkVersion 34
    defaultConfig {
        applicationId "za.co.delicate.driver"
        minSdkVersion 24
        targetSdkVersion 34
        versionCode 1
        versionName "1.0.0"
    }
}
```

The `@capacitor-community/background-geolocation` plugin auto-registers the
foreground service. The persistent notification text comes from the
`backgroundTitle` / `backgroundMessage` we set in
`client/src/lib/driver-native-location.ts`.

### Building a debug APK (no signing)

```bash
cd android
./gradlew assembleDebug
# APK lands at: android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a device with `adb install path/to/app-debug.apk`, or send the file
to a tester via WhatsApp/email — they tap it and accept the "Install unknown
apps" prompt.

### Building a signed release APK

1. Generate a keystore once (keep it safe and back it up):

   ```bash
   keytool -genkey -v -keystore delicate-driver.keystore \
     -alias delicate-driver -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Add `android/keystore.properties` (already gitignored):

   ```
   storeFile=/absolute/path/to/delicate-driver.keystore
   storePassword=…
   keyAlias=delicate-driver
   keyPassword=…
   ```

3. Wire it up in `android/app/build.gradle` (`signingConfigs.release` block).
4. Build:

   ```bash
   cd android
   ./gradlew assembleRelease
   # APK at: android/app/build/outputs/apk/release/app-release.apk
   ```

### Publishing the APK to drivers

The repo already exposes two endpoints for OTA-style distribution:

* `GET /api/driver/install/info` — JSON metadata used by the in-app
  `/driver/install` page.
* `GET /api/driver/install/android` — serves the latest signed APK.

Drop your latest signed APK into the project at:

```
attached_assets/driver-app/latest.apk
```

Optionally also drop:

```
attached_assets/driver-app/latest.json
{
  "version": "1.0.0",
  "releasedAt": "2025-05-01T08:00:00Z"
}
```

…then redeploy. Drivers visiting `/driver/install` (linked from the login
screen) will see the version, file size, a download button, and step-by-step
installation instructions.

For iOS, set the `DRIVER_TESTFLIGHT_URL` env var to your public TestFlight
join link (e.g. `https://testflight.apple.com/join/abcd1234`) — the install
page will surface a one-tap "Open TestFlight Invite" button. If unset, drivers
get a "Request TestFlight Invite" mailto link to your dispatch email
(configurable via `DRIVER_INSTALL_CONTACT_EMAIL`).

---

## 7. Smoke verification

* **In-app diagnostics panel** — On the driver dashboard, open the menu and
  tap **Native Diagnostics** (only visible when running natively). It shows:
  runtime (Native vs. Web), location permission state, last GPS fix age and
  accuracy, queue depth, battery level. Use this on a real device to confirm
  background tracking is healthy.
* **iOS background test:** Toggle ON DUTY, lock the phone, walk for 10 min.
  Open the dispatcher map — your dot should keep updating with fresh
  timestamps. Then watch a 30-min YouTube video to test long backgrounding.
* **Android boot-resume test:** Toggle ON DUTY, reboot the phone, **don't**
  open the app. The foreground service notification should reappear within
  ~15 seconds, and dispatcher should see updates resume.
* **Throttling check:** Stand still — updates should drop to ~30s cadence.
  Walk/drive — they should jump back to ~10s.

---

## 8. Common iOS background-location pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tracking stops within ~3 minutes of locking the screen | Permission set to "While Using" instead of "Always Allow" | Settings → Delicate Driver → Location → **Always**. The diagnostics panel will report `denied` or `prompt` until this is set correctly. |
| App was killed by iOS overnight, no updates next morning | Normal iOS behaviour after long backgrounding without significant motion | The plugin re-registers significant-location-change monitoring; opening the app once on shift start is enough. We've also enabled `UIBackgroundModes=fetch` so the app gets periodic wake-ups. |
| Works on simulator, fails on device | Simulator hands the app a fixed location; real-device GPS needs **Always** permission | Always test the background path on a real iPhone. |
| Updates pause when phone hits Low Power Mode | iOS heavily throttles background tasks in LPM | Tell drivers to plug into the in-vehicle charger. The diagnostics panel surfaces battery percentage so you can spot LPM patterns. |

---

## 9. Push notifications (FCM + APNs via FCM)

The driver app receives push notifications for new assignments, route changes,
reorder approvals/rejections, and stop cancellations. **All pushes flow through
Firebase Cloud Messaging** — Android natively, iOS via FCM-wrapped APNs.

### 9.1 Server setup

1. In Firebase console → Project settings → **Service accounts** → *Generate new
   private key*. This downloads a JSON file.
2. In Replit, set the secret `FIREBASE_SERVICE_ACCOUNT_JSON` to the **entire
   contents** of that JSON file (one line, with `\n` literals inside
   `private_key` — the server normalises them).
3. Restart the workflow. Logs should show `[push] firebase-admin initialised`.
   If the secret is missing the server logs `[push] disabled — …` once and all
   push calls become no-ops; the rest of the app keeps working.

### 9.2 Native client setup

The Capacitor plugin `@capacitor-firebase/messaging` is already in
`package.json` and provides true FCM tokens on **both** Android and iOS
(on iOS it wraps APNs internally so the server only ever sees FCM tokens).
The `FirebaseMessaging` block in `capacitor.config.ts` sets
`presentationOptions: []` so OS lockscreen banners are suppressed while the
app is in the foreground — the in-app driver toast handles that case
instead, preventing double-notification.

**Android:** drop your project's `google-services.json` into
`android/app/` after running `npx cap add android`. Add the Google Services
Gradle plugin if Capacitor's template doesn't already include it:
```gradle
// android/build.gradle  classpath 'com.google.gms:google-services:4.4.2'
// android/app/build.gradle  apply plugin: 'com.google.gms.google-services'
```

**iOS:** in Xcode select the `App` target → *Signing & Capabilities* → add
**Push Notifications** and **Background Modes → Remote notifications**. Drop
`GoogleService-Info.plist` into `ios/App/App/` (drag into Xcode so it's added
to the target). Upload your APNs auth key (.p8) in the Firebase console under
Project settings → Cloud Messaging → Apple app configuration.

### 9.3 Lifecycle

The token is requested on driver login (`useDriverAuth` →
`registerPushNotifications`), upserted server-side via
`POST /api/driver/push/register`, and removed on logout via
`POST /api/driver/push/unregister`. The dashboard also re-checks permission
state when the app returns to the foreground; if the user revokes
notifications in system settings, the token is automatically unregistered
from the server. FCM token rotations (`tokenReceived` event) are handled
transparently — the new token is registered and the previous one removed in
the same call. Tokens that FCM rejects as `not-registered` /
`invalid-registration-token` are pruned from the DB on send.

If iOS or Android denies the permission prompt the dashboard shows an amber
banner. **Enable** triggers the system prompt; if permission is already
`denied`, **Open Settings** deep-links straight to the app's notification
settings page via `capacitor-native-settings`.

### 9.3.1 Push payload contract

Every push carries a `notification` (title + body for the OS lockscreen) and a
`data` payload whose `kind` field tells the client what happened. Allowed
values: `assignment_new`, `route_changed`, `stop_cancelled`,
`reorder_approved`, `reorder_rejected`, `test`. The driver client surfaces a
foreground toast on receipt and dispatches a `driver:push:received` window
event so the dashboard refreshes the trip sheet (assignment/route/cancel) or
the reorder status (reorder_*) without waiting for the next 30s poll. Tap
deep-links default to `/driver/dashboard` with `?focus=trip` or
`?focus=reorder`.

### 9.4 Smoke test

Once `FIREBASE_SERVICE_ACCOUNT_JSON` is set and a driver has logged in on a
real device, dispatchers can fire a test push:
```bash
curl -X POST -H "Content-Type: application/json" \
  --cookie "connect.sid=<your dispatcher session>" \
  -d '{"driverName":"Driver Test"}' \
  https://<host>/api/driver/push/test
```
Response: `{ "ok": true, "sent": 1, "pruned": 0, "configured": true }`.

Real-event triggers fire automatically from:
* `PATCH /api/projects/:id` — diffs `assignments`, `driverStopSequences` and
  `stopStatuses` to emit `assignment_new`, `route_changed`, `stop_cancelled`.
* `PATCH /api/dispatch/reorder-requests/:id` — emits `reorder_approved` or
  `reorder_rejected`.

---

## 10. Future upgrades worth considering

* **`@transistorsoft/capacitor-background-geolocation`** — paid commercial
  plugin (~$300/year) with significantly better iOS reliability and built-in
  motion detection, geofencing, and HTTP queue. Drop-in replacement; only the
  `addWatcher` call in `driver-native-location.ts` would change.
* **App Store public listing** — currently TestFlight internal only. Public
  submission requires a privacy policy URL, screenshots for every device size,
  and Apple App Review (~3–7 days).
