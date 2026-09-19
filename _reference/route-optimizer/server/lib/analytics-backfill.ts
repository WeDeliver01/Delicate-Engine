import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";

// A minimal Drizzle executor (works for both `db` and a transaction `tx`).
type Executor = { execute: typeof db.execute };

interface ProjectShipment {
  id: string;
  wb: string;
  rate?: string | number | null;
  cogs?: string | number | null;
  status?: string | null;
  delDate?: string | Date | null;
  colDate?: string | Date | null;
  created?: string | Date | null;
}

interface ArchiveDriverSummary {
  driverId: string;
  driverName?: string;
  fuelCost?: string | number | null;
}

// Idempotent: matches/upserts on (waybill, driver_id, delivery_date)
// and (driver, source_archive_id) for expenses.

async function getOrCreateDriverByName(name: string, fleetId: string | undefined, exec: Executor = db): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  if (fleetId) {
    const r = await exec.execute<{ id: string }>(sql`SELECT id FROM drivers WHERE fleet_driver_id = ${fleetId} LIMIT 1`);
    const row = (r as { rows?: Array<{ id: string }> }).rows?.[0];
    if (row?.id) return row.id;
  }
  const existing = await exec.execute<{ id: string }>(sql`SELECT id FROM drivers WHERE LOWER(name) = LOWER(${trimmed}) LIMIT 1`);
  const row = (existing as { rows?: Array<{ id: string }> }).rows?.[0];
  if (row?.id) {
    if (fleetId) {
      await exec.execute(sql`UPDATE drivers SET fleet_driver_id = ${fleetId} WHERE id = ${row.id} AND fleet_driver_id IS NULL`);
    }
    return row.id;
  }
  const created = await exec.execute<{ id: string }>(sql`
    INSERT INTO drivers (name, fleet_driver_id, active) VALUES (${trimmed}, ${fleetId || null}, true)
    RETURNING id
  `);
  return (created as { rows?: Array<{ id: string }> }).rows?.[0]?.id || null;
}

function safeDate(s: unknown): Date | null {
  if (!s) return null;
  const t = typeof s === "string" ? Date.parse(s) : (s instanceof Date ? s.getTime() : NaN);
  if (!isFinite(t)) return null;
  return new Date(t);
}

// Money sanitiser. Preserves precision for string inputs (no Number coercion).
// For numeric JSON inputs we have no choice but to use String(n), but we never
// re-parse strings through Number — that would re-introduce float drift.
function toMoneyString(v: unknown): string {
  if (v == null) return "0";
  if (typeof v === "string") {
    const t = v.trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? t : "0";
  }
  if (typeof v === "number" && isFinite(v)) return String(v);
  return "0";
}
function toMoneyStringOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const t = v.trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? t : null;
  }
  if (typeof v === "number" && isFinite(v)) return String(v);
  return null;
}

function shipmentStatus(raw: string | null | undefined): string {
  if (!raw) return "delivered";
  const s = raw.toLowerCase();
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("return")) return "returned";
  if (s.includes("fail")) return "failed";
  if (s.includes("deliver")) return "delivered";
  return raw;
}

let lastBackfillAt = 0;
let runningBackfill: Promise<void> | null = null;

export async function runAnalyticsBackfill(opts?: { force?: boolean }): Promise<void> {
  const now = Date.now();
  if (!opts?.force && now - lastBackfillAt < 5 * 60 * 1000 && lastBackfillAt > 0) return;
  if (runningBackfill) return runningBackfill;
  runningBackfill = (async () => {
    try {
      console.log("[analytics-backfill] starting...");
      const projects = await storage.getProjects();
      let upserts = 0;
      for (const proj of projects) {
        const ships = (proj.shipments as ProjectShipment[] | null) || [];
        const assignments = (proj.assignments as Record<string, string>) || {};
        for (const s of ships) {
          const driverFleetId = assignments[s.id];
          if (!driverFleetId) continue;
          const driverId = await getOrCreateDriverByName(driverFleetId, driverFleetId);
          if (!driverId) continue;
          const dateRaw = s.delDate || s.colDate || s.created;
          const delDate = safeDate(dateRaw);
          if (!delDate) continue;
          const revenue = toMoneyString(s.rate);
          const cogs = toMoneyStringOrNull(s.cogs);
          const status = shipmentStatus(s.status);
          await db.execute(sql`
            INSERT INTO shipments_analytics (driver_id, waybill, delivery_date, revenue, cogs, currency, fx_rate_to_base, status, source_project_id)
            VALUES (${driverId}, ${s.wb}, ${delDate.toISOString()}, ${revenue}, ${cogs}, 'ZAR', '1', ${status}, ${proj.id})
            ON CONFLICT (waybill, driver_id, delivery_date) DO UPDATE
              SET revenue = EXCLUDED.revenue,
                  cogs = COALESCE(EXCLUDED.cogs, shipments_analytics.cogs),
                  status = EXCLUDED.status,
                  source_project_id = EXCLUDED.source_project_id
          `);
          upserts++;
        }
      }
      const archives = await storage.listArchives();
      for (const arc of archives) {
        const summaries = (arc.driverSummaries as ArchiveDriverSummary[] | null) || [];
        const arcShips = (arc.shipments as ProjectShipment[] | null) || [];
        const assignments = (arc.assignments as Record<string, string>) || {};
        const runDate = safeDate(arc.runDate) || safeDate(arc.createdAt) || new Date();
        for (const sum of summaries) {
          const driverId = await getOrCreateDriverByName(sum.driverName || sum.driverId, sum.driverId);
          if (!driverId) continue;
          if (sum.fuelCost && Number(sum.fuelCost) > 0) {
            await db.execute(sql`
              INSERT INTO expenses (driver_id, expense_type, amount, currency, fx_rate_to_base, incurred_at, notes, source_archive_id)
              SELECT ${driverId}, 'fuel', ${String(sum.fuelCost)}, 'ZAR', '1', ${runDate.toISOString()}, ${'archive ' + arc.name}, ${arc.id}
              WHERE NOT EXISTS (
                SELECT 1 FROM expenses
                WHERE driver_id = ${driverId} AND source_archive_id = ${arc.id} AND expense_type = 'fuel'
              )
            `);
          }
        }
        for (const s of arcShips) {
          const fleetId = assignments[s.id];
          if (!fleetId) continue;
          const driverId = await getOrCreateDriverByName(fleetId, fleetId);
          if (!driverId) continue;
          const delDate = safeDate(s.delDate || s.colDate || arc.runDate) || runDate;
          const revenue = toMoneyString(s.rate);
          const cogs = toMoneyStringOrNull(s.cogs);
          const status = shipmentStatus(s.status);
          await db.execute(sql`
            INSERT INTO shipments_analytics (driver_id, waybill, delivery_date, revenue, cogs, currency, fx_rate_to_base, status, source_archive_id)
            VALUES (${driverId}, ${s.wb}, ${delDate.toISOString()}, ${revenue}, ${cogs}, 'ZAR', '1', ${status}, ${arc.id})
            ON CONFLICT (waybill, driver_id, delivery_date) DO UPDATE
              SET revenue = EXCLUDED.revenue, cogs = COALESCE(EXCLUDED.cogs, shipments_analytics.cogs),
                  status = EXCLUDED.status, source_archive_id = EXCLUDED.source_archive_id
          `);
          upserts++;
        }
      }
      lastBackfillAt = Date.now();
      console.log(`[analytics-backfill] complete (~${upserts} shipment upserts)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[analytics-backfill] failed:", msg);
    } finally {
      runningBackfill = null;
    }
  })();
  return runningBackfill;
}

// Transactional sync for project edits. Accepts an optional executor (e.g. tx)
// so the analytics upsert can run in the same DB transaction as the operational
// write — rolling back together on failure.
export async function syncProjectToAnalytics(
  proj: { id: string; shipments?: unknown; assignments?: unknown },
  exec: Executor = db,
): Promise<void> {
  const ships = (Array.isArray(proj.shipments) ? proj.shipments : []) as ProjectShipment[];
  const assignments = (proj.assignments && typeof proj.assignments === "object" ? proj.assignments : {}) as Record<string, string>;
  for (const s of ships) {
    const fleetId = assignments[s.id];
    if (!fleetId) continue;
    const driverId = await getOrCreateDriverByName(fleetId, fleetId, exec);
    if (!driverId) continue;
    const delDate = safeDate(s.delDate || s.colDate || s.created);
    if (!delDate) continue;
    const revenue = toMoneyString(s.rate);
    const cogs = toMoneyStringOrNull(s.cogs);
    const status = shipmentStatus(s.status);
    await exec.execute(sql`
      INSERT INTO shipments_analytics (driver_id, waybill, delivery_date, revenue, cogs, currency, fx_rate_to_base, status, source_project_id)
      VALUES (${driverId}, ${s.wb}, ${delDate.toISOString()}, ${revenue}, ${cogs}, 'ZAR', '1', ${status}, ${proj.id})
      ON CONFLICT (waybill, driver_id, delivery_date) DO UPDATE
        SET revenue = EXCLUDED.revenue,
            cogs = COALESCE(EXCLUDED.cogs, shipments_analytics.cogs),
            status = EXCLUDED.status,
            source_project_id = EXCLUDED.source_project_id
    `);
  }
}

// Transactional sync for archive create/update. Mirrors the per-archive loop in
// runAnalyticsBackfill but operates on a single archive and accepts an optional
// executor so the analytics writes can run in the same DB transaction as the
// archive insert.
export async function syncArchiveToAnalytics(
  arc: {
    id: string;
    name: string;
    runDate?: string | Date | null;
    createdAt?: string | Date | null;
    shipments?: unknown;
    assignments?: unknown;
    driverSummaries?: unknown;
  },
  exec: Executor = db,
): Promise<void> {
  const summaries = (Array.isArray(arc.driverSummaries) ? arc.driverSummaries : []) as ArchiveDriverSummary[];
  const arcShips = (Array.isArray(arc.shipments) ? arc.shipments : []) as ProjectShipment[];
  const assignments = (arc.assignments && typeof arc.assignments === "object" ? arc.assignments : {}) as Record<string, string>;
  const runDate = safeDate(arc.runDate) || safeDate(arc.createdAt) || new Date();
  for (const sum of summaries) {
    const driverId = await getOrCreateDriverByName(sum.driverName || sum.driverId, sum.driverId, exec);
    if (!driverId) continue;
    if (sum.fuelCost && Number(sum.fuelCost) > 0) {
      await exec.execute(sql`
        INSERT INTO expenses (driver_id, expense_type, amount, currency, fx_rate_to_base, incurred_at, notes, source_archive_id)
        SELECT ${driverId}, 'fuel', ${String(sum.fuelCost)}, 'ZAR', '1', ${runDate.toISOString()}, ${'archive ' + arc.name}, ${arc.id}
        WHERE NOT EXISTS (
          SELECT 1 FROM expenses
          WHERE driver_id = ${driverId} AND source_archive_id = ${arc.id} AND expense_type = 'fuel'
        )
      `);
    }
  }
  for (const s of arcShips) {
    const fleetId = assignments[s.id];
    if (!fleetId) continue;
    const driverId = await getOrCreateDriverByName(fleetId, fleetId, exec);
    if (!driverId) continue;
    const delDate = safeDate(s.delDate || s.colDate || arc.runDate) || runDate;
    const revenue = toMoneyString(s.rate);
    const cogs = toMoneyStringOrNull(s.cogs);
    const status = shipmentStatus(s.status);
    await exec.execute(sql`
      INSERT INTO shipments_analytics (driver_id, waybill, delivery_date, revenue, cogs, currency, fx_rate_to_base, status, source_archive_id)
      VALUES (${driverId}, ${s.wb}, ${delDate.toISOString()}, ${revenue}, ${cogs}, 'ZAR', '1', ${status}, ${arc.id})
      ON CONFLICT (waybill, driver_id, delivery_date) DO UPDATE
        SET revenue = EXCLUDED.revenue, cogs = COALESCE(EXCLUDED.cogs, shipments_analytics.cogs),
            status = EXCLUDED.status, source_archive_id = EXCLUDED.source_archive_id
    `);
  }
}

// Hook to be called when shipment status updates in operational paths.
// Accepts an optional executor so it participates in an outer transaction.
export async function syncShipmentToAnalytics(args: {
  driverFleetId: string;
  shipment: {
    wb: string;
    rate: number | string | null | undefined;
    cogs?: number | string | null;
    status: string;
    delDate?: string | Date | null;
    colDate?: string | Date | null;
    created?: string | Date | null;
  };
  sourceProjectId?: string;
  sourceArchiveId?: string;
  exec?: Executor;
}) {
  const exec: Executor = args.exec || db;
  const driverId = await getOrCreateDriverByName(args.driverFleetId, args.driverFleetId, exec);
  if (!driverId) return;
  const date = safeDate(args.shipment.delDate || args.shipment.colDate || args.shipment.created);
  if (!date) return;
  const revenue = toMoneyString(args.shipment.rate);
  const cogs = toMoneyStringOrNull(args.shipment.cogs);
  const status = shipmentStatus(args.shipment.status);
  await exec.execute(sql`
    INSERT INTO shipments_analytics (driver_id, waybill, delivery_date, revenue, cogs, currency, fx_rate_to_base, status, source_project_id, source_archive_id)
    VALUES (${driverId}, ${args.shipment.wb}, ${date.toISOString()}, ${revenue}, ${cogs}, 'ZAR', '1', ${status}, ${args.sourceProjectId || null}, ${args.sourceArchiveId || null})
    ON CONFLICT (waybill, driver_id, delivery_date) DO UPDATE
      SET revenue = EXCLUDED.revenue,
          cogs = COALESCE(EXCLUDED.cogs, shipments_analytics.cogs),
          status = EXCLUDED.status,
          source_project_id = COALESCE(EXCLUDED.source_project_id, shipments_analytics.source_project_id),
          source_archive_id = COALESCE(EXCLUDED.source_archive_id, shipments_analytics.source_archive_id)
  `);
}
