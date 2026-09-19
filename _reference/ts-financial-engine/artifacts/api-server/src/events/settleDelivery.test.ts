import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  drivers,
  bakeries,
  driverBakeryAssignments,
  pricingRules,
  deliveries,
  walletTransactions,
} from "@workspace/db";
import { settleDelivery } from "./settleDelivery.js";
import { handleEvent } from "./handlers.js";
import type { IncomingEvent } from "./schemas.js";

/**
 * Integration test for the Phase 1 settlement invariant:
 *
 *   The same DeliveryCompleted event, processed any number of times,
 *   produces exactly one settlement and exactly one set of wallet legs.
 *
 * Requires a live DATABASE_URL (same Postgres the app uses). Run with:
 *   pnpm --filter @workspace/api-server run test
 * (script: "tsx --test src/events/settleDelivery.test.ts")
 */

let driverId: string;
let bakeryId: string;
const tag = randomUUID().slice(0, 8);
const waybill = `WB-TEST-${tag}`;
const dedupeKey = `delivery:${waybill}`;

before(async () => {
  // Minimal self-contained fixtures.
  const [driver] = await db
    .insert(drivers)
    .values({ name: `Test Driver ${tag}`, depotLat: -25.75, depotLng: 28.23, active: true })
    .returning();
  driverId = driver!.id;

  const [bakery] = await db
    .insert(bakeries)
    .values({ code: `TEST-${tag}`, name: `Test Bakery ${tag}`, pickupLat: -25.76, pickupLng: 28.24, active: true })
    .returning();
  bakeryId = bakery!.id;

  await db.insert(driverBakeryAssignments).values({ driverId, bakeryId, active: true });

  // A global pricing rule scoped to nothing else, so it only matches if no
  // other global rule outranks it. We give it a high priority to be safe.
  await db.insert(pricingRules).values({
    label: `test-global-${tag}`,
    scopeType: "global",
    fuelCostPerKmCents: 120,
    variableCostsCents: 0,
    strategy: "share",
    driverShareBps: 7000,
    priority: 1000,
    active: true,
  });
});

after(async () => {
  // Tidy up everything this test created. Order respects FKs.
  await db.delete(walletTransactions).where(eq(walletTransactions.driverId, driverId));
  await db.delete(deliveries).where(eq(deliveries.idempotencyKey, dedupeKey));
  await db.delete(driverBakeryAssignments).where(eq(driverBakeryAssignments.driverId, driverId));
  await db.delete(pricingRules).where(eq(pricingRules.label, `test-global-${tag}`));
  await db.delete(bakeries).where(eq(bakeries.id, bakeryId));
  await db.delete(drivers).where(eq(drivers.id, driverId));
  await pool.end();
});

test("settleDelivery is idempotent: two calls produce one settlement", async () => {
  const input = {
    driverId,
    bakeryId,
    waybill,
    priceCents: 8000,
    distanceKm: 12.4,
    currency: "ZAR",
    idempotencyKey: dedupeKey,
  };

  const first = await settleDelivery(input);
  const second = await settleDelivery(input);

  assert.equal(first.alreadySettled, false, "first call should settle");
  assert.equal(second.alreadySettled, true, "second call should be a no-op");
  assert.equal(first.deliveryId, second.deliveryId, "same delivery row");

  // Exactly one settled delivery for this waybill.
  const deliveryRows = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.idempotencyKey, dedupeKey));
  assert.equal(deliveryRows.length, 1, "exactly one delivery row");
  assert.equal(deliveryRows[0]!.status, "settled");

  // Exactly one earnings leg and one fuel leg.
  const earningLegs = await db
    .select()
    .from(walletTransactions)
    .where(and(eq(walletTransactions.driverId, driverId), eq(walletTransactions.account, "earnings")));
  const fuelLegs = await db
    .select()
    .from(walletTransactions)
    .where(and(eq(walletTransactions.driverId, driverId), eq(walletTransactions.account, "fuel")));
  assert.equal(earningLegs.length, 1, "exactly one earnings leg");
  assert.equal(fuelLegs.length, 1, "exactly one fuel leg");

  // The payout posted equals the settlement, not double.
  assert.equal(earningLegs[0]!.amountCents, first.settlement.driverPayoutCents);
});

test("handleEvent path is idempotent end to end", async () => {
  const envelope: IncomingEvent = {
    eventId: randomUUID(),
    eventType: "DeliveryCompleted",
    eventVersion: 1,
    source: "route-optimizer",
    dedupeKey, // same business key as above -> must not create a second settlement
    occurredAt: new Date(),
    payload: { driverId, bakeryId, waybill, priceCents: 8000, distanceKm: 12.4, currency: "ZAR" },
  };

  const out = await handleEvent(envelope);
  assert.equal(out.handled, true);
  assert.equal(out.detail?.["alreadySettled"], true, "handler must reuse the existing settlement");

  const deliveryRows = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.idempotencyKey, dedupeKey));
  assert.equal(deliveryRows.length, 1, "still exactly one delivery row after handler");
});
