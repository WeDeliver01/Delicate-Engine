import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import type { AnalyticsActor } from "../middleware/analytics-auth";
import { dPct, dSub, dDiv, dAdd } from "./decimal";

export type AnalyticsPeriod = "7d" | "this_week" | "this_month" | "30d" | "ytd" | "12m" | "custom";

export interface PeriodWindow {
  startUtc: Date;
  endUtc: Date;
  bucket: "day" | "week" | "month";
  tz: string;
  label: string;
}

const DEFAULT_TZ = "UTC";

export async function getCompanyTimezone(): Promise<string> {
  try {
    const s = await storage.getAppSetting("company_timezone");
    if (s?.value) {
      const v = typeof s.value === "string" ? s.value : (s.value && typeof s.value === "object" ? (s.value as { tz?: string }).tz : undefined);
      if (typeof v === "string" && v.length > 0) return v;
    }
  } catch {}
  return DEFAULT_TZ;
}

export async function getBaseCurrency(): Promise<string> {
  try {
    const s = await storage.getAppSetting("base_currency");
    if (s?.value) {
      const v = typeof s.value === "string" ? s.value : (s.value && typeof s.value === "object" ? (s.value as { currency?: string }).currency : undefined);
      if (typeof v === "string" && v.length > 0) return v;
    }
  } catch {}
  return "ZAR";
}

function tzOffsetMinutes(date: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    let hour = Number(parts.hour);
    if (hour === 24) hour = 0;
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      hour, Number(parts.minute), Number(parts.second)
    );
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return 0;
  }
}

function tzStartOfDay(d: Date, tz: string): Date {
  const offset = tzOffsetMinutes(d, tz);
  const local = new Date(d.getTime() + offset * 60000);
  local.setUTCHours(0, 0, 0, 0);
  const offset2 = tzOffsetMinutes(local, tz);
  return new Date(local.getTime() - offset2 * 60000);
}

function tzAddDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseLocalDateInTz(dateStr: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return tzStartOfDay(new Date(dateStr), tz);
  const [, y, mo, d] = m;
  const utcGuess = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0));
  const offset = tzOffsetMinutes(utcGuess, tz);
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
  return new Date(naive - offset * 60000);
}

export function resolvePeriod(period: AnalyticsPeriod, tz: string, opts?: { start?: string; end?: string; now?: Date }): PeriodWindow {
  const now = opts?.now || new Date();
  let startUtc: Date;
  let endUtc: Date;
  let bucket: "day" | "week" | "month" = "day";
  let label = period as string;

  if (period === "custom" && opts?.start && opts?.end) {
    startUtc = parseLocalDateInTz(opts.start, tz);
    endUtc = tzAddDays(parseLocalDateInTz(opts.end, tz), 1);
    label = `${opts.start} to ${opts.end}`;
  } else if (period === "7d") {
    endUtc = tzStartOfDay(tzAddDays(now, 1), tz);
    startUtc = tzAddDays(endUtc, -7);
  } else if (period === "this_week") {
    const todayStart = tzStartOfDay(now, tz);
    const localOffset = tzOffsetMinutes(todayStart, tz);
    const localDate = new Date(todayStart.getTime() + localOffset * 60000);
    const dow = localDate.getUTCDay();
    const monOffset = dow === 0 ? -6 : 1 - dow;
    startUtc = tzAddDays(todayStart, monOffset);
    endUtc = tzStartOfDay(tzAddDays(now, 1), tz);
  } else if (period === "this_month") {
    const todayStart = tzStartOfDay(now, tz);
    const localOffset = tzOffsetMinutes(todayStart, tz);
    const localDate = new Date(todayStart.getTime() + localOffset * 60000);
    localDate.setUTCDate(1);
    startUtc = new Date(localDate.getTime() - tzOffsetMinutes(localDate, tz) * 60000);
    endUtc = tzStartOfDay(tzAddDays(now, 1), tz);
  } else if (period === "30d") {
    endUtc = tzStartOfDay(tzAddDays(now, 1), tz);
    startUtc = tzAddDays(endUtc, -30);
    bucket = "day";
  } else if (period === "ytd") {
    const todayStart = tzStartOfDay(now, tz);
    const localOffset = tzOffsetMinutes(todayStart, tz);
    const localDate = new Date(todayStart.getTime() + localOffset * 60000);
    localDate.setUTCMonth(0, 1);
    startUtc = new Date(localDate.getTime() - tzOffsetMinutes(localDate, tz) * 60000);
    endUtc = tzStartOfDay(tzAddDays(now, 1), tz);
    bucket = "month";
  } else if (period === "12m") {
    endUtc = tzStartOfDay(tzAddDays(now, 1), tz);
    const localOffset = tzOffsetMinutes(endUtc, tz);
    const localEnd = new Date(endUtc.getTime() + localOffset * 60000);
    localEnd.setUTCMonth(localEnd.getUTCMonth() - 12);
    startUtc = new Date(localEnd.getTime() - tzOffsetMinutes(localEnd, tz) * 60000);
    bucket = "month";
  } else {
    endUtc = tzStartOfDay(tzAddDays(now, 1), tz);
    startUtc = tzAddDays(endUtc, -7);
  }

  const days = (endUtc.getTime() - startUtc.getTime()) / 86400000;
  if (period !== "ytd" && period !== "12m") {
    if (days <= 14) bucket = "day";
    else if (days <= 90) bucket = "week";
    else bucket = "month";
  }

  return { startUtc, endUtc, bucket, tz, label };
}

const CANCELLED_STATUSES = ["cancelled", "canceled", "returned", "failed", "skip", "skipped"];

export interface AnalyticsKpis {
  totalDeliveries: number;
  cancelledCount: number;
  totalRevenueBase: string;
  totalCogsBase: string;
  totalExpensesBase: string;
  grossMarginBase: string;
  netMarginBase: string;
  grossMarginPct: string | null;
  netMarginPct: string | null;
  avgRevenuePerDelivery: string | null;
  missingCogsCount: number;
  missingExpensesCount: number;
  distanceKm: string;
  fuelLitres: string;
  fuelExpense: string;
  otherVehicleExpenses: string;
  vehicleExpenses: string;
  costPerKm: string | null;
  costPerDelivery: string | null;
  litresPer100Km: string | null;
  tripCount: number;
  closedTripCount: number;
  unverifiedTripCount: number;
  unverifiedFuelCount: number;
}

export interface ShipmentRow {
  id: string;
  waybill: string;
  deliveryDate: string;
  status: string;
  currency: string;
  revenue: string;
  cogs: string | null;
  expenses: string;
  revenueBase: string;
  cogsBase: string | null;
  expensesBase: string;
  grossMarginBase: string;
  netMarginBase: string;
  grossMarginPct: string | null;
  netMarginPct: string | null;
  fxRateToBase: string;
  missingCogs: boolean;
  missingExpenses: boolean;
  cancelled: boolean;
}

export interface TrendBucket {
  bucketStart: string;
  bucketEnd: string;
  deliveries: number;
  cancelled: number;
  revenueBase: string;
  cogsBase: string | null;
  expensesBase: string;
  netMarginBase: string;
  distanceKm: string;
  fuelExpense: string;
}

export interface AnalyticsResult {
  driverId: string | null;
  driverName: string | null;
  period: { type: AnalyticsPeriod; startUtc: string; endUtc: string; bucket: string; tz: string; label: string };
  baseCurrency: string;
  kpis: AnalyticsKpis;
  shipments: ShipmentRow[];
  shipmentsTotalCount: number;
  shipmentsPage: number;
  shipmentsPageSize: number;
  trend: TrendBucket[];
}

export interface AnalyticsPagination {
  page: number;
  pageSize: number;
}

export async function resolveDriverIdForActor(actor: AnalyticsActor): Promise<string | null> {
  if (actor.type !== "driver") return null;
  const accountId = Number(actor.id);
  if (!Number.isFinite(accountId)) return null;
  const rows = await db.execute<{ id: string }>(sql`SELECT id FROM drivers WHERE driver_account_id = ${accountId} LIMIT 1`);
  const row = rows.rows?.[0];
  if (row?.id) return row.id;
  const acc = await storage.getDriverAccount(accountId);
  if (!acc) return null;
  const created = await db.execute<{ id: string }>(sql`
    INSERT INTO drivers (name, driver_account_id, active)
    VALUES (${acc.driverName}, ${accountId}, true)
    ON CONFLICT (driver_account_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  return created.rows?.[0]?.id || null;
}

export async function listAnalyticsDrivers(): Promise<Array<{ id: string; name: string; active: boolean; employeeNumber: string }>> {
  const rows = await db.execute<{ id: string; name: string; active: boolean; employee_number: string | null }>(sql`
    SELECT id, name, active, employee_number FROM drivers ORDER BY active DESC, name ASC
  `);
  return (rows.rows || []).map((r) => ({ id: r.id, name: r.name, active: r.active, employeeNumber: r.employee_number || "" }));
}

export async function getDriverAnalytics(
  driverId: string,
  period: PeriodWindow,
  baseCurrency: string,
  paginate?: AnalyticsPagination,
): Promise<AnalyticsResult> {
  const startStr = period.startUtc.toISOString();
  const endStr = period.endUtc.toISOString();

  const drvRow = await db.execute<{ id: string; name: string; driver_account_id: number | null }>(sql`
    SELECT id, name, driver_account_id FROM drivers WHERE id = ${driverId} LIMIT 1
  `);
  const drv = drvRow.rows?.[0];
  const driverAccountId = drv?.driver_account_id != null ? Number(drv.driver_account_id) : null;

  type AggRow = {
    delivered_count: number; cancelled_count: number;
    missing_cogs_count: number; missing_expenses_count: number;
    total_revenue: string; total_cogs: string; total_expenses: string;
    [k: string]: unknown;
  };
  const aggRows = await db.execute<AggRow>(sql`
    WITH ship AS (
      SELECT id, waybill, delivery_date, status, currency, fx_rate_to_base,
             revenue, cogs,
             (revenue * fx_rate_to_base)::numeric(18,4) AS revenue_base,
             CASE WHEN cogs IS NULL THEN NULL ELSE (cogs * fx_rate_to_base)::numeric(18,4) END AS cogs_base
      FROM shipments_analytics
      WHERE driver_id = ${driverId}
        AND delivery_date >= ${startStr}
        AND delivery_date < ${endStr}
    ), exp AS (
      SELECT shipment_id, COALESCE(SUM(amount * fx_rate_to_base), 0)::numeric(18,4) AS amt
      FROM expenses
      WHERE driver_id = ${driverId}
        AND incurred_at >= ${startStr}
        AND incurred_at < ${endStr}
      GROUP BY shipment_id
    ), exp_total AS (
      SELECT COALESCE(SUM(amount * fx_rate_to_base), 0)::numeric(18,4) AS total
      FROM expenses
      WHERE driver_id = ${driverId}
        AND incurred_at >= ${startStr}
        AND incurred_at < ${endStr}
    )
    SELECT
      (SELECT COUNT(*) FROM ship WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped'))::int AS delivered_count,
      (SELECT COUNT(*) FROM ship WHERE LOWER(status) IN ('cancelled','canceled','returned','failed','skip','skipped'))::int AS cancelled_count,
      (SELECT COUNT(*) FROM ship WHERE cogs IS NULL AND LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped'))::int AS missing_cogs_count,
      (SELECT COUNT(*) FROM ship s2
        WHERE LOWER(s2.status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped')
          AND NOT EXISTS (SELECT 1 FROM exp e2 WHERE e2.shipment_id = s2.id))::int AS missing_expenses_count,
      (SELECT COALESCE(SUM(revenue_base), 0) FROM ship WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped'))::numeric(18,4) AS total_revenue,
      (SELECT COALESCE(SUM(cogs_base), 0) FROM ship WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped'))::numeric(18,4) AS total_cogs,
      (SELECT total FROM exp_total) AS total_expenses
  `);
  const agg: Partial<AggRow> = aggRows.rows?.[0] || {};

  type DetailRow = {
    id: string; waybill: string; delivery_date: Date | string;
    status: string; currency: string; fx_rate_to_base: string;
    revenue: string; cogs: string | null;
    revenue_base: string; cogs_base: string | null; expenses_base: string;
    [k: string]: unknown;
  };
  // Pagination — when caller passes `paginate`, return only the requested
  // page (server-side LIMIT/OFFSET) and report the full total count via a
  // separate COUNT(*) query. When `paginate` is omitted (export paths) the
  // full filtered detail set is returned with no LIMIT.
  const wantPage = paginate ? Math.max(1, Math.floor(paginate.page)) : 1;
  const wantPageSize = paginate ? Math.min(1000, Math.max(1, Math.floor(paginate.pageSize))) : 0;
  const offset = paginate ? (wantPage - 1) * wantPageSize : 0;

  const limitClause = paginate ? sql`LIMIT ${wantPageSize} OFFSET ${offset}` : sql``;
  const detailRows = await db.execute<DetailRow>(sql`
    SELECT s.id, s.waybill, s.delivery_date, s.status, s.currency, s.fx_rate_to_base,
           s.revenue, s.cogs,
           (s.revenue * s.fx_rate_to_base)::numeric(18,4) AS revenue_base,
           CASE WHEN s.cogs IS NULL THEN NULL ELSE (s.cogs * s.fx_rate_to_base)::numeric(18,4) END AS cogs_base,
           COALESCE(e.amt, 0)::numeric(18,4) AS expenses_base
    FROM shipments_analytics s
    LEFT JOIN (
      SELECT shipment_id, SUM(amount * fx_rate_to_base)::numeric(18,4) AS amt
      FROM expenses
      WHERE driver_id = ${driverId}
        AND incurred_at >= ${startStr}
        AND incurred_at < ${endStr}
      GROUP BY shipment_id
    ) e ON e.shipment_id = s.id
    WHERE s.driver_id = ${driverId}
      AND s.delivery_date >= ${startStr}
      AND s.delivery_date < ${endStr}
    ORDER BY s.delivery_date DESC
    ${limitClause}
  `);
  const details: DetailRow[] = detailRows.rows || [];

  let shipmentsTotalCount = details.length;
  if (paginate) {
    const cntRows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c FROM shipments_analytics
      WHERE driver_id = ${driverId}
        AND delivery_date >= ${startStr}
        AND delivery_date < ${endStr}
    `);
    shipmentsTotalCount = Number(cntRows.rows?.[0]?.c ?? 0);
  }

  const bucketTrunc = period.bucket === "day" ? "day" : period.bucket === "week" ? "week" : "month";
  type TrendRow = {
    bucket_start: string | Date;
    deliveries: number; cancelled: number;
    revenue_base: string; cogs_base: string | null;
    [k: string]: unknown;
  };
  const trendRows = await db.execute<TrendRow>(sql`
    SELECT date_trunc(${bucketTrunc}, delivery_date AT TIME ZONE ${period.tz}) AS bucket_start,
           COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped'))::int AS deliveries,
           COUNT(*) FILTER (WHERE LOWER(status) IN ('cancelled','canceled','returned','failed','skip','skipped'))::int AS cancelled,
           COALESCE(SUM((revenue * fx_rate_to_base)) FILTER (WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped')), 0)::numeric(18,4) AS revenue_base,
           SUM(cogs * fx_rate_to_base) FILTER (WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped'))::numeric(18,4) AS cogs_base
    FROM shipments_analytics
    WHERE driver_id = ${driverId}
      AND delivery_date >= ${startStr}
      AND delivery_date < ${endStr}
    GROUP BY 1
    ORDER BY 1
  `);
  const trendRaw: TrendRow[] = trendRows.rows || [];
  const bucketDays = period.bucket === "day" ? 1 : period.bucket === "week" ? 7 : 30;
  const trendMap = new Map<string, TrendBucket>();
  for (const r of trendRaw) {
    const bs = new Date(String(r.bucket_start));
    const be = new Date(bs.getTime() + bucketDays * 86400000);
    const rev = String(r.revenue_base ?? "0");
    const cogs = r.cogs_base == null ? null : String(r.cogs_base);
    const gross = cogs == null ? rev : dSub(rev, cogs);
    trendMap.set(bs.toISOString(), {
      bucketStart: bs.toISOString(),
      bucketEnd: be.toISOString(),
      deliveries: Number(r.deliveries ?? 0),
      cancelled: Number(r.cancelled ?? 0),
      revenueBase: rev,
      cogsBase: cogs,
      expensesBase: "0.0000",
      netMarginBase: gross,
      distanceKm: "0.0000",
      fuelExpense: "0.0000",
    });
  }

  type VehAggRow = {
    distance_km: string; fuel_litres: string;
    fuel_expense: string; other_vehicle_expense: string;
    trip_count: number; closed_trip_count: number;
    [k: string]: unknown;
  };
  let vehAgg: Partial<VehAggRow> = {};
  type VehTrendRow = {
    bucket_start: string | Date;
    distance_km: string;
    fuel_expense: string;
    [k: string]: unknown;
  };
  let vehTrendRaw: VehTrendRow[] = [];
  if (driverAccountId != null) {
    const vehAggRows = await db.execute<VehAggRow>(sql`
      WITH closed_trips AS (
        SELECT t.id AS trip_id,
               GREATEST(
                 0,
                 COALESCE(t.end_odometer::numeric, t.start_odometer::numeric) - t.start_odometer::numeric
               )::numeric(18,4) AS distance_km
        FROM driver_trips t
        WHERE t.driver_account_id = ${driverAccountId}
          AND t.status = 'closed'
          AND t.end_time IS NOT NULL
          AND t.end_time >= ${startStr}
          AND t.end_time < ${endStr}
      ),
      period_expenses AS (
        -- Fall back to the parent trip's driver_account_id when the
        -- expense row's own column is NULL (legacy data may not have it
        -- populated even though the schema now requires it).
        SELECT e.expense_type, e.amount, e.litres
        FROM driver_trip_expenses e
        LEFT JOIN driver_trips t ON t.id = e.trip_id
        WHERE COALESCE(e.driver_account_id, t.driver_account_id) = ${driverAccountId}
          AND e.incurred_at >= ${startStr}
          AND e.incurred_at < ${endStr}
      )
      SELECT
        COALESCE((SELECT SUM(distance_km) FROM closed_trips), 0)::numeric(18,4) AS distance_km,
        COALESCE((SELECT SUM(litres) FILTER (WHERE expense_type = 'fuel') FROM period_expenses), 0)::numeric(14,4) AS fuel_litres,
        COALESCE((SELECT SUM(amount) FILTER (WHERE expense_type = 'fuel') FROM period_expenses), 0)::numeric(18,4) AS fuel_expense,
        COALESCE((SELECT SUM(amount) FILTER (WHERE expense_type IN ('toll','service')) FROM period_expenses), 0)::numeric(18,4) AS other_vehicle_expense,
        (SELECT COUNT(*) FROM driver_trips
          WHERE driver_account_id = ${driverAccountId}
            AND start_time >= ${startStr}
            AND start_time < ${endStr})::int AS trip_count,
        (SELECT COUNT(*) FROM closed_trips)::int AS closed_trip_count,
        (SELECT COUNT(*) FROM driver_trips t
          WHERE t.driver_account_id = ${driverAccountId}
            AND t.status = 'closed'
            AND t.end_time IS NOT NULL
            AND t.end_time >= ${startStr}
            AND t.end_time < ${endStr}
            AND (
              t.start_cluster_photo IS NULL OR t.start_cluster_photo = ''
              OR t.end_cluster_photo IS NULL OR t.end_cluster_photo = ''
              OR (
                t.start_odometer_ocr IS NOT NULL
                AND t.start_odometer::numeric > 0
                AND ABS(t.start_odometer_ocr::numeric - t.start_odometer::numeric) / NULLIF(t.start_odometer::numeric, 0) > 0.05
              )
              OR (
                t.end_odometer_ocr IS NOT NULL
                AND t.end_odometer::numeric > 0
                AND ABS(t.end_odometer_ocr::numeric - t.end_odometer::numeric) / NULLIF(t.end_odometer::numeric, 0) > 0.05
              )
            ))::int AS unverified_trip_count,
        (SELECT COUNT(*) FROM driver_trip_expenses e
          LEFT JOIN driver_trips t ON t.id = e.trip_id
          WHERE COALESCE(e.driver_account_id, t.driver_account_id) = ${driverAccountId}
            AND e.expense_type = 'fuel'
            AND e.incurred_at >= ${startStr}
            AND e.incurred_at < ${endStr}
            AND (
              e.receipt_url IS NULL OR e.receipt_url = ''
              OR (
                e.ocr_amount IS NOT NULL
                AND e.amount::numeric > 0
                AND ABS(e.ocr_amount::numeric - e.amount::numeric) / NULLIF(e.amount::numeric, 0) > 0.1
              )
            ))::int AS unverified_fuel_count
    `);
    vehAgg = vehAggRows.rows?.[0] || {};

    const vehTrendRows = await db.execute<VehTrendRow>(sql`
      WITH ct AS (
        SELECT date_trunc(${bucketTrunc}, t.end_time AT TIME ZONE ${period.tz}) AS bucket_start,
               SUM(GREATEST(0,
                 COALESCE(t.end_odometer::numeric, t.start_odometer::numeric) - t.start_odometer::numeric
               ))::numeric(18,4) AS distance_km
        FROM driver_trips t
        WHERE t.driver_account_id = ${driverAccountId}
          AND t.status = 'closed'
          AND t.end_time IS NOT NULL
          AND t.end_time >= ${startStr}
          AND t.end_time < ${endStr}
        GROUP BY 1
      ),
      eb AS (
        SELECT date_trunc(${bucketTrunc}, e.incurred_at AT TIME ZONE ${period.tz}) AS bucket_start,
               COALESCE(SUM(e.amount) FILTER (WHERE e.expense_type = 'fuel'), 0)::numeric(18,4) AS fuel_expense
        FROM driver_trip_expenses e
        LEFT JOIN driver_trips t ON t.id = e.trip_id
        WHERE COALESCE(e.driver_account_id, t.driver_account_id) = ${driverAccountId}
          AND e.incurred_at >= ${startStr}
          AND e.incurred_at < ${endStr}
        GROUP BY 1
      )
      SELECT COALESCE(ct.bucket_start, eb.bucket_start) AS bucket_start,
             COALESCE(ct.distance_km, 0)::numeric(18,4) AS distance_km,
             COALESCE(eb.fuel_expense, 0)::numeric(18,4) AS fuel_expense
      FROM ct
      FULL OUTER JOIN eb USING (bucket_start)
      ORDER BY 1
    `);
    vehTrendRaw = vehTrendRows.rows || [];
  }

  for (const r of vehTrendRaw) {
    const bs = new Date(String(r.bucket_start));
    const key = bs.toISOString();
    const existing = trendMap.get(key);
    const distance = String(r.distance_km ?? "0");
    const fuel = String(r.fuel_expense ?? "0");
    if (existing) {
      existing.distanceKm = distance;
      existing.fuelExpense = fuel;
    } else {
      const be = new Date(bs.getTime() + bucketDays * 86400000);
      trendMap.set(key, {
        bucketStart: key,
        bucketEnd: be.toISOString(),
        deliveries: 0,
        cancelled: 0,
        revenueBase: "0.0000",
        cogsBase: null,
        expensesBase: "0.0000",
        netMarginBase: "0.0000",
        distanceKm: distance,
        fuelExpense: fuel,
      });
    }
  }
  const trend: TrendBucket[] = Array.from(trendMap.values()).sort((a, b) =>
    a.bucketStart.localeCompare(b.bucketStart),
  );

  const totalRevenue = String(agg.total_revenue || "0");
  const totalCogs = String(agg.total_cogs || "0");
  const shipmentExpenses = String(agg.total_expenses || "0");
  const distanceKm = String(vehAgg.distance_km || "0");
  const fuelLitres = String(vehAgg.fuel_litres || "0");
  const fuelExpense = String(vehAgg.fuel_expense || "0");
  const otherVehicleExpense = String(vehAgg.other_vehicle_expense || "0");
  const vehicleExpenses = dAdd(fuelExpense, otherVehicleExpense);
  const totalExpenses = dAdd(shipmentExpenses, vehicleExpenses);
  const gross = dSub(totalRevenue, totalCogs);
  const net = dSub(gross, totalExpenses);
  const deliveredCount = Number(agg.delivered_count || 0);
  const grossPct = dPct(gross, totalRevenue);
  const netPct = dPct(net, totalRevenue);
  const avgRevenue = deliveredCount > 0 ? dDiv(totalRevenue, deliveredCount) : null;
  const distNum = parseFloat(distanceKm);
  const costPerKm = distNum > 0 ? dDiv(totalExpenses, distanceKm) : null;
  const costPerDelivery = deliveredCount > 0 ? dDiv(totalExpenses, deliveredCount) : null;
  const litresPer100Km = distNum > 0 ? dDiv(fuelLitres, dDiv(distanceKm, "100")) : null;

  const shipments: ShipmentRow[] = details.map((r) => {
    const cancelled = CANCELLED_STATUSES.includes(String(r.status || "").toLowerCase());
    const revenueBase = String(r.revenue_base || "0");
    const cogsBase = r.cogs_base == null ? null : String(r.cogs_base);
    const expensesBase = String(r.expenses_base || "0");
    // Treat missing COGS as 0 for the underlying gross/net values so they
    // are internally consistent with the KPI aggregates (which also treat
    // NULL cogs as 0). The UI still renders "—" for the Gross column when
    // COGS is unknown, but Net Margin remains a meaningful number.
    const cogsForCalc = cogsBase ?? "0";
    const grossM = dSub(revenueBase, cogsForCalc);
    const netM = dSub(grossM, expensesBase);
    return {
      id: r.id,
      waybill: r.waybill,
      deliveryDate: new Date(r.delivery_date).toISOString(),
      status: r.status,
      currency: r.currency,
      revenue: String(r.revenue),
      cogs: r.cogs == null ? null : String(r.cogs),
      expenses: expensesBase,
      revenueBase,
      cogsBase,
      expensesBase,
      grossMarginBase: grossM,
      netMarginBase: netM,
      grossMarginPct: cogsBase == null ? null : dPct(grossM, revenueBase),
      netMarginPct: dPct(netM, revenueBase),
      fxRateToBase: String(r.fx_rate_to_base),
      missingCogs: r.cogs == null && !cancelled,
      missingExpenses: !cancelled && (Number(r.expenses_base) || 0) === 0,
      cancelled,
    };
  });

  return {
    driverId: drv?.id || driverId,
    driverName: drv?.name || null,
    period: {
      type: "custom",
      startUtc: period.startUtc.toISOString(),
      endUtc: period.endUtc.toISOString(),
      bucket: period.bucket,
      tz: period.tz,
      label: period.label,
    },
    baseCurrency,
    kpis: {
      totalDeliveries: deliveredCount,
      cancelledCount: Number(agg.cancelled_count || 0),
      totalRevenueBase: totalRevenue,
      totalCogsBase: totalCogs,
      totalExpensesBase: totalExpenses,
      grossMarginBase: gross,
      netMarginBase: net,
      grossMarginPct: grossPct,
      netMarginPct: netPct,
      avgRevenuePerDelivery: avgRevenue,
      missingCogsCount: Number(agg.missing_cogs_count || 0),
      missingExpensesCount: Number(agg.missing_expenses_count || 0),
      distanceKm,
      fuelLitres,
      fuelExpense,
      otherVehicleExpenses: otherVehicleExpense,
      vehicleExpenses,
      costPerKm,
      costPerDelivery,
      litresPer100Km,
      tripCount: Number(vehAgg.trip_count || 0),
      closedTripCount: Number(vehAgg.closed_trip_count || 0),
      unverifiedTripCount: Number((vehAgg as Record<string, unknown>).unverified_trip_count || 0),
      unverifiedFuelCount: Number((vehAgg as Record<string, unknown>).unverified_fuel_count || 0),
    },
    shipments,
    shipmentsTotalCount,
    shipmentsPage: paginate ? wantPage : 1,
    shipmentsPageSize: paginate ? wantPageSize : details.length,
    trend,
  };
}

export interface FleetDriverRow {
  driverId: string;
  driverName: string;
  active: boolean;
  driverAccountId: number | null;
  accountOnly: boolean;
  deliveries: number;
  cancelled: number;
  revenueBase: string;
  cogsBase: string;
  shipmentExpensesBase: string;
  fuelExpense: string;
  otherVehicleExpenses: string;
  vehicleExpenses: string;
  totalExpensesBase: string;
  grossMarginBase: string;
  netMarginBase: string;
  grossMarginPct: string | null;
  netMarginPct: string | null;
  distanceKm: string;
  fuelLitres: string;
  costPerKm: string | null;
  costPerDelivery: string | null;
  litresPer100Km: string | null;
  avgRevenuePerDelivery: string | null;
  tripCount: number;
  closedTripCount: number;
}

export const FLEET_SORT_KEYS = [
  "driverName", "deliveries", "cancelled",
  "revenueBase", "cogsBase", "shipmentExpensesBase",
  "fuelExpense", "otherVehicleExpenses", "vehicleExpenses",
  "totalExpensesBase", "grossMarginBase", "netMarginBase",
  "grossMarginPct", "netMarginPct",
  "distanceKm", "fuelLitres", "costPerKm", "costPerDelivery",
  "litresPer100Km", "avgRevenuePerDelivery",
  "tripCount", "closedTripCount",
] as const;
export type FleetSortKey = typeof FLEET_SORT_KEYS[number];
export type FleetSortDir = "asc" | "desc";

const FLEET_NUMERIC_SORT_KEYS: ReadonlySet<string> = new Set([
  "deliveries", "cancelled", "tripCount", "closedTripCount",
  "revenueBase", "cogsBase", "shipmentExpensesBase",
  "fuelExpense", "otherVehicleExpenses", "vehicleExpenses",
  "totalExpensesBase", "grossMarginBase", "netMarginBase",
  "grossMarginPct", "netMarginPct",
  "distanceKm", "fuelLitres", "costPerKm", "costPerDelivery",
  "litresPer100Km", "avgRevenuePerDelivery",
]);

function sortFleetRows(rows: FleetDriverRow[], sortKey: FleetSortKey, dir: FleetSortDir): FleetDriverRow[] {
  const numeric = FLEET_NUMERIC_SORT_KEYS.has(sortKey);
  const factor = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey];
    const bv = (b as unknown as Record<string, unknown>)[sortKey];
    let cmp: number;
    if (numeric) {
      const an = av == null ? -Infinity : parseFloat(String(av));
      const bn = bv == null ? -Infinity : parseFloat(String(bv));
      cmp = (isFinite(an) ? an : -Infinity) - (isFinite(bn) ? bn : -Infinity);
    } else {
      cmp = String(av || "").localeCompare(String(bv || ""));
    }
    if (cmp === 0) return a.driverName.localeCompare(b.driverName);
    return cmp * factor;
  });
}

export async function getFleetSummary(
  period: PeriodWindow,
  baseCurrency: string,
  opts: { sort?: FleetSortKey; dir?: FleetSortDir } = {},
): Promise<{
  baseCurrency: string;
  period: { startUtc: string; endUtc: string; bucket: string; tz: string };
  sort: FleetSortKey;
  dir: FleetSortDir;
  drivers: FleetDriverRow[];
}> {
  const sort = opts.sort && (FLEET_SORT_KEYS as ReadonlyArray<string>).includes(opts.sort) ? opts.sort : "revenueBase";
  const dir: FleetSortDir = opts.dir === "asc" ? "asc" : "desc";
  const startStr = period.startUtc.toISOString();
  const endStr = period.endUtc.toISOString();
  type FleetRow = {
    driver_id: string;
    driver_name: string;
    active: boolean;
    driver_account_id: number | null;
    account_only: boolean;
    deliveries: number;
    cancelled: number;
    revenue: string;
    cogs: string;
    shipment_expenses: string;
    distance_km: string;
    fuel_litres: string;
    fuel_expense: string;
    other_vehicle_expense: string;
    trip_count: number;
    closed_trip_count: number;
    [k: string]: unknown;
  };
  const rows = await db.execute<FleetRow>(sql`
    WITH ship AS (
      SELECT driver_id,
        COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped'))::int AS deliveries,
        COUNT(*) FILTER (WHERE LOWER(status) IN ('cancelled','canceled','returned','failed','skip','skipped'))::int AS cancelled,
        COALESCE(SUM((revenue * fx_rate_to_base)) FILTER (WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped')), 0)::numeric(18,4) AS revenue,
        COALESCE(SUM((cogs * fx_rate_to_base)) FILTER (WHERE LOWER(status) NOT IN ('cancelled','canceled','returned','failed','skip','skipped')), 0)::numeric(18,4) AS cogs
      FROM shipments_analytics
      WHERE delivery_date >= ${startStr} AND delivery_date < ${endStr}
      GROUP BY driver_id
    ),
    ship_exp AS (
      SELECT driver_id,
        COALESCE(SUM(amount * fx_rate_to_base), 0)::numeric(18,4) AS shipment_expenses
      FROM expenses
      WHERE incurred_at >= ${startStr} AND incurred_at < ${endStr}
      GROUP BY driver_id
    ),
    veh AS (
      SELECT t.driver_account_id,
        SUM(GREATEST(0,
          COALESCE(t.end_odometer::numeric, t.start_odometer::numeric) - t.start_odometer::numeric
        ))::numeric(18,4) AS distance_km,
        COUNT(*)::int AS closed_trip_count
      FROM driver_trips t
      WHERE t.status = 'closed'
        AND t.end_time IS NOT NULL
        AND t.end_time >= ${startStr}
        AND t.end_time < ${endStr}
      GROUP BY t.driver_account_id
    ),
    trip_count AS (
      SELECT t.driver_account_id, COUNT(*)::int AS trip_count
      FROM driver_trips t
      WHERE t.start_time >= ${startStr} AND t.start_time < ${endStr}
      GROUP BY t.driver_account_id
    ),
    veh_exp AS (
      -- COALESCE on driver_account_id picks up legacy expense rows whose
      -- own column is NULL but whose parent trip carries the link.
      SELECT COALESCE(e.driver_account_id, t.driver_account_id) AS driver_account_id,
        COALESCE(SUM(e.litres) FILTER (WHERE e.expense_type = 'fuel'), 0)::numeric(14,4) AS fuel_litres,
        COALESCE(SUM(e.amount) FILTER (WHERE e.expense_type = 'fuel'), 0)::numeric(18,4) AS fuel_expense,
        COALESCE(SUM(e.amount) FILTER (WHERE e.expense_type IN ('toll','service')), 0)::numeric(18,4) AS other_vehicle_expense
      FROM driver_trip_expenses e
      LEFT JOIN driver_trips t ON t.id = e.trip_id
      WHERE e.incurred_at >= ${startStr} AND e.incurred_at < ${endStr}
        AND COALESCE(e.driver_account_id, t.driver_account_id) IS NOT NULL
      GROUP BY COALESCE(e.driver_account_id, t.driver_account_id)
    ),
    candidates AS (
      SELECT d.id AS driver_id,
             d.name AS driver_name,
             d.active,
             d.driver_account_id,
             false AS account_only
      FROM drivers d
      WHERE d.active = true
         OR EXISTS (SELECT 1 FROM ship       s  WHERE s.driver_id = d.id)
         OR EXISTS (SELECT 1 FROM ship_exp   se WHERE se.driver_id = d.id)
         OR EXISTS (SELECT 1 FROM veh        v  WHERE v.driver_account_id = d.driver_account_id)
         OR EXISTS (SELECT 1 FROM veh_exp    ve WHERE ve.driver_account_id = d.driver_account_id)
      UNION ALL
      SELECT 'acct-' || da.id::text AS driver_id,
             COALESCE(NULLIF(da.driver_name, ''), da.username) AS driver_name,
             true AS active,
             da.id AS driver_account_id,
             true AS account_only
      FROM driver_accounts da
      WHERE NOT EXISTS (SELECT 1 FROM drivers WHERE driver_account_id = da.id)
        AND (
             EXISTS (SELECT 1 FROM veh v WHERE v.driver_account_id = da.id)
          OR EXISTS (SELECT 1 FROM veh_exp ve WHERE ve.driver_account_id = da.id)
        )
    )
    SELECT c.driver_id, c.driver_name, c.active, c.driver_account_id, c.account_only,
      COALESCE(s.deliveries, 0) AS deliveries,
      COALESCE(s.cancelled, 0) AS cancelled,
      COALESCE(s.revenue, 0)::numeric(18,4) AS revenue,
      COALESCE(s.cogs, 0)::numeric(18,4) AS cogs,
      COALESCE(se.shipment_expenses, 0)::numeric(18,4) AS shipment_expenses,
      COALESCE(v.distance_km, 0)::numeric(18,4) AS distance_km,
      COALESCE(ve.fuel_litres, 0)::numeric(14,4) AS fuel_litres,
      COALESCE(ve.fuel_expense, 0)::numeric(18,4) AS fuel_expense,
      COALESCE(ve.other_vehicle_expense, 0)::numeric(18,4) AS other_vehicle_expense,
      COALESCE(tc.trip_count, 0) AS trip_count,
      COALESCE(v.closed_trip_count, 0) AS closed_trip_count
    FROM candidates c
    LEFT JOIN ship s ON s.driver_id = c.driver_id
    LEFT JOIN ship_exp se ON se.driver_id = c.driver_id
    LEFT JOIN veh v ON v.driver_account_id = c.driver_account_id
    LEFT JOIN trip_count tc ON tc.driver_account_id = c.driver_account_id
    LEFT JOIN veh_exp ve ON ve.driver_account_id = c.driver_account_id
  `);
  const drivers: FleetDriverRow[] = (rows.rows || []).map((r) => {
    const revenue = String(r.revenue || "0");
    const cogs = String(r.cogs || "0");
    const shipmentExp = String(r.shipment_expenses || "0");
    const fuelExp = String(r.fuel_expense || "0");
    const otherVehExp = String(r.other_vehicle_expense || "0");
    const vehExp = dAdd(fuelExp, otherVehExp);
    const totalExp = dAdd(shipmentExp, vehExp);
    const grossMargin = dSub(revenue, cogs);
    const netMargin = dSub(grossMargin, totalExp);
    const distance = String(r.distance_km || "0");
    const fuelLitres = String(r.fuel_litres || "0");
    const distNum = parseFloat(distance);
    const deliveries = Number(r.deliveries || 0);
    return {
      driverId: r.driver_id,
      driverName: r.driver_name,
      active: r.active,
      driverAccountId: r.driver_account_id == null ? null : Number(r.driver_account_id),
      accountOnly: !!r.account_only,
      deliveries,
      cancelled: Number(r.cancelled || 0),
      revenueBase: revenue,
      cogsBase: cogs,
      shipmentExpensesBase: shipmentExp,
      fuelExpense: fuelExp,
      otherVehicleExpenses: otherVehExp,
      vehicleExpenses: vehExp,
      totalExpensesBase: totalExp,
      grossMarginBase: grossMargin,
      netMarginBase: netMargin,
      grossMarginPct: dPct(grossMargin, revenue),
      netMarginPct: dPct(netMargin, revenue),
      distanceKm: distance,
      fuelLitres,
      costPerKm: distNum > 0 ? dDiv(totalExp, distance) : null,
      costPerDelivery: deliveries > 0 ? dDiv(totalExp, deliveries) : null,
      litresPer100Km: distNum > 0 ? dDiv(fuelLitres, dDiv(distance, "100")) : null,
      avgRevenuePerDelivery: deliveries > 0 ? dDiv(revenue, deliveries) : null,
      tripCount: Number(r.trip_count || 0),
      closedTripCount: Number(r.closed_trip_count || 0),
    };
  });
  return {
    baseCurrency,
    period: { startUtc: period.startUtc.toISOString(), endUtc: period.endUtc.toISOString(), bucket: period.bucket, tz: period.tz },
    sort,
    dir,
    drivers: sortFleetRows(drivers, sort, dir),
  };
}

export interface ComputeMarginInput {
  revenueBase: string;
  cogsBase: string | null;
  expensesBase: string;
  deliveredCount: number;
  cancelledCount: number;
}

export interface ComputedMargins {
  grossMarginBase: string;
  netMarginBase: string;
  grossMarginPct: string | null;
  netMarginPct: string | null;
  avgRevenuePerDelivery: string | null;
}

export function computeMargins(input: ComputeMarginInput): ComputedMargins {
  const cogs = input.cogsBase || "0";
  const gross = dSub(input.revenueBase, cogs);
  const net = dSub(gross, input.expensesBase);
  return {
    grossMarginBase: gross,
    netMarginBase: net,
    grossMarginPct: dPct(gross, input.revenueBase),
    netMarginPct: dPct(net, input.revenueBase),
    avgRevenuePerDelivery: input.deliveredCount > 0 ? dDiv(input.revenueBase, input.deliveredCount) : null,
  };
}
