import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "za.co.delicate.driver",
  appName: "Delicate Driver",
  webDir: "dist/public",
  bundledWebRuntime: false,
  ios: {
    contentInset: "always",
    backgroundColor: "#0f172a",
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    backgroundColor: "#0f172a",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    BackgroundGeolocation: {
      backgroundTitle: "Delicate Driver — On Duty",
      backgroundMessage: "Tracking your location for dispatch.",
      requestPermissions: true,
      stale: false,
      distanceFilter: 25,
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0f172a",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    // Suppress OS foreground presentation — the in-app driver toast handles
    // foreground notifications. iOS lockscreen banners still appear when the
    // app is backgrounded.
    PushNotifications: {
      presentationOptions: [],
    },
    FirebaseMessaging: {
      presentationOptions: [],
    },
  },
  server: {
    androidScheme: "https",
    iosScheme: "delicatedriver",
    cleartext: false,
  },
};

export default config;
