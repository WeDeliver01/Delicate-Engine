import type { App } from "firebase-admin/app";
import type { Messaging, MulticastMessage } from "firebase-admin/messaging";
import { storage } from "../storage";

export type DriverPushKind =
  | "assignment_new"
  | "route_changed"
  | "reorder_approved"
  | "reorder_rejected"
  | "stop_cancelled"
  | "online_request"
  | "test";

export interface DriverPushPayload {
  kind: DriverPushKind;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface FirebaseServiceAccount {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  private_key?: string;
  client_email?: string;
  client_id?: string;
  [key: string]: unknown;
}

let cachedApp: App | null | undefined;
let cachedMessaging: Messaging | null | undefined;
let initLogged = false;

function logSkip(reason: string): void {
  if (!initLogged) {
    console.log(`[push] disabled — ${reason}`);
    initLogged = true;
  }
}

async function getMessaging(): Promise<Messaging | null> {
  if (cachedMessaging !== undefined) return cachedMessaging;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.trim().length === 0) {
    cachedMessaging = null;
    cachedApp = null;
    logSkip("FIREBASE_SERVICE_ACCOUNT_JSON not set");
    return null;
  }

  let creds: FirebaseServiceAccount;
  try {
    creds = JSON.parse(raw) as FirebaseServiceAccount;
  } catch {
    cachedMessaging = null;
    cachedApp = null;
    logSkip("FIREBASE_SERVICE_ACCOUNT_JSON could not be parsed as JSON");
    return null;
  }

  if (typeof creds.private_key === "string") {
    creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  }

  try {
    const adminApp = await import("firebase-admin/app");
    const adminMsg = await import("firebase-admin/messaging");
    const existing = adminApp.getApps().find((a) => a.name === "driver-push");
    cachedApp = existing
      ?? adminApp.initializeApp({ credential: adminApp.cert(creds as Parameters<typeof adminApp.cert>[0]) }, "driver-push");
    cachedMessaging = adminMsg.getMessaging(cachedApp);
    console.log("[push] firebase-admin initialised");
    return cachedMessaging;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[push] firebase-admin init failed:", msg);
    cachedMessaging = null;
    cachedApp = null;
    return null;
  }
}

function buildMulticast(tokens: string[], payload: DriverPushPayload): MulticastMessage {
  const data: Record<string, string> = { kind: payload.kind };
  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      if (v !== undefined && v !== null) data[k] = String(v);
    }
  }
  return {
    tokens,
    notification: { title: payload.title, body: payload.body },
    data,
    android: {
      priority: "high",
      notification: { channelId: "driver-default", sound: "default" },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default", contentAvailable: true } },
    },
  };
}

// Only prune tokens FCM definitively says are dead. Do NOT prune on
// invalid-argument (which can be triggered by a bad payload, not a bad token)
// or by transient errors — that risks deleting healthy tokens.
const PRUNE_CODES = new Set<string>([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export interface SendResult {
  sent: number;
  pruned: number;
  failed: number;
  skipped?: "messaging-disabled" | "no-tokens" | "error";
}

export async function sendToDriver(driverAccountId: number, payload: DriverPushPayload): Promise<SendResult> {
  try {
    // Persist into the in-app inbox regardless of FCM delivery outcome —
    // drivers should still see assignment / route-change / cancelled / reorder
    // alerts even if FCM is unconfigured, the device has no token, or the
    // OS dropped the banner. Inbox writes never block the send.
    await storage.createDriverNotification({
      driverAccountId,
      kind: payload.kind,
      title: payload.title ?? "",
      body: payload.body ?? "",
      data: (payload.data ?? {}) as Record<string, unknown>,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[push] failed to persist inbox row:", msg);
    });

    const messaging = await getMessaging();
    if (!messaging) return { sent: 0, pruned: 0, failed: 0, skipped: "messaging-disabled" };

    const tokens = await storage.listDriverPushTokens(driverAccountId);
    if (tokens.length === 0) return { sent: 0, pruned: 0, failed: 0, skipped: "no-tokens" };

    const tokenValues = tokens.map((t) => t.token);
    const result = await messaging.sendEachForMulticast(buildMulticast(tokenValues, payload));

    let pruned = 0;
    if (result.failureCount > 0) {
      for (let i = 0; i < result.responses.length; i++) {
        const r = result.responses[i];
        if (r.success) continue;
        const code = r.error?.code ?? "";
        if (PRUNE_CODES.has(code)) {
          await storage.removeDriverPushTokensByValue(tokenValues[i]).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[push] failed to prune token:", msg);
          });
          pruned++;
        } else if (code) {
          console.warn(`[push] non-fatal send error (${code}) for driver ${driverAccountId}`);
        }
      }
    }
    return { sent: result.successCount, pruned, failed: result.failureCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[push] sendToDriver failed:", msg);
    return { sent: 0, pruned: 0, failed: 0, skipped: "error" };
  }
}

export async function sendToDriverByName(driverName: string, payload: DriverPushPayload): Promise<void> {
  if (!driverName) return;
  try {
    const account = await storage.getDriverAccountByName(driverName);
    if (!account) return;
    await sendToDriver(account.id, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[push] sendToDriverByName failed:", msg);
  }
}

export function isPushConfigured(): boolean {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return !!(raw && raw.trim().length > 0);
}
