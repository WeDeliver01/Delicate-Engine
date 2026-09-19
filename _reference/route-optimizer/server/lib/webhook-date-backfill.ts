// One-shot startup backfill: re-derive colDate/delDate for every
// webhook-sourced shipment using the EARLIEST stored webhook_events payload
// that actually carries ShipLogic estimated-window timestamps (the "quote"
// event is the only one that does — every later tracking event ships without
// those fields), and re-bucket any shipment that lives in the wrong
// "<date> Deliveries" project (or in the dispatcher "session" project) as a
// result of the old (broken) fallback-to-today behaviour. Also drops
// quote-only webhook shipments that should never have been imported (they
// are pre-confirmation price estimates from ShipLogic, not real bookings).
// Gated by an app_settings flag so it only runs once per database per
// version bump.
import { storage } from "../storage";
import { db } from "../db";
import { webhookEvents } from "@shared/schema";
import { eq, asc } from "drizzle-orm";
import { importShipmentFromWebhook, webhookDataToShipment } from "./webhook-import";

const FLAG_KEY = "webhook_date_backfill_v3_done";

function payloadHasEstimatedDates(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  return Boolean(
    payload.shipment_estimated_collection ||
    payload.shipment_estimated_delivery_from ||
    payload.shipment_estimated_delivery_to ||
    payload.shipment_estimated_delivery
  );
}

export async function runWebhookDateBackfillOnce(): Promise<void> {
  try {
    const flag = await storage.getAppSetting(FLAG_KEY);
    if (flag && (flag.value === true || (flag.value as any)?.done === true)) {
      return;
    }

    const projects = await storage.getProjects();
    const candidates: { waybill: string; currentProject: string; projectId: string; shipmentId: string; source: string; status: string }[] = [];
    for (const p of projects) {
      const ships = (p.shipments as any[]) || [];
      for (const s of ships) {
        const src = String(s.source || "");
        if (!src.includes("webhook")) continue;
        const wb = s.wb || s.id;
        if (wb) candidates.push({
          waybill: wb,
          currentProject: p.name,
          projectId: p.id,
          shipmentId: s.id,
          source: src,
          status: String(s.status || "").toLowerCase().trim(),
        });
      }
    }

    let rebucketed = 0;
    let unchanged = 0;
    let skipped = 0;
    let quoteDropped = 0;

    for (const cand of candidates) {
      const { waybill, currentProject, projectId, shipmentId, source, status } = cand;

      // Drop webhook-ONLY shipments still parked at status="quote" — these
      // were imported by the old code before we learned that ShipLogic
      // "quote" events are not real shipments.
      if (status === "quote" && !source.includes("csv")) {
        const proj = projects.find((p) => p.id === projectId);
        if (proj) {
          const ships = ((proj.shipments as any[]) || []).filter((s) => (s.wb || s.id) !== waybill);
          const asgn = { ...((proj.assignments || {}) as Record<string, string>) };
          delete asgn[shipmentId];
          const seqs = { ...((proj.driverStopSequences || {}) as Record<string, string[]>) };
          for (const dId of Object.keys(seqs)) seqs[dId] = (seqs[dId] || []).filter((id) => id !== shipmentId);
          const stops = { ...((proj.stopStatuses || {}) as Record<string, string>) };
          for (const k of Object.keys(stops)) {
            if (k === `C_${shipmentId}` || k === `D_${shipmentId}`) delete stops[k];
          }
          await storage.updateProject(projectId, {
            shipments: ships,
            assignments: asgn,
            driverStopSequences: seqs,
            stopStatuses: stops,
          });
          quoteDropped++;
          console.log(`[Backfill v3] Dropped quote-only ${waybill} from "${currentProject}"`);
        }
        continue;
      }

      // Pull the earliest event for this waybill that actually carries
      // estimated-date fields. If none does, leave the shipment alone —
      // we have no reliable way to re-derive the date.
      const events = await db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.waybill, waybill))
        .orderBy(asc(webhookEvents.receivedAt));
      const truthEvent = events.find((e) => payloadHasEstimatedDates(e.payload));
      if (!truthEvent) {
        skipped++;
        continue;
      }
      const truth = webhookDataToShipment(waybill, truthEvent.payload as any);
      if (!truth.delDate) {
        skipped++;
        continue;
      }

      // Replay the merge so the shipment lands in the right bucket. The
      // current shipment already has its real status/lifecycle data; the
      // merge layer will preserve that and only update the dates.
      const result = await importShipmentFromWebhook(waybill, truthEvent.payload as any);
      if (!result) {
        skipped++;
        continue;
      }
      if (result.projectName !== currentProject) {
        rebucketed++;
        console.log(`[Backfill v3] ${waybill}: "${currentProject}" -> "${result.projectName}" (truth delDate=${truth.delDate})`);
      } else {
        unchanged++;
      }
    }

    console.log(`[Backfill v3] Done. ${candidates.length} candidates: ${rebucketed} re-bucketed, ${unchanged} unchanged, ${skipped} skipped (no estimated-date event), ${quoteDropped} quote-only dropped.`);
    await storage.upsertAppSetting(FLAG_KEY, { done: true, ranAt: new Date().toISOString(), rebucketed, unchanged, skipped, quoteDropped, total: candidates.length });
  } catch (err: any) {
    console.error("[Backfill v3] Webhook date backfill failed:", err?.message || err);
  }
}
