import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { requireDispatcherAuth } from "../middleware/dispatcher-auth";
import { calcDrive, currentTimeMinutes, fmM } from "../lib/geo";
import { isTwilioWhatsAppConfigured, sendWhatsAppMessage } from "../lib/twilio-service";

const router = Router();

const shipmentSseClients = new Set<Response>();

export function broadcastShipmentAlert(event: {
  type: string;
  alertId: string;
  waybill: string;
  recipientName: string;
  shipmentStatus: string;
  message: string;
}) {
  const data = JSON.stringify(event);
  for (const client of shipmentSseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      shipmentSseClients.delete(client);
    }
  }
}

router.get("/api/shipment-alerts/stream", requireDispatcherAuth, (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  shipmentSseClients.add(res);
  req.on("close", () => {
    shipmentSseClients.delete(res);
  });
});

router.get("/api/shipment-alerts", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const contactStatus = req.query.status as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const alerts = await storage.listShipmentAlerts(contactStatus, limit);
    res.json(alerts);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/api/shipment-alerts/webhook-config", requireDispatcherAuth, async (_req: Request, res: Response) => {
  try {
    let setting = await storage.getAppSetting("crm_webhook_secret");
    if (!setting) {
      const secret = crypto.randomBytes(32).toString("hex");
      await storage.upsertAppSetting("crm_webhook_secret", secret);
      setting = await storage.getAppSetting("crm_webhook_secret");
    }
    const secret = typeof setting!.value === "string" ? setting!.value : String(setting!.value);
    const redacted = "••••••••" + secret.slice(-8);
    res.json({
      webhookUrl: "/api/webhooks/shipment",
      hmacSecretRedacted: redacted,
      hmacSecretLength: secret.length,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/api/shipment-alerts/:id", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const alert = await storage.getShipmentAlert(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });

    const contactLogs = await storage.getContactLogsByAlert(alert.id);
    res.json({ ...alert, contactLogs });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.patch("/api/shipment-alerts/:id", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const { contactStatus, shipmentStatus, notes } = req.body;
    const updates: any = {};
    if (contactStatus) updates.contactStatus = contactStatus;
    if (shipmentStatus) updates.shipmentStatus = shipmentStatus;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No updates provided" });
    }

    const updated = await storage.updateShipmentAlert(req.params.id, updates);
    if (!updated) return res.status(404).json({ message: "Alert not found" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/api/shipment-alerts/:id/contact-log", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const alert = await storage.getShipmentAlert(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });

    const { contactMethod, outcome, notes } = req.body;
    if (!contactMethod || !outcome) {
      return res.status(400).json({ message: "contactMethod and outcome are required" });
    }

    let contactedBy = "Client Care";
    const sessionUserId = (req.session as any)?.userId;
    if (sessionUserId) {
      const user = await storage.getUser(sessionUserId);
      if (user) contactedBy = user.displayName || user.username;
    }

    const log = await storage.createContactLog({
      alertId: alert.id,
      contactedBy,
      contactMethod,
      outcome,
      notes: notes || "",
    });

    const newContactStatus = outcome === "reached-confirmed" || outcome === "alternative-receiver"
      ? "resolved"
      : "contacted";

    await storage.updateShipmentAlert(alert.id, { contactStatus: newContactStatus });

    res.status(201).json({ log, contactStatus: newContactStatus });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/api/shipment-alerts/:id/whatsapp", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    if (!isTwilioWhatsAppConfigured()) {
      return res.status(503).json({
        message: "WhatsApp messaging is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER (or override the sender with TWILIO_WHATSAPP_FROM).",
      });
    }

    const alert = await storage.getShipmentAlert(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });

    if (!alert.recipientPhone) {
      return res.status(400).json({ message: "Recipient has no phone number on file" });
    }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      return res.status(400).json({ message: "Message body is required" });
    }

    let contactedBy = "Client Care";
    const sessionUserId = (req.session as any)?.userId;
    if (sessionUserId) {
      const user = await storage.getUser(sessionUserId);
      if (user) contactedBy = user.displayName || user.username;
    }

    let sendResult;
    try {
      sendResult = await sendWhatsAppMessage(alert.recipientPhone, body);
    } catch (err: any) {
      console.error("[WhatsApp] Send failed for alert", alert.id, err?.message);
      return res.status(502).json({
        message: err?.message || "Failed to send WhatsApp message",
      });
    }

    const noteParts = [body, `[twilio sid: ${sendResult.sid} status: ${sendResult.status}]`];
    const log = await storage.createContactLog({
      alertId: alert.id,
      contactedBy,
      contactMethod: "whatsapp",
      outcome: "left-message",
      notes: noteParts.join("\n"),
    });

    const newContactStatus = "contacted";
    await storage.updateShipmentAlert(alert.id, { contactStatus: newContactStatus });

    res.status(201).json({
      log,
      contactStatus: newContactStatus,
      twilio: sendResult,
    });
  } catch (error: any) {
    console.error("[WhatsApp] Unexpected error:", error?.message);
    res.status(500).json({ message: error.message });
  }
});

router.delete("/api/shipment-alerts/:id", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await storage.deleteShipmentAlert(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Alert not found" });
    res.json({ deleted: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/api/shipment-alerts/:id/activity", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const alert = await storage.getShipmentAlert(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });

    const notifs = await storage.listNotificationsByWaybill(alert.waybill);
    res.json(notifs);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/api/shipment-alerts/:id/eta", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const alert = await storage.getShipmentAlert(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });

    let driverLat = alert.driverLat;
    let driverLng = alert.driverLng;

    if (alert.driverAccountId) {
      const driverAccount = await storage.getDriverAccount(alert.driverAccountId);
      if (driverAccount && driverAccount.isOnline && driverAccount.currentLat && driverAccount.currentLng) {
        driverLat = driverAccount.currentLat;
        driverLng = driverAccount.currentLng;
      }
    }

    if (!driverLat || !driverLng || !alert.deliveryLat || !alert.deliveryLng) {
      return res.json({
        etaMinutes: alert.etaMinutes,
        distanceKm: null,
        driverLat,
        driverLng,
        isLive: false,
        calculatedAt: new Date().toISOString(),
      });
    }

    const nowMin = currentTimeMinutes();
    const drive = calcDrive(
      { lat: driverLat, lng: driverLng },
      { lat: alert.deliveryLat, lng: alert.deliveryLng },
      nowMin
    );

    await storage.updateShipmentAlert(alert.id, {
      etaMinutes: Math.round(drive.min),
      driverLat,
      driverLng,
    });

    res.json({
      etaMinutes: Math.round(drive.min),
      etaFormatted: fmM(nowMin + drive.min),
      distanceKm: drive.km,
      driverLat,
      driverLng,
      deliveryLat: alert.deliveryLat,
      deliveryLng: alert.deliveryLng,
      isLive: !!alert.driverAccountId,
      calculatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/api/notifications/unread-count", requireDispatcherAuth, async (_req: Request, res: Response) => {
  try {
    const count = await storage.getUnreadCount("client_care");
    res.json({ count });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/api/notifications", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const notifs = await storage.listNotifications(limit, "client_care");
    res.json(notifs);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/api/notifications/:id/read", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    await storage.markNotificationRead(id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/api/notifications/read-all", requireDispatcherAuth, async (_req: Request, res: Response) => {
  try {
    await storage.markAllNotificationsRead("client_care");
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export async function ensureCrmWebhookSecret(): Promise<void> {
  try {
    const existing = await storage.getAppSetting("crm_webhook_secret");
    if (!existing) {
      const secret = crypto.randomBytes(32).toString("hex");
      await storage.upsertAppSetting("crm_webhook_secret", secret);
      console.log("[CRM] Webhook HMAC secret generated");
    }
  } catch (error: any) {
    console.error("[CRM] Error creating webhook secret:", error.message);
  }
}

export default router;
