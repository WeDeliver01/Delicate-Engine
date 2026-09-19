import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { requireDispatcherAuth } from "../middleware/dispatcher-auth";
import { calcDrive, currentTimeMinutes } from "../lib/geo";
import { broadcastShipmentAlert } from "./shipment-alerts";
import { fireCrmWebhook } from "../lib/crm-webhook";
import { importShipmentFromWebhook } from "../lib/webhook-import";
import { syncShipmentToAnalytics } from "../lib/analytics-backfill";
import crypto from "crypto";
import { publicUrl, rewriteIfLegacyReplitUrl } from "../lib/public-url";
import { rankShipmentStatus, mapShipLogicToShipmentStatus } from "@shared/status";

const router = Router();

const sseClients = new Set<Response>();

export function broadcastWebhookEvent(event: { topic: string; waybill?: string; processed?: boolean; decision?: string; error?: string | null; message?: string; updatedShipment?: Record<string, any>; projectId?: string; shipmentId?: string; deliveryOverride?: { dAfter?: string; dBefore?: string; setAt?: string; setBy?: string } | null; stopStatusesPatch?: Record<string, string>; assignments?: Record<string, string> }) {
  const data = JSON.stringify(event);
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

const DEFAULT_CLIENTS: Record<string, string> = {
  BBN001: "Baked By Nataleen",
  HBB001: "Honey Bee Baker",
  LEO001: "Leona's Cakery",
  FAH001: "Fahima's Kitchen",
  DAN001: "Boma Meat Deli",
  SWE001: "Sweet Thymes",
};

export async function seedClientAccounts() {
  try {
    for (const [code, name] of Object.entries(DEFAULT_CLIENTS)) {
      const existing = await storage.getClientAccountByCode(code);
      if (!existing) {
        await storage.createClientAccount({ accountCode: code, clientName: name, address: "" });
      }
    }
    console.log("[Webhooks] Client accounts seeded");
  } catch (error: any) {
    console.error("[Webhooks] Error seeding client accounts:", error.message);
  }
}

export async function ensureWebhookAuthKey() {
  try {
    const existing = await storage.getAppSetting("webhook_auth_key");
    if (!existing) {
      const key = crypto.randomBytes(32).toString("hex");
      await storage.upsertAppSetting("webhook_auth_key", key);
      console.log("[Webhooks] Auth key generated");
    }

    const defaultCrmUrl = publicUrl("/api/webhooks/shipment");
    const urlSetting = await storage.getAppSetting("crm_webhook_url");
    if (!urlSetting) {
      await storage.upsertAppSetting("crm_webhook_url", defaultCrmUrl);
      console.log(`[Webhooks] CRM webhook URL configured: ${defaultCrmUrl}`);
    } else {
      const currentValue = typeof urlSetting.value === "string" ? urlSetting.value : String(urlSetting.value ?? "");
      const rewritten = rewriteIfLegacyReplitUrl(currentValue);
      if (rewritten && rewritten !== currentValue) {
        await storage.upsertAppSetting("crm_webhook_url", rewritten);
        console.log(`[Webhooks] Migrated CRM webhook URL from ${currentValue} to ${rewritten}`);
      }
    }
  } catch (error: any) {
    console.error("[Webhooks] Error creating auth key:", error.message);
  }
}

async function validateWebhookAuth(req: Request): Promise<boolean> {
  const setting = await storage.getAppSetting("webhook_auth_key");
  if (!setting) return false;
  const rawStored = typeof setting.value === "string" ? setting.value : String(setting.value);
  const storedKey = rawStored.replace(/^"+|"+$/g, "").trim();

  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader).trim();
    if (token && token === storedKey) return true;
  }

  const queryKey = req.query.key || req.query.auth_key || req.query.token;
  if (queryKey) {
    if (String(queryKey).trim() === storedKey) return true;
  }

  return false;
}

function extractTopicFromBody(body: any): string {
  if (!body) return "";
  if (body.topic) return body.topic;
  if (body.event) return body.event;
  if (body.event_type) return body.event_type;
  if (body.type) return body.type;
  if (body.subscription_type) return body.subscription_type;
  if (body.update_type) {
    if (body.update_type === "tracking" || body.update_type === "shipment") return "shipment_tracking_event";
    return body.update_type;
  }
  if (body.tracking_events) return "shipment_tracking_event";
  if (body.status || body.tracking_status || body.event_status) return "shipment_tracking_event";
  if (body.data?.status || body.data?.tracking_status || body.data?.event_status) return "shipment_tracking_event";
  if (body.tracking_reference || body.short_tracking_reference || body.waybill_number || body.waybill) return "shipment_tracking_event";
  return "";
}

function extractWaybillFromBody(body: any): string {
  if (!body) return "";
  return body.waybill
    || body.short_tracking_reference
    || body.tracking_reference
    || body.custom_tracking_reference
    || body.waybill_number
    || body.reference
    || body.data?.waybill
    || body.data?.short_tracking_reference
    || body.data?.tracking_reference
    || body.data?.waybill_number
    || body.data?.reference
    || "";
}

function extractStatusFromShipLogicBody(body: any): string {
  if (body.tracking_events && Array.isArray(body.tracking_events) && body.tracking_events.length > 0) {
    const sorted = [...body.tracking_events].sort((a: any, b: any) => {
      const ta = a.event_time || a.time || "";
      const tb = b.event_time || b.time || "";
      return tb.localeCompare(ta);
    });
    return sorted[0].status || sorted[0].description || sorted[0].event || body.status || "";
  }
  return body.status || body.event_status || body.tracking_status || "";
}

router.post("/api/webhooks/shiplogic", async (req: Request, res: Response) => {
  const bodyKeys = req.body ? Object.keys(req.body) : [];
  const hasQueryKey = !!(req.query.key || req.query.auth_key || req.query.token);
  console.log(`[Webhook IN] Headers: content-type=${req.headers["content-type"]}, auth=${req.headers.authorization ? "present" : "none"}, query-key=${hasQueryKey}, body-keys=[${bodyKeys.join(",")}]`);
  console.log(`[Webhook IN] Body: ${JSON.stringify(req.body).slice(0, 500)}`);

  try {
    const isValid = await validateWebhookAuth(req);
    if (!isValid) {
      console.warn("[Webhook] Auth failed — logging payload for diagnostics");
      try {
        await storage.createWebhookEvent({
          topic: extractTopicFromBody(req.body) || "auth_failed",
          waybill: extractWaybillFromBody(req.body),
          payload: { body: req.body, headers: { contentType: req.headers["content-type"], hasAuth: !!req.headers.authorization } },
          processed: false,
          error: "Authentication failed: invalid or missing auth key",
        });
      } catch (_) {}
      return res.status(401).json({ message: "Invalid or missing auth key" });
    }

    const topic = extractTopicFromBody(req.body);
    const wb = extractWaybillFromBody(req.body);
    const extractedStatus = extractStatusFromShipLogicBody(req.body);
    const data = req.body?.data
      ? { ...req.body.data, status: req.body.data.status || extractedStatus }
      : { ...req.body, status: extractedStatus || req.body?.status };

    if (!topic) {
      console.warn(`[Webhook] No topic detected, body-keys=[${bodyKeys.join(",")}]`);
      try {
        await storage.createWebhookEvent({
          topic: "unrecognized",
          waybill: wb,
          payload: req.body || {},
          processed: false,
          error: `Could not detect topic. Body keys: [${bodyKeys.join(",")}]`,
        });
      } catch (_) {}
      return res.status(200).json({ received: true, processed: false, message: "Unrecognized payload format — logged for review" });
    }

    let processed = false;
    let error: string | undefined;
    let updatedShipment: Record<string, any> | undefined;
    let autoImported = false;

    try {
      const topicLower = topic.toLowerCase().replace(/[\s_-]+/g, "");
      let decision = "ignored";
      if (topicLower.includes("tracking") || topicLower.includes("shipmenttracking")) {
        const result = await handleTrackingEvent(wb, data);
        processed = result.processed;
        updatedShipment = result.updatedFields;
        if (processed) {
          decision = "status_updated";
          broadcastWebhookEvent({
            topic: "webhook_shipment_updated",
            waybill: wb,
            processed: true,
            decision,
            message: `Status update for ${wb}: ${(result.updatedFields as any)?.status || "(no status)"}`,
            updatedShipment: result.matchedShip
              ? { ...result.matchedShip, projectId: result.projectId, projectName: result.projectName }
              : undefined,
            projectId: result.projectId,
            stopStatusesPatch: result.stopStatusesPatch,
          });
        }

        if (!processed && wb) {
          const importResult = await importShipmentFromWebhook(wb, { ...req.body, ...data });
          if (importResult) {
            processed = true;
            if (importResult.created) {
              autoImported = true;
              decision = "created";
              updatedShipment = { id: importResult.shipment.id, wb: importResult.shipment.wb, source: "webhook" };
              broadcastWebhookEvent({
                topic: "webhook_shipment_created",
                waybill: wb,
                processed: true,
                decision,
                message: `New shipment ${wb} auto-imported to "${importResult.projectName}"`,
                updatedShipment: {
                  ...importResult.shipment,
                  projectId: importResult.projectId,
                  projectName: importResult.projectName,
                },
              });
              storage.createNotification({
                title: "New Webhook Shipment",
                message: `Waybill ${wb} auto-imported to "${importResult.projectName}"`,
                type: "shipment",
                targetRole: "dispatcher",
                waybill: wb,
              }).catch(() => {});
            } else if (importResult.updatedExisting) {
              decision = (importResult.mergedFields && importResult.mergedFields.length > 0)
                ? `merged: ${importResult.mergedFields.join(",")}`
                : "merged";
              updatedShipment = { status: importResult.shipment.status, mergedFields: importResult.mergedFields };
              broadcastWebhookEvent({
                topic: "webhook_shipment_updated",
                waybill: wb,
                processed: true,
                decision,
                message: `Merged webhook payload for ${wb} (${importResult.mergedFields?.length || 0} field(s))`,
                updatedShipment: {
                  ...importResult.shipment,
                  projectId: importResult.projectId,
                  projectName: importResult.projectName,
                },
              });
            }
          }
        }
      } else if (topicLower.includes("address")) {
        const result = await handleAddressChange(wb, data);
        processed = result.processed;
        updatedShipment = result.updatedFields;
        if (processed) {
          decision = "address_updated";
          broadcastWebhookEvent({
            topic: "webhook_shipment_updated",
            waybill: wb,
            processed: true,
            decision,
            message: `Address change applied for ${wb}`,
            updatedShipment: result.updatedFields,
          });
        }
      } else if (topicLower.includes("shipment") || topicLower.includes("newshipment") || topicLower.includes("created")) {
        if (wb) {
          const importResult = await importShipmentFromWebhook(wb, { ...req.body, ...data });
          if (importResult) {
            processed = true;
            if (importResult.created) {
              autoImported = true;
              decision = "created";
              updatedShipment = { id: importResult.shipment.id, wb: importResult.shipment.wb, source: "webhook" };
              broadcastWebhookEvent({
                topic: "webhook_shipment_created",
                waybill: wb,
                processed: true,
                decision,
                message: `New shipment ${wb} auto-imported to "${importResult.projectName}"`,
                updatedShipment: {
                  ...importResult.shipment,
                  projectId: importResult.projectId,
                  projectName: importResult.projectName,
                },
              });
              storage.createNotification({
                title: "New Webhook Shipment",
                message: `Waybill ${wb} auto-imported to "${importResult.projectName}"`,
                type: "shipment",
                targetRole: "dispatcher",
                waybill: wb,
              }).catch(() => {});
            } else if (importResult.updatedExisting) {
              decision = (importResult.mergedFields && importResult.mergedFields.length > 0)
                ? `merged: ${importResult.mergedFields.join(",")}`
                : "merged";
              updatedShipment = { status: importResult.shipment.status, mergedFields: importResult.mergedFields };
              broadcastWebhookEvent({
                topic: "webhook_shipment_updated",
                waybill: wb,
                processed: true,
                decision,
                message: `Merged webhook payload for ${wb} (${importResult.mergedFields?.length || 0} field(s))`,
                updatedShipment: {
                  ...importResult.shipment,
                  projectId: importResult.projectId,
                  projectName: importResult.projectName,
                },
              });
            }
          }
        }
      } else {
        processed = true;
      }

      // Stash decision on payload so the diagnostics view can show it.
      try {
        if (req.body && typeof req.body === "object") {
          (req.body as any)._decision = decision;
        }
      } catch (_) {}
    } catch (err: any) {
      error = err.message;
    }

    await storage.createWebhookEvent({
      topic,
      waybill: wb,
      payload: req.body,
      processed,
      error: error || null,
    });

    if (!autoImported) {
      const topicLabel = topic.toLowerCase().includes("tracking")
        ? "Status update" : topic.toLowerCase().includes("address")
        ? "Address change" : topic;
      broadcastWebhookEvent({
        topic,
        waybill: wb,
        processed,
        error,
        message: processed
          ? `${topicLabel} for waybill ${wb || "unknown"}`
          : `${topicLabel} received but not matched${error ? `: ${error}` : ""}`,
        updatedShipment: processed ? updatedShipment : undefined,
      });
    }

    console.log(`[Webhook] Processed: topic=${topic}, wb=${wb}, processed=${processed}, autoImported=${autoImported}${error ? `, error=${error}` : ""}`);

    res.json({ received: true, processed, waybill: wb, autoImported });
  } catch (error: any) {
    console.error("[Webhook] Error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

// Thin wrapper over the shared canonical mapper. The CRM/stop vocabulary the
// callers expect (collected / out-for-delivery / delivered / failed) is the same
// canonical shipment lifecycle, so delegate to the single source of truth.
function mapShipLogicStatusToCrm(status: string): string | null {
  return mapShipLogicToShipmentStatus(status);
}

function findShipmentAcrossProjects(
  waybill: string,
  altWaybill: string,
  projects: any[],
): { shipment: any; project: any } | null {
  for (const proj of projects) {
    const shipments = (proj.shipments as any[]) || [];
    for (const s of shipments) {
      const wb = s.wb || "";
      const sId = s.id || "";
      const sRef = s.trackingRef || s.customRef || "";
      if (wb === waybill || sId === waybill || wb === altWaybill || sId === altWaybill || sRef === waybill || sRef === altWaybill) {
        return { shipment: s, project: proj };
      }
    }
  }
  return null;
}

function findDriverForShipment(shipmentId: string, projects: any[]): string {
  for (const proj of projects) {
    const assignments = (proj.assignments || {}) as Record<string, string>;
    if (assignments[shipmentId]) return assignments[shipmentId];
  }
  return "";
}

async function createCrmAlertFromShipLogic(
  waybill: string,
  crmStatus: string,
  webhookData: any,
  allProjects: any[],
): Promise<void> {
  try {
    const altWaybill = webhookData?.custom_tracking_reference || webhookData?.short_tracking_reference || "";
    const match = findShipmentAcrossProjects(waybill, altWaybill, allProjects);
    const csvShipment = match?.shipment;
    const projectOverrides = (match?.project?.deliveryOverrides || {}) as Record<string, { dAfter?: string; dBefore?: string }>;
    const shipOverride = csvShipment?.id ? projectOverrides[csvShipment.id] : undefined;
    const effectiveDAfter = shipOverride?.dAfter ?? csvShipment?.dAfter ?? null;
    const effectiveDBefore = shipOverride?.dBefore ?? csvShipment?.dBefore ?? null;

    const recipientName = csvShipment?.dContact || "";
    const recipientPhone = csvShipment?.dPhone || "";
    const deliveryAddress = csvShipment?.dAddr
      || [csvShipment?.dSub, csvShipment?.dCity].filter(Boolean).join(", ")
      || webhookData?.delivery_hub || "";

    const deliveryLat = csvShipment?.dLat ? Number(csvShipment.dLat)
      : webhookData?.delivery_lat ? Number(webhookData.delivery_lat) : null;
    const deliveryLng = csvShipment?.dLng ? Number(csvShipment.dLng)
      : webhookData?.delivery_lng ? Number(webhookData.delivery_lng) : null;

    const shipmentId = csvShipment?.id || webhookData?.shipment_id?.toString() || waybill;
    let driverName = findDriverForShipment(shipmentId, allProjects);
    if (!driverName && csvShipment?.preDelDriver) driverName = csvShipment.preDelDriver;

    let driverLat: number | null = null;
    let driverLng: number | null = null;
    let driverAccountId: number | null = null;

    if (driverName) {
      const allDrivers = await storage.getAllDriverAccounts();
      const driverAccount = allDrivers.find(
        (d) => d.driverName.toLowerCase().trim() === driverName.toLowerCase().trim()
      );
      if (driverAccount) {
        driverAccountId = driverAccount.id;
        if (driverAccount.currentLat && driverAccount.currentLng) {
          driverLat = Number(driverAccount.currentLat);
          driverLng = Number(driverAccount.currentLng);
        }
      }
    }

    let etaMinutes: number | null = null;
    if (driverLat && driverLng && deliveryLat && deliveryLng) {
      const drive = calcDrive(
        { lat: driverLat, lng: driverLng },
        { lat: deliveryLat, lng: deliveryLng },
        currentTimeMinutes()
      );
      etaMinutes = Math.round(drive.min);
    }

    const existing = await storage.getLatestAlertByWaybill(waybill);

    if (existing && existing.shipmentStatus === crmStatus) {
      const needsUpdate = (!existing.recipientName && recipientName)
        || (!existing.driverName && driverName)
        || (!existing.deliveryLat && deliveryLat);
      if (!needsUpdate) {
        console.log(`[CRM ShipLogic] Duplicate ${crmStatus} event for ${waybill}, skipping`);
        return;
      }
    }

    let alert;
    if (existing) {
      alert = await storage.updateShipmentAlert(existing.id, {
        shipmentStatus: crmStatus,
        recipientName: recipientName || existing.recipientName,
        recipientPhone: recipientPhone || existing.recipientPhone,
        deliveryAddress: deliveryAddress || existing.deliveryAddress,
        driverName: driverName || existing.driverName,
        driverAccountId: driverAccountId ?? existing.driverAccountId,
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
        recipientName,
        recipientPhone,
        deliveryAddress,
        driverName,
        driverAccountId,
        shipmentStatus: crmStatus,
        etaMinutes,
        driverLat,
        driverLng,
        deliveryLat,
        deliveryLng,
        contactStatus: "pending-contact",
      });
    }

    const statusLabel = crmStatus === "collected" ? "Collected"
      : crmStatus === "out-for-delivery" ? "Out for Delivery"
      : crmStatus === "delivered" ? "Delivered"
      : "Failed";

    const notifType = crmStatus === "collected" ? "shipment_collected"
      : crmStatus === "out-for-delivery" ? "shipment_out_for_delivery"
      : crmStatus === "delivered" ? "shipment_delivered"
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
      recipientName,
      shipmentStatus: crmStatus,
      message: `${statusLabel}: ${waybill} — ${recipientName || "Recipient"}`,
    });

    fireCrmWebhook({
      waybill,
      recipientName,
      recipientPhone,
      deliveryAddress,
      driverAccountId: driverAccountId || 0,
      driverName,
      shipmentStatus: crmStatus,
      driverLat,
      driverLng,
      deliveryLat,
      deliveryLng,
      clientName: csvShipment?.clientName || csvShipment?.acc || "",
      senderName: csvShipment?.cContact || "",
      etaMinutes,
      requestedDeliveryAfter: effectiveDAfter,
      requestedDeliveryBefore: effectiveDBefore,
    }, { skipLocal: true }).catch((err) => {
      console.error("[CRM Webhook] Fire-and-forget from ShipLogic:", err.message);
    });

    console.log(`[CRM ShipLogic] ${statusLabel} alert created for ${waybill} (recipient=${recipientName || "—"}, driver=${driverName || "—"}, eta=${etaMinutes ?? "—"})`);
  } catch (err: any) {
    console.error("[CRM ShipLogic] Error creating alert:", err.message);
  }
}

async function handleTrackingEvent(waybill: string, data: any): Promise<{ processed: boolean; updatedFields?: Record<string, any>; projectId?: string; projectName?: string; matchedShip?: any; stopStatusesPatch?: Record<string, string> }> {
  if (!waybill) return { processed: false };

  const newStatus = data?.status || data?.event_status || data?.tracking_status || "";
  if (!newStatus) return { processed: false };

  const projects = await storage.getProjects();
  const sortedProjects = projects.sort((a, b) =>
    new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
  );

  const altWaybill = data?.custom_tracking_reference || data?.short_tracking_reference || "";
  const now = new Date().toISOString();

  // Status precedence so an out-of-order ShipLogic event (e.g. a late
  // "quote" or "submitted" event arriving after a "delivered" one) doesn't
  // downgrade what's already stored. Without this, the dispatcher's live
  // tile would silently put a delivered parcel back into "open" state.
  const rankStatusLocal = rankShipmentStatus;

  // Canonicalise the free-text ShipLogic status into the shared lifecycle
  // vocabulary BEFORE ranking/storing it. Otherwise free-text values like
  // "Out For Delivery" rank as 0 and could fail to advance a "booked"
  // shipment, and non-canonical strings would leak into the DB. Statuses with
  // no lifecycle signal (e.g. "booked"/"submitted"/"quote") fall back to the
  // raw value, which the rank map already understands. The raw value is still
  // recorded verbatim in each shipment's webhookEvents log for audit.
  const canonicalStatus = mapShipLogicToShipmentStatus(newStatus) ?? newStatus;

  // FIX: previously this loop broke on the first project containing the
  // waybill, which meant when the same parcel existed in multiple projects
  // (typically the dispatcher's "session" AND a webhook auto-created date
  // bucket like "2026-05-22 Deliveries"), only one of them got the status
  // update and the stop-status patch. The other was invisible to webhooks
  // forever — which is what caused delivered parcels to keep showing
  // "open" in the dispatcher view. Now we update every matching project.
  type Match = { proj: any; updatedShipments: any[]; matchedShip: any };
  const matches: Match[] = [];

  for (const proj of sortedProjects) {
    const shipments = (proj.shipments as any[]) || [];
    let projMatchedShip: any = null;
    const updated = shipments.map((s: any) => {
      const wb = s.wb || "";
      const sId = s.id || "";
      const sRef = s.trackingRef || s.customRef || "";
      if (wb === waybill || sId === waybill || wb === altWaybill || sId === altWaybill || sRef === waybill || sRef === altWaybill) {
        const events = Array.isArray(s.webhookEvents) ? [...s.webhookEvents] : [];
        events.push({
          timestamp: now,
          status: newStatus,
          source: "shiplogic",
          message: data?.description || "",
        });
        // Only adopt the new status if it ranks higher than what's stored.
        // The event history still records the late arrival so audits aren't
        // lost, but the row's status field stays at the highest-seen value.
        const adoptStatus = rankStatusLocal(canonicalStatus) >= rankStatusLocal(s.status);
        const next = adoptStatus
          ? { ...s, status: canonicalStatus, webhookEvents: events }
          : { ...s, webhookEvents: events };
        projMatchedShip = next;
        return next;
      }
      return s;
    });
    if (projMatchedShip) {
      matches.push({ proj, updatedShipments: updated, matchedShip: projMatchedShip });
    }
  }

  // matchedProject/matchedShip retain their pre-fix meaning for the return
  // contract: the FIRST (most recently-updated) project that matched. The
  // SSE broadcast already carries the patch and the dispatcher applies it
  // by checking which stop keys reference shipments it has loaded — so it
  // doesn't depend on which specific projectId we return here.
  const matchedProject = matches.length > 0 ? matches[0].proj : null;
  const matchedShip = matches.length > 0 ? matches[0].matchedShip : null;
  const updatedShipmentsForProject = matches.length > 0 ? matches[0].updatedShipments : [];

  let stopStatusesPatch: Record<string, string> | undefined;

  if (matches.length > 0) {
    // Mirror webhook-reported terminal statuses into every matching project's
    // stopStatuses so the dispatcher UI (trip cards, driver detail timeline,
    // shipments tab) reflects deliveries/collections as they happen — without
    // waiting for the driver to tap "complete" in the driver app. The
    // dispatcher reads stopSt[key] using uppercase "DONE"/"FAILED"/"PENDING".
    //
    // When the same parcel exists in more than one project (e.g. the
    // dispatcher's "session" project AND a webhook auto-created date-bucket
    // project), we now update both. The combined patch is also returned to
    // the SSE broadcast so the client can pick up whichever IDs it has
    // loaded locally.
    const crmForStops = mapShipLogicStatusToCrm(newStatus);
    const combinedPatch: Record<string, string> = {};

    for (const m of matches) {
      const projPatch: Record<string, string> = {};
      if (m.matchedShip && crmForStops) {
        // Resolve the grouped stop key (if any) within THIS project's
        // groupings. Groupings are per-project so we recompute for each.
        const groupingsByDriver = (m.proj.stopGroupings || {}) as Record<string, Array<{ ids: string[]; type: string }>>;
        let groupedCKey: string | null = null;
        let groupedDKey: string | null = null;
        for (const driverId of Object.keys(groupingsByDriver)) {
          for (const g of groupingsByDriver[driverId] || []) {
            if (!g?.ids?.includes(m.matchedShip.id)) continue;
            const key = `${g.type}_${[...g.ids].sort().join("_")}`;
            if (g.type === "C") groupedCKey = key;
            else if (g.type === "D") groupedDKey = key;
          }
        }
        if (crmForStops === "delivered") {
          projPatch[`D_${m.matchedShip.id}`] = "DONE";
          if (groupedDKey) projPatch[groupedDKey] = "DONE";
        } else if (crmForStops === "failed") {
          projPatch[`D_${m.matchedShip.id}`] = "FAILED";
          if (groupedDKey) projPatch[groupedDKey] = "FAILED";
        } else if (crmForStops === "collected") {
          projPatch[`C_${m.matchedShip.id}`] = "DONE";
          if (groupedCKey) projPatch[groupedCKey] = "DONE";
        }
      }

      if (Object.keys(projPatch).length > 0) {
        Object.assign(combinedPatch, projPatch);
        const existing = ((m.proj.stopStatuses || {}) as Record<string, string>);
        const merged = { ...existing, ...projPatch };
        await storage.updateProject(m.proj.id, {
          shipments: m.updatedShipments as any,
          stopStatuses: merged as any,
        });
      } else {
        await storage.updateProject(m.proj.id, { shipments: m.updatedShipments as any });
      }

      // Mirror booking-platform status into analytics for THIS project if
      // the shipment is assigned and ShipLogic reports a terminal status.
      const assignments = (m.proj.assignments || {}) as Record<string, string>;
      const fleetId = m.matchedShip ? assignments[m.matchedShip.id] : undefined;
      if (fleetId && m.matchedShip && (crmForStops === "delivered" || crmForStops === "failed")) {
        syncShipmentToAnalytics({
          driverFleetId: fleetId,
          shipment: {
            wb: m.matchedShip.wb,
            rate: m.matchedShip.rate,
            cogs: m.matchedShip.cogs,
            status: crmForStops,
            delDate: m.matchedShip.delDate,
            colDate: m.matchedShip.colDate,
            created: m.matchedShip.created,
          },
          sourceProjectId: m.proj.id,
        }).catch((err) => console.error("[Webhook→Analytics] sync failed:", err.message));
      }
    }

    if (Object.keys(combinedPatch).length > 0) {
      stopStatusesPatch = combinedPatch;
    }

    if (matches.length > 1) {
      console.log(`[Webhook] ${waybill}: updated ${matches.length} projects [${matches.map((m) => m.proj.name).join(", ")}]`);
    }
  }

  const crmStatus = mapShipLogicStatusToCrm(newStatus);
  if (crmStatus) {
    createCrmAlertFromShipLogic(waybill, crmStatus, data, sortedProjects).catch((err) => {
      console.error("[CRM ShipLogic] Fire-and-forget error:", err.message);
    });
  } else {
    console.log(`[CRM ShipLogic] Status "${newStatus}" did not map to a CRM status for ${waybill}`);
  }

  return matchedProject
    ? { processed: true, updatedFields: { status: matchedShip?.status || newStatus }, projectId: matchedProject.id, projectName: matchedProject.name, matchedShip, stopStatusesPatch }
    : { processed: false };
}

async function handleAddressChange(waybill: string, data: any): Promise<{ processed: boolean; updatedFields?: Record<string, any> }> {
  if (!waybill) return { processed: false };

  const projects = await storage.getProjects();
  const activeProject = projects.sort((a, b) =>
    new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
  )[0];
  if (!activeProject) return { processed: false };

  const shipments = (activeProject.shipments as any[]) || [];
  let changed = false;
  let appliedUpdates: Record<string, any> = {};

  const updatedShipments = shipments.map((s: any) => {
    if (s.wb === waybill) {
      const updates: any = {};

      if (data.collection_address || data.cAddr) updates.cAddr = data.collection_address || data.cAddr;
      if (data.collection_suburb || data.cSub) updates.cSub = data.collection_suburb || data.cSub;
      if (data.collection_city || data.cCity) updates.cCity = data.collection_city || data.cCity;
      if (data.collection_postal || data.cPostal) updates.cPostal = data.collection_postal || data.cPostal;
      if (data.collection_lat != null || data.cLat != null) updates.cLat = Number(data.collection_lat ?? data.cLat);
      if (data.collection_lng != null || data.cLng != null) updates.cLng = Number(data.collection_lng ?? data.cLng);

      if (data.delivery_address || data.dAddr) updates.dAddr = data.delivery_address || data.dAddr;
      if (data.delivery_suburb || data.dSub) updates.dSub = data.delivery_suburb || data.dSub;
      if (data.delivery_city || data.dCity) updates.dCity = data.delivery_city || data.dCity;
      if (data.delivery_postal || data.dPostal) updates.dPostal = data.delivery_postal || data.dPostal;
      if (data.delivery_lat != null || data.dLat != null) updates.dLat = Number(data.delivery_lat ?? data.dLat);
      if (data.delivery_lng != null || data.dLng != null) updates.dLng = Number(data.delivery_lng ?? data.dLng);

      if (Object.keys(updates).length > 0) {
        changed = true;
        appliedUpdates = updates;
        return { ...s, ...updates };
      }
    }
    return s;
  });

  if (changed) {
    await storage.updateProject(activeProject.id, { shipments: updatedShipments as any });
    return { processed: true, updatedFields: appliedUpdates };
  }

  return { processed: false };
}

router.get("/api/client-accounts", requireDispatcherAuth, async (_req: Request, res: Response) => {
  try {
    const accounts = await storage.listClientAccounts();
    res.json(accounts);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/api/client-accounts", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const { accountCode, clientName, address } = req.body;
    if (!accountCode || !clientName) {
      return res.status(400).json({ message: "Account code and client name are required" });
    }
    const existing = await storage.getClientAccountByCode(accountCode.trim().toUpperCase());
    if (existing) {
      return res.status(409).json({ message: "Account code already exists" });
    }
    const account = await storage.createClientAccount({
      accountCode: accountCode.trim().toUpperCase(),
      clientName: clientName.trim(),
      address: (address || "").trim(),
    });
    res.status(201).json(account);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.patch("/api/client-accounts/:id", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const { clientName, address, accountCode } = req.body;
    const updates: any = {};
    if (clientName !== undefined) updates.clientName = clientName.trim();
    if (address !== undefined) updates.address = (address || "").trim();
    if (accountCode !== undefined) updates.accountCode = accountCode.trim().toUpperCase();
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No updates provided" });
    }
    const updated = await storage.updateClientAccount(id, updates);
    if (!updated) return res.status(404).json({ message: "Account not found" });
    res.json(updated);
  } catch (error: any) {
    if (error.message?.includes("unique") || error.message?.includes("duplicate") || error.code === "23505") {
      return res.status(409).json({ message: "Account code already exists" });
    }
    res.status(500).json({ message: error.message });
  }
});

router.delete("/api/client-accounts/:id", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    await storage.deleteClientAccount(id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/api/webhooks/stream", requireDispatcherAuth, (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");
  sseClients.add(res);
  req.on("close", () => {
    sseClients.delete(res);
  });
});

router.post("/api/webhooks/shipment", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-hub-signature-256"] as string;
    const secret = process.env.SHIPMENT_WEBHOOK_SECRET;

    if (!secret) {
      console.error("[Shipment Webhook] SHIPMENT_WEBHOOK_SECRET not configured");
      return res.status(500).json({ message: "Webhook secret not configured" });
    }

    if (!signature) {
      console.warn("[Shipment Webhook] Missing HMAC signature");
      return res.status(401).json({ message: "Missing signature" });
    }

    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const sigValue = signature.startsWith("sha256=") ? signature : `sha256=${signature}`;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigValue))) {
      console.warn("[Shipment Webhook] HMAC signature mismatch");
      return res.status(401).json({ message: "Invalid signature" });
    }

    const body = req.body;

    if (body && body.event === "driver_position") {
      return handleDriverPositionEvent(body, res);
    }

    const waybill = body.waybillNumber || body.waybill;
    if (!waybill) {
      return res.status(400).json({ message: "Missing waybillNumber" });
    }
    const rawStatus = body.shipmentStatus || "";
    const normalized = rawStatus.toLowerCase().trim().replace(/[-_]/g, " ");

    let crmStatus: string;
    if (normalized.includes("collected") || normalized.includes("collection complete")) crmStatus = "collected";
    else if (normalized.includes("out for delivery") || normalized.includes("in transit") || normalized.includes("en route")) crmStatus = "out-for-delivery";
    else if (normalized.includes("delivered") || normalized.includes("proof of delivery")) crmStatus = "delivered";
    else if (normalized.includes("fail") || normalized.includes("return") || normalized.includes("exception")) crmStatus = "failed";
    else crmStatus = rawStatus;

    const deliveryLat = body.recipientLat ?? body.deliveryLat ?? null;
    const deliveryLng = body.recipientLng ?? body.deliveryLng ?? null;
    const driverLat = body.driverLat ?? null;
    const driverLng = body.driverLng ?? null;

    let etaMinutes: number | null = body.etaMinutes ?? null;
    if (!etaMinutes && driverLat && driverLng && deliveryLat && deliveryLng) {
      const drive = calcDrive(
        { lat: driverLat, lng: driverLng },
        { lat: deliveryLat, lng: deliveryLng },
        currentTimeMinutes()
      );
      etaMinutes = Math.round(drive.min);
    }

    const existing = await storage.getLatestAlertByWaybill(waybill);

    let alert;
    if (existing) {
      alert = await storage.updateShipmentAlert(existing.id, {
        shipmentStatus: crmStatus,
        recipientName: body.recipientName || existing.recipientName,
        recipientPhone: body.recipientPhone || existing.recipientPhone,
        deliveryAddress: body.deliveryAddress || existing.deliveryAddress,
        driverName: body.driverName || existing.driverName,
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
        recipientName: body.recipientName || "",
        recipientPhone: body.recipientPhone || "",
        deliveryAddress: body.deliveryAddress || "",
        driverName: body.driverName || "",
        driverAccountId: null,
        shipmentStatus: crmStatus,
        etaMinutes,
        driverLat,
        driverLng,
        deliveryLat,
        deliveryLng,
        contactStatus: "pending-contact",
      });
    }

    const statusLabel = crmStatus === "collected" ? "Collected"
      : crmStatus === "out-for-delivery" ? "Out for Delivery"
      : crmStatus === "delivered" ? "Delivered"
      : crmStatus === "failed" ? "Failed"
      : crmStatus;

    const notifType = crmStatus === "collected" ? "shipment_collected"
      : crmStatus === "out-for-delivery" ? "shipment_out_for_delivery"
      : crmStatus === "delivered" ? "shipment_delivered"
      : "shipment_failed";

    await storage.createNotification({
      type: notifType,
      title: `${statusLabel}: ${waybill}`,
      message: `${body.recipientName || "Recipient"} — ${body.deliveryAddress || "Address pending"}`,
      targetRole: "client_care",
      alertId: alert.id,
      waybill,
    });

    broadcastShipmentAlert({
      type: notifType,
      alertId: alert.id,
      waybill,
      recipientName: body.recipientName || "",
      shipmentStatus: crmStatus,
      message: `${statusLabel}: ${waybill} — ${body.recipientName || "Recipient"}`,
    });

    await storage.createWebhookEvent({
      topic: "shipment_status_update",
      waybill,
      payload: body,
      processed: true,
      error: null,
    });

    console.log(`[Shipment Webhook] ${statusLabel} alert for ${waybill} (driver=${body.driverName || "—"}, eta=${etaMinutes ?? "—"})`);

    res.json({ received: true, processed: true, waybill, alertId: alert.id });
  } catch (error: any) {
    console.error("[Shipment Webhook] Error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

async function handleDriverPositionEvent(body: any, res: Response): Promise<Response> {
  const driverAccountId = Number(body.driverAccountId);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(driverAccountId) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ message: "Missing or invalid driver position fields" });
  }

  const driverName = String(body.driverName || "");
  const recentSpeedKmh: number | null = typeof body.recentSpeedKmh === "number" ? body.recentSpeedKmh : null;
  const isMoving = !!body.isMoving;
  const isOnline = body.isOnline !== false;

  await storage.createWebhookEvent({
    topic: "driver_position",
    waybill: driverName || `driver:${driverAccountId}`,
    payload: body,
    processed: true,
    error: null,
  });

  const all = await storage.listShipmentAlerts(undefined, 200);
  const active = all.filter(
    (a) =>
      a.driverAccountId === driverAccountId &&
      (a.shipmentStatus === "collected" || a.shipmentStatus === "out-for-delivery"),
  );

  const updatedIds: string[] = [];
  for (const a of active) {
    let etaMinutes = a.etaMinutes ?? null;
    if (a.deliveryLat != null && a.deliveryLng != null) {
      const drive = calcDrive(
        { lat, lng },
        { lat: a.deliveryLat, lng: a.deliveryLng },
        currentTimeMinutes(),
        recentSpeedKmh,
      );
      etaMinutes = Math.round(drive.min);
    }
    await storage.updateShipmentAlert(a.id, {
      driverLat: lat,
      driverLng: lng,
      driverName: driverName || a.driverName,
      etaMinutes,
    });
    updatedIds.push(a.id);
  }

  broadcastShipmentAlert({
    type: "driver_position",
    alertId: 0,
    waybill: "",
    recipientName: "",
    shipmentStatus: "",
    message: `Driver ${driverName || driverAccountId} position update`,
    driverAccountId,
    driverName,
    lat,
    lng,
    isMoving,
    isOnline,
    recentSpeedKmh,
    nextStop: body.nextStop || null,
    updatedAlertIds: updatedIds,
    timestamp: body.timestamp || new Date().toISOString(),
  } as any);

  return res.json({
    received: true,
    event: "driver_position",
    updatedAlerts: updatedIds.length,
  });
}

router.get("/api/webhooks/events", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const events = await storage.listWebhookEvents(limit);
    res.json(events);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/api/webhooks/settings", requireDispatcherAuth, async (_req: Request, res: Response) => {
  try {
    const setting = await storage.getAppSetting("webhook_auth_key");
    const key = setting ? (typeof setting.value === "string" ? setting.value : String(setting.value)) : "";
    res.json({
      authKey: key,
      deliveryUrl: "/api/webhooks/shiplogic",
      topics: ["Shipment tracking event", "Shipment address changes"],
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/api/dispatch/driver-position-push/trigger", requireDispatcherAuth, async (_req: Request, res: Response) => {
  try {
    const { pushDriverPositionsOnce } = await import("../lib/driver-position-pusher");
    const result = await pushDriverPositionsOnce();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/api/webhooks/settings/regenerate-key", requireDispatcherAuth, async (_req: Request, res: Response) => {
  try {
    const key = crypto.randomBytes(32).toString("hex");
    await storage.upsertAppSetting("webhook_auth_key", key);
    res.json({ authKey: key });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
