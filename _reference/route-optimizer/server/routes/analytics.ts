import { Router, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { z } from "zod";
import { storage } from "../storage";
import { requireAnalyticsAccess, requireAdmin, ANALYTICS_ROLES } from "../middleware/analytics-auth";
import {
  resolvePeriod, getCompanyTimezone, getBaseCurrency,
  getDriverAnalytics, getFleetSummary, listAnalyticsDrivers,
  FLEET_SORT_KEYS, type FleetSortKey, type FleetSortDir,
  type AnalyticsPeriod, type FleetDriverRow,
} from "../lib/analytics";
import { cacheGet, cacheSetex, cacheStatus } from "../lib/analytics-cache";
import { runAnalyticsBackfill } from "../lib/analytics-backfill";
import { fmtMoney } from "../lib/decimal";

const router = Router();
const CACHE_TTL_HISTORICAL = 5 * 60;
const CACHE_TTL_LIVE = 5;

function pickCacheTtl(_period: AnalyticsPeriod, window: { endUtc: Date }): number {
  return window.endUtc.getTime() >= Date.now() ? CACHE_TTL_LIVE : CACHE_TTL_HISTORICAL;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const periodSchema = z.object({
  period: z.enum(["7d", "this_week", "this_month", "30d", "ytd", "12m", "custom"]).default("7d"),
  start: isoDate.optional(),
  end: isoDate.optional(),
  tz: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.period === "custom") {
    if (!v.start || !v.end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "custom period requires start and end (YYYY-MM-DD)" });
      return;
    }
    if (v.start > v.end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "start must be on or before end" });
      return;
    }
    const startMs = Date.parse(v.start + "T00:00:00Z");
    const endMs   = Date.parse(v.end   + "T00:00:00Z");
    const days = (endMs - startMs) / 86400000;
    if (days > 366) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "custom range cannot exceed 366 days" });
    }
  }
});

const fleetSortSchema = z.object({
  sort: z.enum(FLEET_SORT_KEYS).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

const fleetQuerySchema = periodSchema.and(fleetSortSchema);

router.get("/api/drivers/analytics/cache-status", requireAnalyticsAccess({ allowDriverSelf: false }), (_req, res) => {
  res.json(cacheStatus());
});

router.post("/api/drivers/analytics/backfill", requireAdmin, async (_req, res) => {
  await runAnalyticsBackfill({ force: true });
  res.json({ ok: true });
});

router.get("/api/drivers/analytics/list", requireAnalyticsAccess({ allowDriverSelf: false }), async (_req, res) => {
  const drivers = await listAnalyticsDrivers();
  res.json({ drivers });
});

async function fleetSummaryHandler(req: Request, res: Response): Promise<void> {
  const parsed = fleetQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const tz = data.tz || (await getCompanyTimezone());
  const baseCurrency = await getBaseCurrency();
  const window = resolvePeriod(data.period as AnalyticsPeriod, tz, { start: data.start, end: data.end });
  const sort: FleetSortKey = (data.sort as FleetSortKey) || "revenueBase";
  const dir: FleetSortDir = data.dir || "desc";
  const cacheKey = `summary:${baseCurrency}:${window.startUtc.toISOString()}:${window.endUtc.toISOString()}:${tz}:${sort}:${dir}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.json({ ...cached, cached: true });
    return;
  }
  const result = await getFleetSummary(window, baseCurrency, { sort, dir });
  await cacheSetex(cacheKey, pickCacheTtl(data.period as AnalyticsPeriod, window), result);
  res.json({ ...result, cached: false });
}

router.get("/api/drivers/analytics/fleet", requireAnalyticsAccess({ allowDriverSelf: false }), fleetSummaryHandler);
router.get("/api/drivers/analytics/summary", requireAnalyticsAccess({ allowDriverSelf: false }), fleetSummaryHandler);

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

router.get("/api/drivers/:id/analytics", requireAnalyticsAccess({ driverIdParam: "id" }), async (req: Request, res: Response) => {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid period" });
  const pag = paginationSchema.safeParse(req.query);
  if (!pag.success) return res.status(400).json({ message: "Invalid pagination" });
  const page = pag.data.page ?? 1;
  const pageSize = pag.data.pageSize ?? 50;
  const driverId = String(req.params.id);
  const tz = parsed.data.tz || (await getCompanyTimezone());
  const baseCurrency = await getBaseCurrency();
  const window = resolvePeriod(parsed.data.period as AnalyticsPeriod, tz, { start: parsed.data.start, end: parsed.data.end });
  const cacheKey = `driver:${driverId}:${baseCurrency}:${window.startUtc.toISOString()}:${window.endUtc.toISOString()}:${tz}:p${page}:${pageSize}`;
  let result = await cacheGet<Awaited<ReturnType<typeof getDriverAnalytics>>>(cacheKey);
  let cached = true;
  if (!result) {
    const fresh = await getDriverAnalytics(driverId, window, baseCurrency, { page, pageSize });
    fresh.period.type = parsed.data.period;
    result = fresh;
    await cacheSetex(cacheKey, pickCacheTtl(parsed.data.period as AnalyticsPeriod, window), result);
    cached = false;
  }
  try {
    const actor = req.analyticsActor!;
    const auditMeta: Record<string, string> = {
      actor: actor.username,
      role: actor.role,
      period: parsed.data.period,
      tz,
      baseCurrency,
    };
    await storage.createAuditLog({
      eventType: "analytics_view",
      entityType: "driver",
      entityId: driverId,
      actorType: actor.type,
      newValue: auditMeta,
      details: `analytics_view:${actor.username}:${parsed.data.period}`,
    });
  } catch {}
  res.json({ ...result, cached });
});

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface LedgerRow {
  driverName: string;
  periodLabel: string;
  deliveries: number;
  revenueBase: string;
  cogsBase: string;
  grossMarginBase: string;
  netMarginBase: string;
  distanceKm: string;
  fuelLitres: string;
  fuelExpense: string;
  otherVehicleExpenses: string;
  costPerKm: string | null;
  costPerDelivery: string | null;
}

interface LedgerColumn {
  header: string;
  key: keyof LedgerRow;
  width: number;
  money?: boolean;
}

const LEDGER_COLUMNS: ReadonlyArray<LedgerColumn> = [
  { header: "Driver",          key: "driverName",       width: 22 },
  { header: "Period",          key: "periodLabel",      width: 28 },
  { header: "Deliveries",      key: "deliveries",       width: 12 },
  { header: "Revenue",         key: "revenueBase",      width: 14, money: true },
  { header: "COGS",            key: "cogsBase",         width: 14, money: true },
  { header: "Gross Margin",    key: "grossMarginBase",  width: 14, money: true },
  { header: "Net Margin",      key: "netMarginBase",    width: 14, money: true },
  { header: "Distance (km)",   key: "distanceKm",       width: 14 },
  { header: "Fuel (L)",        key: "fuelLitres",       width: 12 },
  { header: "Fuel (R)",        key: "fuelExpense",      width: 14, money: true },
  { header: "Other Vehicle Exp", key: "otherVehicleExpenses", width: 18, money: true },
  { header: "Cost / km",       key: "costPerKm",        width: 14, money: true },
  { header: "Cost / Delivery", key: "costPerDelivery",  width: 16, money: true },
];

function periodLabel(periodKey: string, window: { startUtc: Date; endUtc: Date }): string {
  return `${periodKey} (${window.startUtc.toISOString().slice(0, 10)} → ${window.endUtc.toISOString().slice(0, 10)})`;
}

function ledgerRowFromDriverAnalytics(
  result: Awaited<ReturnType<typeof getDriverAnalytics>>,
  fallbackName: string,
  pLabel: string,
): LedgerRow {
  const k = result.kpis;
  return {
    driverName: result.driverName || fallbackName,
    periodLabel: pLabel,
    deliveries: k.totalDeliveries,
    revenueBase: k.totalRevenueBase,
    cogsBase: k.totalCogsBase,
    grossMarginBase: k.grossMarginBase,
    netMarginBase: k.netMarginBase,
    distanceKm: k.distanceKm,
    fuelLitres: k.fuelLitres,
    fuelExpense: k.fuelExpense,
    otherVehicleExpenses: k.otherVehicleExpenses,
    costPerKm: k.costPerKm,
    costPerDelivery: k.costPerDelivery,
  };
}

function ledgerRowFromFleetDriver(d: FleetDriverRow, pLabel: string): LedgerRow {
  return {
    driverName: d.driverName,
    periodLabel: pLabel,
    deliveries: d.deliveries,
    revenueBase: d.revenueBase,
    cogsBase: d.cogsBase,
    grossMarginBase: d.grossMarginBase,
    netMarginBase: d.netMarginBase,
    distanceKm: d.distanceKm,
    fuelLitres: d.fuelLitres,
    fuelExpense: d.fuelExpense,
    otherVehicleExpenses: d.otherVehicleExpenses,
    costPerKm: d.costPerKm,
    costPerDelivery: d.costPerDelivery,
  };
}

function fmtCellForCsv(value: unknown, col: LedgerColumn, currency: string): string {
  if (value == null || value === "") return "";
  if (col.money) {
    return fmtMoney(String(value), currency);
  }
  return String(value);
}

function emitLedgerCsv(
  rows: LedgerRow[],
  baseCurrency: string,
  meta: { period: string; window: { startUtc: Date; endUtc: Date }; tz: string; title: string },
): string {
  const lines: string[] = [];
  lines.push(`${csvEscape(meta.title)},${csvEscape(meta.period)},${csvEscape(meta.window.startUtc.toISOString())},${csvEscape(meta.window.endUtc.toISOString())}`);
  lines.push(`Timezone,${csvEscape(meta.tz)}`);
  lines.push(`Base Currency,${csvEscape(baseCurrency)}`);
  lines.push("");
  lines.push(LEDGER_COLUMNS.map((c) => csvEscape(c.header)).join(","));
  for (const r of rows) {
    lines.push(LEDGER_COLUMNS.map((c) => csvEscape(fmtCellForCsv(r[c.key], c, baseCurrency))).join(","));
  }
  return lines.join("\n");
}

async function emitLedgerXlsx(
  rows: LedgerRow[],
  baseCurrency: string,
  meta: { period: string; window: { startUtc: Date; endUtc: Date }; tz: string; title: string; sheetName: string },
  res: Response,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Delicate Courier Analytics";
  wb.created = new Date();
  const sheet = wb.addWorksheet(meta.sheetName);
  sheet.addRow([meta.title, meta.period, meta.window.startUtc.toISOString(), meta.window.endUtc.toISOString()]);
  sheet.addRow(["Timezone", meta.tz]);
  sheet.addRow(["Base Currency", baseCurrency]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(LEDGER_COLUMNS.map((c) => c.header));
  headerRow.font = { bold: true };
  for (const r of rows) {
    sheet.addRow(LEDGER_COLUMNS.map((c) => {
      const v = r[c.key];
      if (v == null || v === "") return "";
      if (c.money) return fmtMoney(String(v), baseCurrency);
      return v;
    }));
  }
  LEDGER_COLUMNS.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });
  await wb.xlsx.write(res);
  res.end();
}

function emitLedgerPdf(
  rows: LedgerRow[],
  baseCurrency: string,
  meta: { period: string; window: { startUtc: Date; endUtc: Date }; tz: string; title: string },
  res: Response,
): void {
  const doc = new PDFDocument({ margin: 28, layout: "landscape" } as ConstructorParameters<typeof PDFDocument>[0]);
  doc.pipe(res);
  doc.fontSize(16).text(meta.title);
  doc.fontSize(9).fillColor("#666").text(
    `Period: ${meta.period}  ·  ${meta.window.startUtc.toISOString().slice(0, 10)} → ${meta.window.endUtc.toISOString().slice(0, 10)}  ·  TZ: ${meta.tz}  ·  Base: ${baseCurrency}`,
  );
  doc.fillColor("#000").moveDown(0.5);
  doc.fontSize(8);
  doc.text(LEDGER_COLUMNS.map((c) => c.header).join("  |  "));
  doc.moveDown(0.2);
  for (const r of rows) {
    doc.text(LEDGER_COLUMNS.map((c) => {
      const v = r[c.key];
      if (v == null || v === "") return "—";
      if (c.money) return fmtMoney(String(v), baseCurrency);
      return String(v);
    }).join("  |  "));
  }
  doc.end();
}

router.get("/api/drivers/:id/analytics/export.csv", requireAnalyticsAccess({ driverIdParam: "id" }), async (req: Request, res: Response) => {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid period" });
  const driverId = String(req.params.id);
  const tz = parsed.data.tz || (await getCompanyTimezone());
  const baseCurrency = await getBaseCurrency();
  const window = resolvePeriod(parsed.data.period as AnalyticsPeriod, tz, { start: parsed.data.start, end: parsed.data.end });
  const result = await getDriverAnalytics(driverId, window, baseCurrency);
  const row = ledgerRowFromDriverAnalytics(result, driverId, periodLabel(parsed.data.period, window));
  const csv = emitLedgerCsv([row], baseCurrency, {
    period: parsed.data.period, window, tz, title: `Driver Analytics — ${row.driverName}`,
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="driver-${driverId}-analytics.csv"`);
  res.send(csv);
});

router.get("/api/drivers/:id/analytics/export.xlsx", requireAnalyticsAccess({ driverIdParam: "id" }), async (req: Request, res: Response) => {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid period" });
  const driverId = String(req.params.id);
  const tz = parsed.data.tz || (await getCompanyTimezone());
  const baseCurrency = await getBaseCurrency();
  const window = resolvePeriod(parsed.data.period as AnalyticsPeriod, tz, { start: parsed.data.start, end: parsed.data.end });
  const result = await getDriverAnalytics(driverId, window, baseCurrency);
  const row = ledgerRowFromDriverAnalytics(result, driverId, periodLabel(parsed.data.period, window));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="driver-${driverId}-analytics.xlsx"`);
  await emitLedgerXlsx([row], baseCurrency, {
    period: parsed.data.period, window, tz, title: `Driver Analytics — ${row.driverName}`, sheetName: "Driver",
  }, res);
});

router.get("/api/drivers/:id/analytics/export.pdf", requireAnalyticsAccess({ driverIdParam: "id" }), async (req: Request, res: Response) => {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid period" });
  const driverId = String(req.params.id);
  const tz = parsed.data.tz || (await getCompanyTimezone());
  const baseCurrency = await getBaseCurrency();
  const window = resolvePeriod(parsed.data.period as AnalyticsPeriod, tz, { start: parsed.data.start, end: parsed.data.end });
  const result = await getDriverAnalytics(driverId, window, baseCurrency);
  const row = ledgerRowFromDriverAnalytics(result, driverId, periodLabel(parsed.data.period, window));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="driver-${driverId}-analytics.pdf"`);
  emitLedgerPdf([row], baseCurrency, {
    period: parsed.data.period, window, tz, title: `Driver Analytics — ${row.driverName}`,
  }, res);
});

async function loadFleetForExport(req: Request): Promise<
  | { ok: false; status: number; body: unknown }
  | {
      ok: true;
      result: Awaited<ReturnType<typeof getFleetSummary>>;
      tz: string;
      baseCurrency: string;
      window: { startUtc: Date; endUtc: Date };
      periodKey: string;
    }
> {
  const parsed = fleetQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { message: "Invalid query", issues: parsed.error.flatten() } };
  }
  const data = parsed.data;
  const tz = data.tz || (await getCompanyTimezone());
  const baseCurrency = await getBaseCurrency();
  const window = resolvePeriod(data.period as AnalyticsPeriod, tz, { start: data.start, end: data.end });
  const sort: FleetSortKey = (data.sort as FleetSortKey) || "revenueBase";
  const dir: FleetSortDir = data.dir || "desc";
  const result = await getFleetSummary(window, baseCurrency, { sort, dir });
  return { ok: true, result, tz, baseCurrency, window, periodKey: data.period };
}

router.get("/api/drivers/analytics/fleet/export.csv", requireAnalyticsAccess({ allowDriverSelf: false }), async (req: Request, res: Response) => {
  const loaded = await loadFleetForExport(req);
  if (!loaded.ok) return res.status(loaded.status).json(loaded.body);
  const { result, tz, baseCurrency, window, periodKey } = loaded;
  const pLabel = periodLabel(periodKey, window);
  const rows = result.drivers.map((d) => ledgerRowFromFleetDriver(d, pLabel));
  const csv = emitLedgerCsv(rows, baseCurrency, {
    period: periodKey, window, tz, title: `Fleet Leaderboard (sorted by ${result.sort} ${result.dir})`,
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="fleet-leaderboard.csv"`);
  res.send(csv);
});

router.get("/api/drivers/analytics/fleet/export.xlsx", requireAnalyticsAccess({ allowDriverSelf: false }), async (req: Request, res: Response) => {
  const loaded = await loadFleetForExport(req);
  if (!loaded.ok) return res.status(loaded.status).json(loaded.body);
  const { result, tz, baseCurrency, window, periodKey } = loaded;
  const pLabel = periodLabel(periodKey, window);
  const rows = result.drivers.map((d) => ledgerRowFromFleetDriver(d, pLabel));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="fleet-leaderboard.xlsx"`);
  await emitLedgerXlsx(rows, baseCurrency, {
    period: periodKey, window, tz,
    title: `Fleet Leaderboard (sorted by ${result.sort} ${result.dir})`,
    sheetName: "Fleet",
  }, res);
});

router.get("/api/drivers/analytics/fleet/export.pdf", requireAnalyticsAccess({ allowDriverSelf: false }), async (req: Request, res: Response) => {
  const loaded = await loadFleetForExport(req);
  if (!loaded.ok) return res.status(loaded.status).json(loaded.body);
  const { result, tz, baseCurrency, window, periodKey } = loaded;
  const pLabel = periodLabel(periodKey, window);
  const rows = result.drivers.map((d) => ledgerRowFromFleetDriver(d, pLabel));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="fleet-leaderboard.pdf"`);
  emitLedgerPdf(rows, baseCurrency, {
    period: periodKey, window, tz,
    title: `Fleet Leaderboard (sorted by ${result.sort} ${result.dir})`,
  }, res);
});

const setRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["admin", "manager", "ops", "dispatcher"]),
});

router.post("/api/admin/users/role", requireAdmin, async (req: Request, res: Response) => {
  const parsed = setRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
  const u = await storage.getUser(parsed.data.userId);
  if (!u) return res.status(404).json({ message: "User not found" });
  const updated = await storage.updateUserRole(parsed.data.userId, parsed.data.role);
  res.json({ user: updated });
});

router.get("/api/analytics/roles", (_req, res) => {
  res.json({ roles: ANALYTICS_ROLES });
});

export default router;
