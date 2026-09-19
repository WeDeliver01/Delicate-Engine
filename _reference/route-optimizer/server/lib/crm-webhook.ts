import crypto from "crypto";
import { storage } from "../storage";
import { calcDrive, currentTimeMinutes } from "./geo";
import { broadcastShipmentAlert } from "../routes/shipment-alerts";

export interface CrmWebhookPayload {
  waybill: string;
  recipientName: string;
  recipientPhone: string;
  deliveryAddress: string;
  driverAccountId: number;
  driverName: string;
  shipmentStatus: string;
  driverLat: number | null;
  driverLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  senderName?: string;
  clientName?: string;
  driverPhone?: string;
  priority?: string;
  etaMinutes?: number | null;
  requestedDeliveryAfter?: string | null;
  requestedDeliveryBefore?: string | null;
}

export interface ShipmentWebhookPayload {
  waybillNumber: string;
  shipmentStatus: string;
  recipientName: string;
  recipientPhone: string;
  deliveryAddress: string;
  senderName: string;
  clientName: string;
  driverName: string;
  driverPhone: string;
  driverLat: number | null;
  driverLng: number | null;
  recipientLat: number | null;
  recipientLng: number | null;
  priority: string;
  etaMinutes: number | null;
  requestedDeliveryAfter: string | null;
  requestedDeliveryBefore: string | null;
}

function buildOutboundPayload(payload: CrmWebhookPayload): ShipmentWebhookPayload {
  let etaMinutes = payload.etaMinutes ?? null;
  if (!etaMinutes && payload.driverLat && payload.driverLng && payload.deliveryLat && payload.deliveryLng) {
    const drive = calcDrive(
      { lat: payload.driverLat, lng: payload.driverLng },
      { lat: payload.deliveryLat, lng: payload.deliveryLng },
      currentTimeMinutes()
    );
    etaMinutes = Math.round(drive.min);
  }

  return {
    waybillNumber: payload.waybill,
    shipmentStatus: payload.shipmentStatus,
    recipientName: payload.recipientName || "",
    recipientPhone: payload.recipientPhone || "",
    deliveryAddress: payload.deliveryAddress || "",
    senderName: payload.senderName || payload.clientName || "",
    clientName: payload.clientName || payload.senderName || "",
    driverName: payload.driverName || "",
    driverPhone: payload.driverPhone || "",
    driverLat: payload.driverLat,
    driverLng: payload.driverLng,
    recipientLat: payload.deliveryLat,
    recipientLng: payload.deliveryLng,
    priority: payload.priority || "normal",
    etaMinutes,
    requestedDeliveryAfter: payload.requestedDeliveryAfter ?? null,
    requestedDeliveryBefore: payload.requestedDeliveryBefore ?? null,
  };
}

export async function fireCrmWebhook(payload: CrmWebhookPayload, options?: { skipLocal?: boolean }): Promise<void> {
  try {
    const secret = process.env.SHIPMENT_WEBHOOK_SECRET;
    const urlSetting = await storage.getAppSetting("crm_webhook_url");
    const webhookUrl = urlSetting
      ? (typeof urlSetting.value === "string" ? urlSetting.value : String(urlSetting.value)).replace(/^"+|"+$/g, "")
      : null;

    const hmacSecret = secret || await getDbSecret();

    const outbound = buildOutboundPayload(payload);
    const body = JSON.stringify(outbound);

    if (webhookUrl && hmacSecret) {
      const signature = crypto
        .createHmac("sha256", hmacSecret)
        .update(body)
        .digest("hex");

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": `sha256=${signature}`,
          "X-Signature": signature,
        },
        body,
      });

      if (!response.ok) {
        console.error(`[CRM Webhook] External endpoint returned ${response.status}`);
      } else {
        console.log(`[CRM Webhook] Dispatched ${payload.shipmentStatus} for ${payload.waybill} to ${webhookUrl}`);
      }
    } else if (!hmacSecret) {
      console.warn("[CRM Webhook] No SHIPMENT_WEBHOOK_SECRET env var or crm_webhook_secret — skipping external dispatch");
    }

    if (!options?.skipLocal) {
      await handleLocalCrmWebhook(payload);
    }
  } catch (error: any) {
    console.error("[CRM Webhook] Dispatch error:", error.message);
  }
}

async function getDbSecret(): Promise<string | null> {
  const setting = await storage.getAppSetting("crm_webhook_secret");
  if (!setting) return null;
  return (typeof setting.value === "string" ? setting.value : String(setting.value)).replace(/^"+|"+$/g, "");
}

async function handleLocalCrmWebhook(payload: CrmWebhookPayload): Promise<void> {
  const {
    waybill, recipientName, recipientPhone, deliveryAddress,
    driverAccountId, driverName, shipmentStatus,
    driverLat, driverLng, deliveryLat, deliveryLng,
  } = payload;

  const existing = await storage.getActiveAlertByWaybill(waybill);

  let etaMinutes: number | undefined;
  if (driverLat && driverLng && deliveryLat && deliveryLng) {
    const drive = calcDrive(
      { lat: driverLat, lng: driverLng },
      { lat: deliveryLat, lng: deliveryLng },
      currentTimeMinutes()
    );
    etaMinutes = Math.round(drive.min);
  }

  let alert;
  if (existing) {
    alert = await storage.updateShipmentAlert(existing.id, {
      shipmentStatus,
      recipientName: recipientName || existing.recipientName,
      recipientPhone: recipientPhone || existing.recipientPhone,
      deliveryAddress: deliveryAddress || existing.deliveryAddress,
      driverName: driverName || existing.driverName,
      driverAccountId: driverAccountId || existing.driverAccountId,
      driverLat: driverLat ?? existing.driverLat,
      driverLng: driverLng ?? existing.driverLng,
      deliveryLat: deliveryLat ?? existing.deliveryLat,
      deliveryLng: deliveryLng ?? existing.deliveryLng,
      etaMinutes: etaMinutes ?? existing.etaMinutes,
    });
    alert = alert || existing;
  } else {
    alert = await storage.createShipmentAlert({
      waybill,
      recipientName: recipientName || "",
      recipientPhone: recipientPhone || "",
      deliveryAddress: deliveryAddress || "",
      driverName: driverName || "",
      driverAccountId: driverAccountId || null,
      shipmentStatus: shipmentStatus || "collected",
      etaMinutes: etaMinutes ?? null,
      driverLat: driverLat ?? null,
      driverLng: driverLng ?? null,
      deliveryLat: deliveryLat ?? null,
      deliveryLng: deliveryLng ?? null,
      contactStatus: "pending-contact",
    });
  }

  const statusLabel = shipmentStatus === "collected" ? "Collected"
    : shipmentStatus === "out-for-delivery" ? "Out for Delivery"
    : shipmentStatus === "delivered" ? "Delivered"
    : "Failed";

  const notifType = shipmentStatus === "collected" ? "shipment_collected"
    : shipmentStatus === "out-for-delivery" ? "shipment_out_for_delivery"
    : shipmentStatus === "delivered" ? "shipment_delivered"
    : "shipment_failed";

  await storage.createNotification({
    type: notifType,
    title: `${statusLabel}: ${waybill}`,
    message: `${recipientName || "Recipient"} — ${deliveryAddress || "Address pending"}`,
    targetRole: "client_care",
    alertId: alert.id,
    waybill,
  });

  broadcastShipmentAlert({
    type: notifType,
    alertId: alert.id,
    waybill,
    recipientName: recipientName || "",
    shipmentStatus,
    message: `${statusLabel}: ${waybill} — ${recipientName || "Recipient"}`,
  });

  console.log(`[CRM Local] ${statusLabel} alert created/updated for ${waybill} (driver=${driverName || "—"}, eta=${etaMinutes ?? "—"})`);
}

export function mapStopActionToCrmStatus(
  action: string,
  stopType: string
): string | null {
  if (stopType === "C" && action === "arrive") return "collected";
  if (stopType === "C" && action === "complete") return "out-for-delivery";
  if (stopType === "D" && action === "arrive") return "out-for-delivery";
  if (stopType === "D" && action === "complete") return "delivered";
  if (stopType === "D" && action === "fail") return "failed";
  if (stopType === "C" && action === "fail") return "failed";
  return null;
}
