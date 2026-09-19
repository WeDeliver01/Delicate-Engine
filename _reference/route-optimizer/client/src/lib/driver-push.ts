import { getToken } from "@/lib/driver-api";
import { showDriverToast } from "@/components/driver/driver-toast";

export type DriverPushKind =
  | "assignment_new"
  | "route_changed"
  | "reorder_approved"
  | "reorder_rejected"
  | "stop_cancelled"
  | "online_request"
  | "test";

export interface DriverPushEventDetail {
  kind: DriverPushKind;
  data: Record<string, string>;
  source: "foreground" | "tap";
}

export type PushPermissionStatus = "granted" | "denied" | "prompt" | "unsupported" | "error";

type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface PluginListenerHandle { remove(): Promise<void> }

interface FirebaseMessagingNotificationData {
  title?: string;
  body?: string;
  data?: Record<string, string>;
}
interface FirebaseMessagingTokenEvent { token: string }
interface FirebaseMessagingNotificationEvent { notification?: FirebaseMessagingNotificationData }
interface FirebaseMessagingActionEvent {
  notification?: FirebaseMessagingNotificationData;
  actionId?: string;
}

interface FirebaseMessagingPlugin {
  checkPermissions(): Promise<{ receive: PermissionState }>;
  requestPermissions(): Promise<{ receive: PermissionState }>;
  getToken(opts?: { vapidKey?: string }): Promise<{ token: string }>;
  deleteToken(): Promise<void>;
  removeAllListeners(): Promise<void>;
  addListener(event: "tokenReceived", cb: (e: FirebaseMessagingTokenEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: "notificationReceived", cb: (e: FirebaseMessagingNotificationEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: "notificationActionPerformed", cb: (e: FirebaseMessagingActionEvent) => void): Promise<PluginListenerHandle>;
}

let cachedCapacitor: CapacitorRuntime | null | undefined;
let cachedMessaging: FirebaseMessagingPlugin | null | undefined;
let currentToken: string | null = null;
let registrationInFlight: Promise<PushPermissionStatus> | null = null;
let listenersAttached = false;

const PUSH_EVENT = "driver:push:received";

async function getCapacitor(): Promise<CapacitorRuntime | null> {
  if (cachedCapacitor !== undefined) return cachedCapacitor ?? null;
  try {
    const w = window as unknown as { Capacitor?: CapacitorRuntime };
    if (w?.Capacitor) {
      cachedCapacitor = w.Capacitor;
      return cachedCapacitor;
    }
    const corePath = ["@capacitor", "core"].join("/");
    const mod = (await import(/* @vite-ignore */ corePath)) as { Capacitor?: CapacitorRuntime };
    cachedCapacitor = mod.Capacitor ?? null;
  } catch {
    cachedCapacitor = null;
  }
  return cachedCapacitor;
}

export function isNativeSync(): boolean {
  if (cachedCapacitor && cachedCapacitor.isNativePlatform) {
    return cachedCapacitor.isNativePlatform();
  }
  const w = window as unknown as { Capacitor?: CapacitorRuntime };
  return !!w?.Capacitor?.isNativePlatform?.();
}

async function getMessaging(): Promise<FirebaseMessagingPlugin | null> {
  if (cachedMessaging !== undefined) return cachedMessaging ?? null;
  try {
    const cap = await getCapacitor();
    if (!cap?.isNativePlatform?.()) {
      cachedMessaging = null;
      return null;
    }
    const path = ["@capacitor-firebase", "messaging"].join("/");
    const mod = (await import(/* @vite-ignore */ path)) as { FirebaseMessaging?: FirebaseMessagingPlugin };
    cachedMessaging = mod.FirebaseMessaging ?? null;
  } catch {
    cachedMessaging = null;
  }
  return cachedMessaging;
}

async function postRegister(token: string, platform: string): Promise<void> {
  const authToken = getToken();
  if (!authToken) return;
  const w = window as unknown as { __APP_VERSION__?: string };
  const appVersion = w.__APP_VERSION__ ?? "";
  await fetch("/api/driver/push/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ token, platform, appVersion }),
  }).catch(() => {});
}

async function postUnregister(token: string): Promise<void> {
  const authToken = getToken();
  if (!authToken) return;
  await fetch("/api/driver/push/unregister", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ token }),
  }).catch(() => {});
}

function dispatchPushEvent(detail: DriverPushEventDetail): void {
  try {
    window.dispatchEvent(new CustomEvent<DriverPushEventDetail>(PUSH_EVENT, { detail }));
  } catch {
    // ignore — older browsers in tests
  }
}

export function tapTargetFor(kind: DriverPushKind | string): string {
  switch (kind) {
    case "reorder_approved":
    case "reorder_rejected":
      return "/driver/dashboard?focus=reorder";
    case "assignment_new":
    case "route_changed":
    case "stop_cancelled":
      return "/driver/dashboard?focus=trip";
    case "test":
    default:
      return "/driver/dashboard";
  }
}

function toastForKind(kind: DriverPushKind, title: string, body: string): void {
  const headline = title || "New notification";
  const message = body ? `${headline} — ${body}` : headline;
  switch (kind) {
    case "assignment_new":
    case "reorder_approved":
      showDriverToast(message, "success");
      return;
    case "stop_cancelled":
    case "reorder_rejected":
      showDriverToast(message, "error");
      return;
    case "route_changed":
    case "test":
    default:
      showDriverToast(message, "info");
      return;
  }
}

async function ensureListeners(plugin: FirebaseMessagingPlugin, platform: string): Promise<void> {
  if (listenersAttached) return;
  listenersAttached = true;
  try {
    await plugin.addListener("tokenReceived", async (event) => {
      if (!event?.token) return;
      // Token rotation: register new, drop old.
      const previous = currentToken;
      currentToken = event.token;
      if (previous && previous !== event.token) {
        await postUnregister(previous);
      }
      await postRegister(event.token, platform);
    });
    await plugin.addListener("notificationReceived", (event) => {
      const data = event?.notification?.data ?? {};
      const kind = (data.kind ?? "test") as DriverPushKind;
      // Foreground: surface in-app toast (OS presentation is suppressed via
      // FirebaseMessaging.presentationOptions = [] in capacitor.config.ts).
      toastForKind(kind, event?.notification?.title ?? "", event?.notification?.body ?? "");
      dispatchPushEvent({ kind, data, source: "foreground" });
    });
    await plugin.addListener("notificationActionPerformed", (event) => {
      const data = event?.notification?.data ?? {};
      const kind = (data.kind ?? "test") as DriverPushKind;
      dispatchPushEvent({ kind, data, source: "tap" });
      try {
        window.location.assign(tapTargetFor(kind));
      } catch {
        // ignore navigation failure
      }
    });
  } catch (err) {
    console.warn("[push] failed to attach listeners", err);
  }
}

let errorToastShownThisSession = false;
function reportRegistrationError(message: string): void {
  if (errorToastShownThisSession) return;
  errorToastShownThisSession = true;
  showDriverToast(message, "error");
}

export async function registerPushNotifications(): Promise<PushPermissionStatus> {
  if (registrationInFlight) return registrationInFlight;
  registrationInFlight = (async () => {
    try {
      const plugin = await getMessaging();
      if (!plugin) return "unsupported" as const;
      const cap = await getCapacitor();
      const platform = cap?.getPlatform?.() === "ios" ? "ios" : "android";

      let perm = await plugin.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
        perm = await plugin.requestPermissions();
      }
      if (perm.receive !== "granted") {
        return perm.receive === "denied" ? "denied" : "prompt";
      }

      await ensureListeners(plugin, platform);
      const tokenResult = await plugin.getToken();
      if (tokenResult?.token) {
        currentToken = tokenResult.token;
        errorToastShownThisSession = false;
        await postRegister(tokenResult.token, platform);
      } else {
        reportRegistrationError("Couldn't get a push token from Firebase. Notifications may not arrive.");
      }
      return "granted";
    } catch (err) {
      console.warn("[push] register failed", err);
      const msg = err instanceof Error ? err.message : "";
      reportRegistrationError(`Push registration failed${msg ? `: ${msg}` : ""}.`);
      return "error" as const;
    } finally {
      registrationInFlight = null;
    }
  })();
  return registrationInFlight;
}

export async function unregisterPushNotifications(): Promise<void> {
  try {
    const plugin = await getMessaging();
    let tokenToRemove = currentToken;

    // Best-effort: if we have no in-memory token (e.g. dashboard discovered
    // permission was already revoked before login could re-register), ask
    // FirebaseMessaging for the current FCM token so we can still delete the
    // server-side row. getToken throws on revoked permission — that's fine.
    if (!tokenToRemove && plugin) {
      try {
        const result = await plugin.getToken();
        if (result?.token) tokenToRemove = result.token;
      } catch {
        // permission revoked or token unavailable — nothing to clean up
      }
    }

    currentToken = null;
    if (tokenToRemove) {
      await postUnregister(tokenToRemove);
    }
    if (plugin) {
      try { await plugin.deleteToken(); } catch {}
      if (listenersAttached) {
        try { await plugin.removeAllListeners(); } catch {}
        listenersAttached = false;
      }
    }
  } catch (err) {
    console.warn("[push] unregister failed", err);
  }
}

export async function checkPushPermissionStatus(): Promise<PushPermissionStatus> {
  try {
    const plugin = await getMessaging();
    if (!plugin) return "unsupported";
    const perm = await plugin.checkPermissions();
    if (perm.receive === "granted") return "granted";
    if (perm.receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "error";
  }
}

interface NativeSettingsModule {
  NativeSettings?: {
    open(opts: { optionAndroid?: string; optionIOS?: string }): Promise<unknown>;
  };
  AndroidSettings?: { AppNotification?: string };
  IOSSettings?: { App?: string };
}

export async function openNotificationSystemSettings(): Promise<boolean> {
  try {
    const cap = await getCapacitor();
    if (!cap?.isNativePlatform?.()) return false;
    const path = ["capacitor-native-settings"].join("/");
    const mod = (await import(/* @vite-ignore */ path)) as NativeSettingsModule;
    if (!mod.NativeSettings?.open) return false;
    const platform = cap.getPlatform?.() ?? "android";
    await mod.NativeSettings.open({
      optionAndroid: platform === "android" ? mod.AndroidSettings?.AppNotification ?? "app_notification_settings" : undefined,
      optionIOS: platform === "ios" ? mod.IOSSettings?.App ?? "App" : undefined,
    });
    return true;
  } catch (err) {
    console.warn("[push] could not open notification settings", err);
    return false;
  }
}

export function onDriverPushEvent(listener: (detail: DriverPushEventDetail) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<DriverPushEventDetail>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(PUSH_EVENT, handler);
  return () => window.removeEventListener(PUSH_EVENT, handler);
}
