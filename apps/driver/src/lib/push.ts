import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "./api";

/**
 * Being told, rather than finding out.
 *
 * The day screen polls, and polling keeps the list right. What it cannot do is make a phone in
 * a pocket buzz when dispatch adds a collection two suburbs away. That buzz comes through
 * Expo's push service: the app hands the engine its token here, the engine sends to it when
 * the driver's day changes, and the app re-reads the day when one arrives.
 *
 * Everything in here is optional in the sense that the app works without it. No EAS project
 * id, no permission, a simulator, Expo Go — each of those means no push, and the day still
 * refreshes on its own. None of them is an error worth showing a driver.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The token the engine was last given, so sign-out can take it back. */
let registered: string | null = null;

function projectId(): string | null {
  const fromEas = Constants.easConfig?.projectId;
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromEas || fromExtra || null;
}

/** Whether this build can receive a push at all. Expo Go and simulators cannot. */
export function pushAvailable(): boolean {
  return Device.isDevice && projectId() !== null;
}

/**
 * Ask the phone for a token and hand it to the engine. Safe to call on every launch: the
 * engine keeps one row per token and only refreshes when it has seen it before.
 */
export async function registerForPush(): Promise<string | null> {
  if (!pushAvailable()) return null;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return null;

    if (Platform.OS === "android") {
      // The channel the engine names on every push. Importance MAX is what makes it heads-up
      // on a phone that is doing something else, which is the whole point.
      await Notifications.setNotificationChannelAsync("jobs", {
        name: "Jobs",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#E84A8A",
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId()! })).data;
    await api("/v1/driver/device", {
      method: "POST",
      json: {
        expoPushToken: token,
        platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
        appVersion: Constants.expoConfig?.version ?? null,
      },
    });
    registered = token;
    return token;
  } catch {
    // No signal, no permission, no project id in this build: the day still polls.
    return null;
  }
}

/** Signing out: this phone stops hearing about this driver's work. */
export async function unregisterPush(): Promise<void> {
  const token = registered;
  registered = null;
  if (!token) return;
  try {
    await api("/v1/driver/device", { method: "DELETE", json: { expoPushToken: token } });
  } catch {
    // Best effort. The engine also drops a token Expo reports as dead.
  }
}

/** What a push carries, as the engine sends it. */
export interface PushData {
  kind?: "assigned" | "unassigned" | "changed";
  shipmentId?: string;
}

export function dataOf(response: Notifications.NotificationResponse | null): PushData {
  const data = response?.notification.request.content.data as PushData | undefined;
  return data ?? {};
}

export const onNotificationReceived = Notifications.addNotificationReceivedListener;
export const onNotificationOpened = Notifications.addNotificationResponseReceivedListener;
export const lastNotificationOpened = Notifications.getLastNotificationResponseAsync;
