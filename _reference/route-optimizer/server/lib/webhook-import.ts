import type { Shipment } from "@shared/schema";
import { storage } from "../storage";
import { haversine } from "./geo";
import { db } from "../db";
import { webhookEvents as webhookEventsTable } from "@shared/schema";
import { inArray, desc, sql } from "drizzle-orm";
import { rankShipmentStatus as rankStatus, mapShipLogicToShipmentStatus } from "@shared/status";

// Status precedence (rankStatus) keeps the most advanced lifecycle state when
// dedupe by waybill encounters duplicates of the same waybill at different
// stages. The rank table is the single source of truth in `@shared/status`.

// Date / window fields that should always come from the latest ShipLogic
// webhook payload — these are what the dispatcher gets wrong when its own
// in-memory state is older than the latest webhook delivery.
const WEBHOOK_DATE_FIELDS = ["colDate", "delDate", "cAfter", "dAfter", "dBefore", "lDelDate"] as const;

/**
 * Dedupe an array of shipments by waybill (keeping the row with the most
 * advanced status), and — for any shipment whose source includes "webhook" —
 * overwrite its date/window fields with values re-derived from the LATEST
 * webhook_events payload stored for that waybill. This makes the saved
 * webhook log the single source of truth for shipment dates, so a stale
 * dispatcher autosave cannot revive a wrong-bucket shipment.
 */
export async function dedupeAndEnrichShipmentsFromWebhooks(shipments: any[]): Promise<{ shipments: any[]; correctedWaybills: string[]; removedDuplicates: number; }> {
  if (!Array.isArray(shipments) || shipments.length === 0) {
    return { shipments: shipments || [], correctedWaybills: [], removedDuplicates: 0 };
  }
  // Dedupe by ANY shared reference (wb / id / trackingRef / customRef),
  // keeping the highest-rank status. Previously this only keyed by
  // `wb || id`, so two records describing the same parcel but stored
  // under different reference fields (one keyed by `tracking_reference`,
  // the other by `waybill`) would survive deduplication and appear as
  // separate shipments in the dispatcher count.
  type RefGroup = { canonical: any; refs: Set<string> };
  const groups: RefGroup[] = [];
  let removedDuplicates = 0;
  const collectRefs = (s: any): string[] =>
    [s?.wb, s?.id, s?.trackingRef, s?.customRef]
      .map((r) => (typeof r === "string" ? r.trim() : ""))
      .filter(Boolean);

  for (const s of shipments) {
    const refs = collectRefs(s);
    if (refs.length === 0) {
      // No identifiers at all — keep as-is, can't be a duplicate of anything.
      groups.push({ canonical: s, refs: new Set() });
      continue;
    }
    let target: RefGroup | null = null;
    for (const g of groups) {
      if (refs.some((r) => g.refs.has(r))) { target = g; break; }
    }
    if (!target) {
      groups.push({ canonical: s, refs: new Set(refs) });
      continue;
    }
    removedDuplicates++;
    if (rankStatus(s.status) >= rankStatus(target.canonical.status)) {
      target.canonical = s;
    }
    refs.forEach((r) => target!.refs.add(r));
  }
  const deduped = groups.map((g) => g.canonical);

  // Collect webhook-sourced waybills and batch-fetch the latest payload per waybill.
  const webhookWaybills = deduped
    .filter((s) => String(s.source || "").includes("webhook"))
    .map((s) => s.wb || s.id)
    .filter(Boolean);
  if (webhookWaybills.length === 0) {
    return { shipments: deduped, correctedWaybills: [], removedDuplicates };
  }
  const latestRows = await db.execute<{ waybill: string; payload: any }>(sql`
    SELECT DISTINCT ON (waybill) waybill, payload
    FROM ${webhookEventsTable}
    WHERE waybill IN (${sql.join(webhookWaybills.map((w) => sql`${w}`), sql`, `)})
    ORDER BY waybill, received_at DESC
  `);
  const latestByWb = new Map<string, any>();
  for (const r of (latestRows as any).rows || latestRows as any) {
    if (r && r.waybill) latestByWb.set(r.waybill, r.payload);
  }

  const correctedWaybills: string[] = [];
  for (const s of deduped) {
    const wb = s.wb || s.id;
    if (!String(s.source || "").includes("webhook")) continue;
    const payload = latestByWb.get(wb);
    if (!payload) continue;
    const truth = webhookDataToShipment(wb, payload);
    let changed = false;
    for (const f of WEBHOOK_DATE_FIELDS) {
      const incoming = (truth as any)[f];
      if (incoming == null || incoming === "") continue;
      if ((s as any)[f] !== incoming) {
        (s as any)[f] = incoming;
        changed = true;
      }
    }
    if (changed) correctedWaybills.push(wb);
  }

  return { shipments: deduped, correctedWaybills, removedDuplicates };
}

interface FleetDriver {
  id: string;
  name: string;
  color: string;
  icon: string;
  vehicle: string;
  plate: string;
  type: string;
  active: boolean;
  depotLat: number;
  depotLng: number;
  depot: string;
  shiftStart: string;
  shiftEnd: string;
  fuelPer100: number;
  odometer?: number;
}

function todayDateStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function projectNameForDate(dateStr: string): string {
  return `${dateStr} Deliveries`;
}

// ── ShipLogic timestamp parsing ────────────────────────────────────────────
// ShipLogic webhook payloads carry the actual scheduled collection/delivery
// windows as ISO 8601 timestamps (in +02:00 SAST), e.g.:
//   "shipment_estimated_collection":     "2026-05-23T08:00:00+02:00"
//   "shipment_estimated_delivery_from":  "2026-05-23T08:00:00+02:00"
//   "shipment_estimated_delivery_to":    "2026-05-23T09:00:00+02:00"
// We use these (not the time-the-webhook-fired and not shipment_time_created)
// to decide the date bucket and the cAfter/cBefore/dAfter/dBefore windows.
function sastDateFromIso(iso?: string | null): string {
  if (!iso || typeof iso !== "string") return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}
function sastTimeFromIso(iso?: string | null): string {
  if (!iso || typeof iso !== "string") return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function webhookDataToShipment(waybill: string, data: any): Shipment {
  const now = new Date().toISOString();
  const deliveryHub = data.delivery_hub || "";
  const dAddr = data.delivery_address || data.dAddr || "";
  const dSub = data.delivery_suburb || data.dSub || deliveryHub || "";
  const dCity = data.delivery_city || data.dCity || "";
  const dPostal = data.delivery_postal || data.dPostal || "";
  const dLat = data.delivery_lat ? Number(data.delivery_lat) : 0;
  const dLng = data.delivery_lng ? Number(data.delivery_lng) : 0;
  const dContact = data.delivery_contact || data.dContact || data.recipient_name || "";
  const dPhone = data.delivery_phone || data.dPhone || data.recipient_phone || "";
  const dEmail = data.delivery_email || data.dEmail || "";

  const cAddr = data.collection_address || data.cAddr || "";
  const cSub = data.collection_suburb || data.cSub || data.collection_hub || "";
  const cCity = data.collection_city || data.cCity || "";
  const cPostal = data.collection_postal || data.cPostal || "";
  const cLat = data.collection_lat ? Number(data.collection_lat) : 0;
  const cLng = data.collection_lng ? Number(data.collection_lng) : 0;
  const cContact = data.collection_contact || data.cContact || data.sender_name || "";
  const cPhone = data.collection_phone || data.cPhone || "";
  const cEmail = data.collection_email || data.cEmail || "";

  const pcs = data.num_parcels ? parseInt(data.num_parcels) || 1 : 1;
  const kg = data.charged_weight ? parseFloat(data.charged_weight) || 1 : 1;
  const svc = data.service_level || data.svc || "STD";
  const acc = data.account_code || data.acc || "";
  const clientName = data.client_name || data.clientName || "";
  const status = data.status || "booked";

  // Prefer the actual ShipLogic estimated-window timestamps so the shipment
  // lands in the correct date bucket (the day the parcel is scheduled to be
  // collected/delivered) instead of "today" (the day the webhook fired).
  const estColIso = data.shipment_estimated_collection || "";
  const estDelFromIso = data.shipment_estimated_delivery_from || "";
  const estDelToIso = data.shipment_estimated_delivery_to || data.shipment_estimated_delivery || "";

  // CRITICAL: ShipLogic only includes shipment_estimated_collection /
  // shipment_estimated_delivery_* on the initial "quote" event. Every later
  // tracking event (collected / out-for-delivery / delivered / etc.) ships
  // with those fields ABSENT. If we fell back to todayDateStr() here, every
  // status update for an old shipment would silently re-bucket that shipment
  // into today's date project. So we return "" when the payload has no
  // estimated dates and let the merge layer in importShipmentFromWebhook
  // preserve the existing date; the new-shipment path below applies
  // todayDateStr() as the final fallback only when creating a fresh record.
  const colDate = sastDateFromIso(estColIso)
    || (data.earliest_collection_date || data.collection_date || "").slice(0, 10)
    || "";
  const delDate = sastDateFromIso(estDelFromIso) || sastDateFromIso(estDelToIso)
    || (data.earliest_delivery_date || data.delivery_date || "").slice(0, 10)
    || "";

  const cAfter = sastTimeFromIso(estColIso) || data.collection_after || data.cAfter || "";
  const cBefore = data.collection_before || data.cBefore || "";
  const dAfter = sastTimeFromIso(estDelFromIso) || data.delivery_after || data.dAfter || "";
  const dBefore = sastTimeFromIso(estDelToIso) || data.delivery_before || data.dBefore || "";

  const trackingEvents = data.tracking_events || [];
  const webhookEvents = trackingEvents.map((ev: any) => ({
    timestamp: ev.date || ev.event_time || ev.time || now,
    status: ev.status || ev.event || "",
    source: "shiplogic",
    message: ev.description || ev.message || "",
  }));

  if (webhookEvents.length === 0 && data.status) {
    webhookEvents.push({
      timestamp: now,
      status: data.status,
      source: "shiplogic",
      message: "Initial webhook event",
    });
  }

  const id = waybill.replace(/[^A-Z0-9]/gi, "").slice(0, 8) + "W" + Date.now().toString(36).slice(-4);

  return {
    id,
    wb: waybill,
    acc,
    client: clientName || acc,
    pcs,
    kg,
    svc: svc.toUpperCase(),
    rate: 0,
    perish: true,
    cSub, cCity, cPostal, cAddr, cAfter, cBefore, cLat, cLng,
    cContact, cPhone, cEmail, iCol: "",
    dSub, dCity, dPostal, dAddr, dAfter, dBefore, dLat, dLng,
    dContact, dPhone, dEmail, iDel: "",
    zone: deliveryHub || dSub,
    tags: "",
    trackUrl: data.tracking_url || "",
    status,
    colDate,
    delDate,
    lDelDate: (data.latest_delivery_date || "").slice(0, 10) || "",
    created: todayDateStr(),
    preColDriver: "",
    preDelDriver: "",
    parcelType: data.package_type || data.parcel_type || "",
    parcelCategory: data.parcel_category || "",
    clientName,
    source: "webhook",
    webhookEvents,
  };
}

async function getActiveFleet(): Promise<FleetDriver[]> {
  const setting = await storage.getAppSetting("fleet");
  if (!setting) return [];
  const data = typeof setting.value === "string" ? JSON.parse(setting.value) : setting.value;
  const drivers: FleetDriver[] = (data as any)?.drivers || [];
  return drivers.filter((d) => d.active);
}

const LIVE_POS_FRESH_MS = 10 * 60 * 1000;

// Map each fleet driver id -> their LIVE GPS position, but only when the
// driver account is online and the fix is recent. Used so auto-assignment and
// initial stop ordering start from where the driver actually is, not the depot.
async function getLiveDriverPositions(
  fleet: FleetDriver[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const positions = new Map<string, { lat: number; lng: number }>();
  try {
    const accounts = await storage.getAllDriverAccounts();
    const byName = new Map<string, (typeof accounts)[number]>();
    for (const a of accounts) byName.set(a.driverName.toLowerCase().trim(), a);
    const now = Date.now();
    for (const d of fleet) {
      const acc = byName.get((d.name || "").toLowerCase().trim());
      if (!acc || !acc.isOnline) continue;
      if (acc.currentLat == null || acc.currentLng == null) continue;
      if (acc.currentLat === 0 && acc.currentLng === 0) continue;
      const updatedMs = acc.locationUpdatedAt ? new Date(acc.locationUpdatedAt).getTime() : 0;
      if (!updatedMs || now - updatedMs > LIVE_POS_FRESH_MS) continue;
      positions.set(d.id, { lat: acc.currentLat, lng: acc.currentLng });
    }
  } catch (err) {
    console.error("[Webhook Import] live-position lookup failed:", err instanceof Error ? err.message : err);
  }
  return positions;
}

function buildStopSequences(
  shipments: Shipment[],
  assignments: Record<string, string>,
  fleet: FleetDriver[],
  existingSeqs: Record<string, string[]>,
  livePositions?: Map<string, { lat: number; lng: number }>
): Record<string, string[]> {
  const seqs = { ...existingSeqs };
  const driverShips: Record<string, Shipment[]> = {};

  for (const d of fleet) {
    driverShips[d.id] = [];
  }

  for (const s of shipments) {
    const driverId = assignments[s.id];
    if (driverId && driverShips[driverId]) {
      driverShips[driverId].push(s);
    }
  }

  for (const d of fleet) {
    const dShips = driverShips[d.id];
    if (!dShips || dShips.length === 0) continue;

    const existingOrder = seqs[d.id] || [];
    const existingSet = new Set(existingOrder);
    const newShips = dShips.filter((s) => !existingSet.has(s.id));

    if (newShips.length === 0) continue;

    // Origin for nearest-first ordering: the driver's LIVE position when fresh,
    // otherwise the depot. (Stops already in the existing order still anchor to
    // the last queued stop.)
    const origin = livePositions?.get(d.id) || { lat: d.depotLat || 0, lng: d.depotLng || 0 };
    const lastStop = existingOrder.length > 0
      ? (() => {
          const lastId = existingOrder[existingOrder.length - 1];
          const lastShip = dShips.find((s) => s.id === lastId);
          return lastShip ? { lat: lastShip.dLat || 0, lng: lastShip.dLng || 0 } : origin;
        })()
      : origin;

    const sorted = [...newShips].sort((a, b) => {
      const distA = haversine(lastStop, { lat: a.dLat || 0, lng: a.dLng || 0 });
      const distB = haversine(lastStop, { lat: b.dLat || 0, lng: b.dLng || 0 });
      return distA - distB;
    });

    seqs[d.id] = [...existingOrder, ...sorted.map((s) => s.id)];
  }

  return seqs;
}

function greedyAssign(
  shipments: Shipment[],
  fleet: FleetDriver[],
  existingAsgn: Record<string, string>,
  livePositions?: Map<string, { lat: number; lng: number }>
): Record<string, string> {
  if (!fleet.length || !shipments.length) return existingAsgn;

  const asgn = { ...existingAsgn };
  const loads: Record<string, number> = {};
  fleet.forEach((d) => { loads[d.id] = 0; });

  for (const sid of Object.values(asgn)) {
    if (loads[sid] !== undefined) loads[sid]++;
  }

  const unassigned = shipments.filter((s) => !asgn[s.id]);
  if (!unassigned.length) return asgn;

  const targetPer = Math.max(1, Math.ceil(shipments.length / fleet.length));

  for (const s of unassigned) {
    let bestD: string | null = null;
    let bestScore = Infinity;

    for (const d of fleet) {
      // Score from the driver's LIVE position when we have a fresh fix,
      // otherwise fall back to the depot — so a new shipment goes to whoever
      // is actually closest right now, not whoever parks nearest at base.
      const origin = livePositions?.get(d.id) || (d.depotLat && d.depotLng ? { lat: d.depotLat, lng: d.depotLng } : null);
      if (!origin) continue;
      const km = haversine(
        origin,
        { lat: s.dLat || s.cLat, lng: s.dLng || s.cLng }
      );
      const overPen = loads[d.id] >= targetPer ? 30 : 0;
      const emptyBonus = loads[d.id] === 0 ? -20 : 0;
      const score = km + overPen + emptyBonus;
      if (score < bestScore) { bestScore = score; bestD = d.id; }
    }

    if (!bestD) bestD = fleet[0].id;
    asgn[s.id] = bestD;
    loads[bestD]++;
  }

  return asgn;
}

// Fields the booking-platform webhook owns. We merge these in from the
// incoming payload onto an existing record, preferring webhook values when
// present. Dispatcher-edited fields (preColDriver, preDelDriver, tags, iCol,
// iDel local notes, rate, perish) are NOT in this list and stay untouched.
const WEBHOOK_OWNED_FIELDS = [
  "dContact", "dPhone", "dEmail", "dAddr", "dSub", "dCity", "dPostal", "dLat", "dLng", "dAfter", "dBefore",
  "cContact", "cPhone", "cEmail", "cAddr", "cSub", "cCity", "cPostal", "cLat", "cLng", "cAfter", "cBefore",
  "svc", "pcs", "kg", "colDate", "delDate", "lDelDate",
  "clientName", "parcelType", "parcelCategory", "trackUrl",
] as const;

function mergeSource(existing: string | undefined, incoming: string): string {
  if (!existing) return incoming;
  const parts = new Set(existing.split("+").map((p) => p.trim()).filter(Boolean));
  parts.add(incoming);
  return Array.from(parts).join("+");
}

export async function importShipmentFromWebhook(
  waybill: string,
  webhookData: any
): Promise<{ created: boolean; updatedExisting?: boolean; mergedFields?: string[]; projectId: string; projectName: string; shipment: Shipment } | null> {
  try {
    const allProjects = await storage.getProjects();

    // FIX: previously this matched only `s.wb === waybill || s.id === waybill`,
    // while handleTrackingEvent matches on wb, id, trackingRef, customRef AND
    // the alt-waybill. That asymmetry meant: when the status-update path
    // returned processed:false (e.g. the payload had a waybill but no status,
    // or simply didn't match any project), the fallback import would also
    // fail to find the existing shipment and would create a duplicate in a
    // brand-new date-bucket project — bloating today's count and orphaning
    // future webhook events to the wrong project. Mirror the broader matching.
    const altWaybill: string = webhookData?.custom_tracking_reference
      || webhookData?.short_tracking_reference
      || webhookData?.tracking_reference
      || webhookData?.waybill_number
      || "";
    const refs = new Set<string>([waybill, altWaybill].filter(Boolean));
    const shipMatches = (s: any): boolean => {
      const wb = s?.wb || "";
      const sId = s?.id || "";
      const sRef = s?.trackingRef || s?.customRef || "";
      return (
        (wb && refs.has(wb)) ||
        (sId && refs.has(sId)) ||
        (sRef && refs.has(sRef))
      );
    };

    for (const proj of allProjects) {
      const shipments = (proj.shipments as any[]) || [];
      const existing = shipments.find(shipMatches);
      if (existing) {
        // Build the "what the webhook says" shipment from incoming payload,
        // then layer only its non-empty webhook-owned fields onto the existing
        // record. Local/dispatcher-edited fields (driver assignment, sequence,
        // manual notes, rate, perish) are preserved.
        const incoming = webhookDataToShipment(waybill, webhookData);
        const events = Array.isArray(existing.webhookEvents) ? [...existing.webhookEvents] : [];
        const rawStatus = webhookData.status || webhookData.event_status || webhookData.tracking_status || "";
        // Canonicalise the free-text ShipLogic status before ranking/storing so
        // variant casing/wording (e.g. "Out For Delivery") maps onto the shared
        // lifecycle vocabulary and can't bypass precedence. Fall back to the raw
        // value when there's no lifecycle signal (the rank table already knows
        // booked/submitted/quote). Raw text is still recorded in the event log.
        const newStatus = mapShipLogicToShipmentStatus(rawStatus) ?? rawStatus;
        const merged: any = { ...existing };
        const changedFields: string[] = [];

        for (const field of WEBHOOK_OWNED_FIELDS) {
          const v = (incoming as any)[field];
          if (v == null) continue;
          if (typeof v === "string" && v.trim() === "") continue;
          if (typeof v === "number" && v === 0) continue;
          if (merged[field] !== v) {
            merged[field] = v;
            changedFields.push(field);
          }
        }

        if (newStatus) {
          events.push({
            timestamp: new Date().toISOString(),
            status: rawStatus,
            source: "shiplogic",
            message: webhookData.description || webhookData.message || "",
          });
          // FIX: never let an out-of-order webhook downgrade the status.
          // ShipLogic occasionally redelivers earlier-stage events (quote,
          // submitted, collected) after a more-advanced one has already
          // landed (delivered, out-for-delivery). Without this guard a late
          // "quote" event would clobber a "delivered" status and put the
          // row back on the live dashboard. Always pick the higher-ranked.
          if (rankStatus(newStatus) > rankStatus(merged.status) && merged.status !== newStatus) {
            merged.status = newStatus;
            changedFields.push("status");
          } else if (!merged.status && newStatus) {
            merged.status = newStatus;
            changedFields.push("status");
          }
        }
        merged.webhookEvents = events;
        merged.source = mergeSource(existing.source, "webhook");
        if (merged.source !== existing.source) changedFields.push("source");

        // If the merged delDate now maps to a different project bucket, move
        // the shipment to the correct date project (creating it if missing)
        // and remove it from the source project. Preserves the driver
        // assignment and any stop status that was already recorded.
        const targetBucketName = projectNameForDate(merged.delDate || todayDateStr());
        const needsRebucket = targetBucketName !== proj.name;

        if (needsRebucket) {
          const sourceShipments = shipments.filter((s: any) => !shipMatches(s));
          const sourceAsgn = { ...((proj.assignments || {}) as Record<string, string>) };
          const assignedDriver = sourceAsgn[existing.id];
          delete sourceAsgn[existing.id];
          const sourceSeqs = { ...((proj.driverStopSequences || {}) as Record<string, string[]>) };
          for (const dId of Object.keys(sourceSeqs)) {
            sourceSeqs[dId] = (sourceSeqs[dId] || []).filter((id) => id !== existing.id);
          }
          const sourceStopStatuses = { ...((proj.stopStatuses || {}) as Record<string, string>) };
          const carriedStopStatuses: Record<string, string> = {};
          for (const k of Object.keys(sourceStopStatuses)) {
            if (k === `C_${existing.id}` || k === `D_${existing.id}`) {
              carriedStopStatuses[k] = sourceStopStatuses[k];
              delete sourceStopStatuses[k];
            }
          }

          await storage.updateProject(proj.id, {
            shipments: sourceShipments,
            assignments: sourceAsgn,
            driverStopSequences: sourceSeqs,
            stopStatuses: sourceStopStatuses,
          });

          const targetProject = allProjects.find((p) => p.name === targetBucketName);
          const fleet = await getActiveFleet();
          const livePositions = await getLiveDriverPositions(fleet);
          if (targetProject) {
            const targetShipments = [...(((targetProject.shipments as any[]) || [])), merged];
            const targetAsgnExisting = { ...((targetProject.assignments || {}) as Record<string, string>) };
            if (assignedDriver) targetAsgnExisting[merged.id] = assignedDriver;
            const targetAsgn = greedyAssign(targetShipments, fleet, targetAsgnExisting, livePositions);
            const targetSeqs = buildStopSequences(targetShipments, targetAsgn, fleet, ((targetProject.driverStopSequences as Record<string, string[]>) || {}), livePositions);
            const targetStopStatuses = { ...((targetProject.stopStatuses || {}) as Record<string, string>), ...carriedStopStatuses };
            await storage.updateProject(targetProject.id, {
              shipments: targetShipments,
              assignments: targetAsgn,
              driverStopSequences: targetSeqs,
              stopStatuses: targetStopStatuses,
            });
            console.log(`[Webhook Import] Re-bucketed ${waybill} from "${proj.name}" -> "${targetBucketName}" (delDate=${merged.delDate})`);
            return {
              created: false,
              updatedExisting: true,
              mergedFields: [...changedFields, "_rebucketed"],
              projectId: targetProject.id,
              projectName: targetProject.name,
              shipment: merged,
            };
          } else {
            const initialAsgn: Record<string, string> = {};
            if (assignedDriver) initialAsgn[merged.id] = assignedDriver;
            const asgn = greedyAssign([merged], fleet, initialAsgn, livePositions);
            const seqs = buildStopSequences([merged], asgn, fleet, {}, livePositions);
            const tripStatuses: Record<string, string> = {};
            fleet.forEach((d) => { tripStatuses[d.id] = "DRAFT"; });
            const createdProj = await storage.createProject({
              name: targetBucketName,
              shipments: [merged],
              assignments: asgn,
              tripStatuses,
              stopStatuses: carriedStopStatuses,
              stopNotes: {},
              driverStopSequences: seqs,
            });
            console.log(`[Webhook Import] Re-bucketed ${waybill} from "${proj.name}" -> NEW "${targetBucketName}" (delDate=${merged.delDate})`);
            return {
              created: false,
              updatedExisting: true,
              mergedFields: [...changedFields, "_rebucketed"],
              projectId: createdProj.id,
              projectName: createdProj.name,
              shipment: merged,
            };
          }
        }

        if (changedFields.length > 0 || events.length !== (existing.webhookEvents?.length || 0)) {
          const updatedShipments = shipments.map((s: any) =>
            shipMatches(s) ? merged : s
          );
          await storage.updateProject(proj.id, { shipments: updatedShipments });
        }
        return {
          created: false,
          updatedExisting: true,
          mergedFields: changedFields,
          projectId: proj.id,
          projectName: proj.name,
          shipment: merged,
        };
      }
    }

    // ShipLogic "quote" events are pre-confirmation price estimates — they
    // are not real shipments yet and should not create a project bucket. The
    // shipment will be created when ShipLogic emits the first real
    // "submitted" / "collection-assigned" event.
    const incomingStatus = String(webhookData.status || "").toLowerCase().trim();
    if (incomingStatus === "quote") {
      console.log(`[Webhook Import] Skipping quote-only event for ${waybill} — no real shipment to create yet`);
      return null;
    }

    const shipment = webhookDataToShipment(waybill, webhookData);

    // This is the only place we fall back to today: a genuinely new shipment
    // arrived with no estimated dates in its payload. Existing shipments are
    // handled by the merge path above which preserves their stored dates.
    if (!shipment.delDate) shipment.delDate = todayDateStr();
    if (!shipment.colDate) shipment.colDate = shipment.delDate;

    const deliveryDate = shipment.delDate;
    const projectName = projectNameForDate(deliveryDate);

    let project = allProjects.find((p) => p.name === projectName);
    let projectId: string;

    if (project) {
      projectId = project.id;
      const currentShipments = (project.shipments as any[]) || [];
      currentShipments.push(shipment);

      const fleet = await getActiveFleet();
      const livePositions = await getLiveDriverPositions(fleet);
      const currentAsgn = (project.assignments as Record<string, string>) || {};
      const newAsgn = greedyAssign(currentShipments, fleet, currentAsgn, livePositions);
      const existingSeqs = (project.driverStopSequences as Record<string, string[]>) || {};
      const newSeqs = buildStopSequences(currentShipments, newAsgn, fleet, existingSeqs, livePositions);

      await storage.updateProject(projectId, {
        shipments: currentShipments,
        assignments: newAsgn,
        driverStopSequences: newSeqs,
      });

      console.log(`[Webhook Import] Added ${waybill} to existing project "${projectName}" (${currentShipments.length} shipments, assigned to ${newAsgn[shipment.id] || "—"})`);
    } else {
      const fleet = await getActiveFleet();
      const livePositions = await getLiveDriverPositions(fleet);
      const asgn = greedyAssign([shipment], fleet, {}, livePositions);
      const seqs = buildStopSequences([shipment], asgn, fleet, {}, livePositions);
      const tripStatuses: Record<string, string> = {};
      fleet.forEach((d) => { tripStatuses[d.id] = "DRAFT"; });

      const created = await storage.createProject({
        name: projectName,
        shipments: [shipment],
        assignments: asgn,
        tripStatuses,
        stopStatuses: {},
        stopNotes: {},
        driverStopSequences: seqs,
      });
      projectId = created.id;

      console.log(`[Webhook Import] Created project "${projectName}" with ${waybill} (assigned to ${asgn[shipment.id] || "—"})`);
    }

    return { created: true, projectId, projectName, shipment };
  } catch (err: any) {
    console.error("[Webhook Import] Error:", err.message);
    return null;
  }
}
