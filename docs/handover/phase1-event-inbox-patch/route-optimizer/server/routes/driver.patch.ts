// ============================================================================
// PATCH: server/routes/driver.ts
// Emit DeliveryCompleted to the Financial Engine when a delivery stop is
// completed. Drop this into the existing stop-action handler.
// ============================================================================

// 1. Add to the imports at the top of the file (next to the crm-webhook import):
//
//    import { emitDeliveryCompleted } from "../lib/financial-events";

// 2. In the stop-action handler, the existing CRM block already computes
//    `crmStatus` via mapStopActionToCrmStatus(action, matchingStop.type) and
//    fires fireCrmWebhook(...). Immediately AFTER that fireCrmWebhook(...) call,
//    add the financial emit, gated on the "delivered" status so it only fires
//    once, on a completed delivery stop:

if (crmStatus === "delivered") {
  // `shipment` and `matchingStop` are already in scope from the CRM block above.
  // rate/cogs are stored as strings on the shipment; convert to integer cents.
  const rateRand = Number((shipment as { rate?: string | number | null } | undefined)?.rate ?? 0);
  const priceCents = Math.round(rateRand * 100);

  // distanceKm: prefer the optimizer's executed distance for this waybill if
  // available; otherwise fall back to 0 and let the engine reject/flag it.
  const distanceKm = Number(
    (shipment as { actualKm?: number | null; plannedKm?: number | null } | undefined)?.actualKm ??
      (shipment as { plannedKm?: number | null } | undefined)?.plannedKm ??
      0,
  );

  emitDeliveryCompleted({
    waybill,
    driverAccountId: req.driver!.driverAccountId,
    clientName:
      (shipment as { clientName?: string; senderName?: string } | undefined)?.clientName ??
      (shipment as { senderName?: string } | undefined)?.senderName ??
      "",
    priceCents,
    distanceKm,
    zone: (shipment as { zone?: string | null } | undefined)?.zone ?? null,
    customer: {
      lat: (shipment as { dLat?: number | null } | undefined)?.dLat ?? null,
      lng: (shipment as { dLng?: number | null } | undefined)?.dLng ?? null,
      address: (shipment as { dAddr?: string | null } | undefined)?.dAddr ?? null,
    },
  }).catch((err) => {
    console.error("[Financial Emit] fire-and-forget error:", err?.message ?? err);
  });
}

// That is the entire integration on the optimizer side. No queue, no schema
// change. The dedupe key is the waybill, so re-completing the same stop (or a
// webhook replay) settles exactly once on the engine.
