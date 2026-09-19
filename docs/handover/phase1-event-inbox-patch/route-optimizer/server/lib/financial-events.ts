import crypto from "crypto";
import { randomUUID } from "crypto";
import { storage } from "../storage";

/**
 * Emits DeliveryCompleted to the Financial Engine when a delivery (D) stop is
 * completed. This is the operational -> financial seam: the optimizer owns
 * "what happened"; the engine turns it into money.
 *
 * Design rules honoured here:
 *   - Fire-and-forget. A financial emit failure must never block or fail the
 *     driver's stop action. The Financial Engine inbox is the durability layer.
 *   - Stable dedupe key. We key on the waybill, so however many times this
 *     fires for the same delivery, the engine settles once.
 *   - HMAC-signed body, identical scheme to the CRM webhook, verified by the
 *     engine's /api/events route.
 *   - Identity translation lives here. The engine only ever sees its own UUIDs.
 */

export interface DeliveryCompletedInput {
  waybill: string;
  driverAccountId: number;
  clientName: string;
  priceCents: number;
  distanceKm: number;
  zone?: string | null;
  customer?: { lat: number | null; lng: number | null; address?: string | null };
}

interface FinancialEnvelope {
  eventId: string;
  eventType: "DeliveryCompleted";
  eventVersion: number;
  source: "route-optimizer";
  dedupeKey: string;
  occurredAt: string;
  payload: {
    driverId: string;
    bakeryId: string;
    waybill: string;
    priceCents: number;
    distanceKm: number;
    zone: string | null;
    currency: string;
    customer?: { lat: number; lng: number; address?: string | null };
  };
}

/**
 * Translate optimizer identities to Financial Engine UUIDs. The maps live in
 * app_settings so ops can manage them without a deploy:
 *   financial_driver_map : { "<driverAccountId>": "<engine driver uuid>" }
 *   financial_bakery_map  : { "<clientName>": "<engine bakery uuid>" }
 *
 * Returns null if either side is unmapped, in which case we skip the emit and
 * log, rather than guessing.
 */
async function resolveFinancialIds(
  driverAccountId: number,
  clientName: string,
): Promise<{ driverId: string; bakeryId: string } | null> {
  const readMap = async (key: string): Promise<Record<string, string>> => {
    const setting = await storage.getAppSetting(key);
    if (!setting) return {};
    const raw = typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value);
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  };

  const [driverMap, bakeryMap] = await Promise.all([
    readMap("financial_driver_map"),
    readMap("financial_bakery_map"),
  ]);

  const driverId = driverMap[String(driverAccountId)];
  const bakeryId = bakeryMap[clientName];
  if (!driverId || !bakeryId) return null;
  return { driverId, bakeryId };
}

export async function emitDeliveryCompleted(input: DeliveryCompletedInput): Promise<void> {
  try {
    const baseUrlSetting = await storage.getAppSetting("financial_engine_url");
    const baseUrl =
      process.env.FINANCIAL_ENGINE_URL ||
      (baseUrlSetting
        ? (typeof baseUrlSetting.value === "string"
            ? baseUrlSetting.value
            : String(baseUrlSetting.value)
          ).replace(/^"+|"+$/g, "")
        : null);
    const secret = process.env.EVENTS_WEBHOOK_SECRET;

    if (!baseUrl) {
      console.warn("[Financial Emit] No financial_engine_url configured, skipping");
      return;
    }
    if (!secret) {
      console.warn("[Financial Emit] No EVENTS_WEBHOOK_SECRET, skipping");
      return;
    }

    const ids = await resolveFinancialIds(input.driverAccountId, input.clientName);
    if (!ids) {
      console.warn(
        `[Financial Emit] Unmapped driver/bakery (acct=${input.driverAccountId}, client=${input.clientName}), skipping ${input.waybill}`,
      );
      return;
    }

    const envelope: FinancialEnvelope = {
      eventId: randomUUID(),
      eventType: "DeliveryCompleted",
      eventVersion: 1,
      source: "route-optimizer",
      dedupeKey: `delivery:${input.waybill}`,
      occurredAt: new Date().toISOString(),
      payload: {
        driverId: ids.driverId,
        bakeryId: ids.bakeryId,
        waybill: input.waybill,
        priceCents: input.priceCents,
        distanceKm: input.distanceKm,
        zone: input.zone ?? null,
        currency: "ZAR",
        customer:
          input.customer && input.customer.lat != null && input.customer.lng != null
            ? {
                lat: input.customer.lat,
                lng: input.customer.lng,
                address: input.customer.address ?? null,
              }
            : undefined,
      },
    };

    const body = JSON.stringify(envelope);
    const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-delicate-signature": signature },
      body,
    });

    if (!response.ok) {
      console.error(`[Financial Emit] Engine returned ${response.status} for ${input.waybill}`);
    } else {
      console.log(`[Financial Emit] DeliveryCompleted sent for ${input.waybill}`);
    }
  } catch (error: any) {
    console.error("[Financial Emit] error:", error?.message ?? error);
  }
}
