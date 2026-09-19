/**
 * Analytics test suite. Run with: tsx server/lib/analytics.test.ts
 * Covers: period resolution, decimal helpers, computeMargins (zero/cancel/multi-currency).
 */
import { resolvePeriod, computeMargins } from "./analytics";
import { dAdd, dSub, dMul, dDiv, dPct } from "./decimal";

let passed = 0, failed = 0;

function eq(actual: unknown, expected: unknown, name: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`); }
}

console.log("# decimal helpers");
eq(dAdd("1.5", "2.25"), "3.7500", "add");
eq(dSub("10", "3.5"), "6.5000", "sub");
eq(dMul("2.5", "4"), "10.0000", "mul");
eq(dDiv("10", "4"), "2.5000", "div");
eq(dDiv("10", "0"), "0", "div by zero");
eq(dPct("25", "100"), "25.00", "pct");
eq(dPct("25", "0"), null, "pct by zero");

console.log("\n# computeMargins");
const m1 = computeMargins({ revenueBase: "1000.0000", cogsBase: "600.0000", expensesBase: "100.0000", deliveredCount: 10, cancelledCount: 0 });
eq(m1.grossMarginBase, "400.0000", "gross margin");
eq(m1.netMarginBase, "300.0000", "net margin");
eq(m1.grossMarginPct, "40.00", "gross %");
eq(m1.netMarginPct, "30.00", "net %");
eq(m1.avgRevenuePerDelivery, "100.0000", "avg/delivery");

const mZero = computeMargins({ revenueBase: "0", cogsBase: "0", expensesBase: "0", deliveredCount: 0, cancelledCount: 5 });
eq(mZero.grossMarginPct, null, "zero revenue → null pct");
eq(mZero.avgRevenuePerDelivery, null, "zero deliveries → null avg");

const mNoCogs = computeMargins({ revenueBase: "500.0000", cogsBase: null, expensesBase: "50.0000", deliveredCount: 5, cancelledCount: 0 });
eq(mNoCogs.grossMarginBase, "500.0000", "missing cogs treated as 0");
eq(mNoCogs.netMarginBase, "450.0000", "net with missing cogs");

console.log("\n# resolvePeriod (UTC)");
const now = new Date("2026-04-15T12:00:00Z");
const p7 = resolvePeriod("7d", "UTC", { now });
eq(p7.bucket, "day", "7d uses day buckets");
eq(p7.endUtc.toISOString(), "2026-04-16T00:00:00.000Z", "7d end is tomorrow midnight UTC");
eq(p7.startUtc.toISOString(), "2026-04-09T00:00:00.000Z", "7d start is 7 days before end");

const p30 = resolvePeriod("30d", "UTC", { now });
eq(p30.bucket, "week", "30d uses week buckets");

const pYtd = resolvePeriod("ytd", "UTC", { now });
eq(pYtd.startUtc.toISOString(), "2026-01-01T00:00:00.000Z", "ytd start = Jan 1");
eq(pYtd.bucket, "month", "ytd month bucket");

const p12 = resolvePeriod("12m", "UTC", { now });
eq(p12.bucket, "month", "12m month bucket");

const pCust = resolvePeriod("custom", "UTC", { now, start: "2026-04-01", end: "2026-04-07" });
eq(pCust.startUtc.toISOString(), "2026-04-01T00:00:00.000Z", "custom start");
eq(pCust.endUtc.toISOString(), "2026-04-08T00:00:00.000Z", "custom end (exclusive next-day)");

console.log("\n# resolvePeriod (timezone awareness)");
const pNy = resolvePeriod("7d", "America/New_York", { now: new Date("2026-04-15T03:00:00Z") });
// 03:00 UTC = 23:00 NY previous day → end-of-period midnight NY = 04:00 UTC same day
eq(pNy.endUtc.toISOString(), "2026-04-15T04:00:00.000Z", "tz: NY day boundary");

// Daylight-saving boundary check (NY spring-forward 2026-03-08)
const pDst = resolvePeriod("custom", "America/New_York", { now, start: "2026-03-07", end: "2026-03-09" });
eq(pDst.startUtc.toISOString(), "2026-03-07T05:00:00.000Z", "DST: pre-spring start = 05:00 UTC");
eq(pDst.endUtc.toISOString(),   "2026-03-10T04:00:00.000Z", "DST: post-spring end exclusive = 04:00 UTC");

// To-date semantics for this_week / this_month
const pTW = resolvePeriod("this_week", "UTC", { now: new Date("2026-04-15T12:00:00Z") }); // Wed
eq(pTW.endUtc.toISOString(), "2026-04-16T00:00:00.000Z", "this_week ends today (to-date)");
const pTM = resolvePeriod("this_month", "UTC", { now: new Date("2026-04-15T12:00:00Z") });
eq(pTM.startUtc.toISOString(), "2026-04-01T00:00:00.000Z", "this_month starts on 1st");
eq(pTM.endUtc.toISOString(),   "2026-04-16T00:00:00.000Z", "this_month ends today (to-date)");

console.log("\n# DB-backed aggregation");
async function dbTests() {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const { getDriverAnalytics } = await import("./analytics");
  const drvName = `__test_drv_${Date.now()}`;
  try {
    const ins = await db.execute<{ id: string }>(sql`INSERT INTO drivers (name, employee_number, active) VALUES (${drvName}, '', true) RETURNING id`);
    const driverId = ins.rows[0].id;
    const day = new Date("2026-04-10T12:00:00Z");
    await db.execute(sql`INSERT INTO shipments_analytics (driver_id, waybill, delivery_date, revenue, cogs, currency, fx_rate_to_base, status) VALUES
      (${driverId}, 'WB-T1', ${day.toISOString()}, 100, 60, 'USD', 1, 'delivered'),
      (${driverId}, 'WB-T2', ${day.toISOString()}, 200, 120, 'EUR', 1.10, 'delivered'),
      (${driverId}, 'WB-T3', ${day.toISOString()}, 50, 0, 'USD', 1, 'cancelled')`);
    const window = resolvePeriod("custom", "UTC", { start: "2026-04-09", end: "2026-04-11", now: new Date("2026-04-15T12:00:00Z") });
    const res = await getDriverAnalytics(driverId, window, "USD");
    eq(res.kpis.totalDeliveries, 2, "DB: cancelled excluded from deliveries");
    eq(res.kpis.cancelledCount, 1, "DB: cancelled counted separately");
    // 100 + 200*1.10 = 320
    eq(res.kpis.totalRevenueBase, "320.0000", "DB: multi-currency revenue normalized to base");
    eq(res.kpis.totalCogsBase, "192.0000", "DB: COGS normalized (60 + 120*1.10)");
  } finally {
    await db.execute(sql`DELETE FROM drivers WHERE name = ${drvName}`);
  }
}
await dbTests().catch(e => { failed++; console.error("  ✗ DB test threw:", e?.message || e); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
