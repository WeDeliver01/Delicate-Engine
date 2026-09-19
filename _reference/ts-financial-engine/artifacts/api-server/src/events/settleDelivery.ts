import { and, eq } from "drizzle-orm";
import {
  db,
  drivers,
  bakeries,
  driverBakeryAssignments,
  deliveries,
  routes,
} from "@workspace/db";
import { unlockDate } from "../lib/vesting.js";
import { pricingService, type Settlement } from "../services/pricingService.js";
import { walletService } from "../services/walletService.js";
import type { DeliveryCompletedPayload } from "./schemas.js";

export interface SettleDeliveryInput extends DeliveryCompletedPayload {
  /** Stable business key from the event envelope, e.g. "delivery:WB12345". */
  idempotencyKey: string;
}

export interface SettleDeliveryResult {
  deliveryId: string;
  status: string;
  settlement: Settlement;
  alreadySettled: boolean;
}

function snapshot(d: typeof deliveries.$inferSelect): Settlement {
  return {
    fuelCents: d.fuelCents ?? 0,
    variableCents: d.variableCents ?? 0,
    driverPayoutCents: d.driverPayoutCents ?? 0,
    companyRevenueCents: d.companyRevenueCents ?? 0,
    cogsCents: d.cogsCents ?? 0,
    marginBps: d.marginBps ?? 0,
    pricingRuleId: d.pricingRuleId ?? "",
    distanceKm: d.distanceKm ?? 0,
  };
}

/**
 * settleDelivery() is the Phase 1 settlement workflow. It is deliberately a
 * thin evolution of DeliveryService.createAndSettle:
 *
 *   - It settles against the *actual* distance carried by the event instead of
 *     recomputing a route from haversine.
 *   - Its idempotency key is the event's business dedupeKey, so the same
 *     real-world delivery can never settle twice no matter how many times the
 *     event is delivered.
 *
 * It does NOT touch payouts, vesting policy, or pricing-rule structure. Those
 * are later phases. The earnings leg still vests on the existing Tuesday cycle.
 */
export async function settleDelivery(
  input: SettleDeliveryInput,
): Promise<SettleDeliveryResult> {
  // Fast path: already settled. Cheap read before opening a transaction.
  const existing = await db.query.deliveries.findFirst({
    where: eq(deliveries.idempotencyKey, input.idempotencyKey),
  });
  if (existing && existing.status === "settled") {
    return {
      deliveryId: existing.id,
      status: existing.status,
      settlement: snapshot(existing),
      alreadySettled: true,
    };
  }

  const [driver, bakery, assignment] = await Promise.all([
    db.query.drivers.findFirst({
      where: and(eq(drivers.id, input.driverId), eq(drivers.active, true)),
    }),
    db.query.bakeries.findFirst({
      where: and(eq(bakeries.id, input.bakeryId), eq(bakeries.active, true)),
    }),
    db.query.driverBakeryAssignments.findFirst({
      where: and(
        eq(driverBakeryAssignments.driverId, input.driverId),
        eq(driverBakeryAssignments.bakeryId, input.bakeryId),
        eq(driverBakeryAssignments.active, true),
      ),
    }),
  ]);
  if (!driver) throw new Error(`Driver ${input.driverId} not found / inactive`);
  if (!bakery) throw new Error(`Bakery ${input.bakeryId} not found / inactive`);
  if (!assignment) throw new Error(`Driver ${input.driverId} is not assigned to bakery ${input.bakeryId}`);

  const distanceKm = input.distanceKm;

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(deliveries)
      .values({
        bakeryId: input.bakeryId,
        driverId: input.driverId,
        customerAddress: input.customer?.address ?? null,
        customerLat: input.customer?.lat ?? 0,
        customerLng: input.customer?.lng ?? 0,
        zone: input.zone ?? null,
        priceCents: input.priceCents,
        currency: input.currency ?? "ZAR",
        idempotencyKey: input.idempotencyKey,
        status: "created",
      })
      .onConflictDoNothing({ target: deliveries.idempotencyKey })
      .returning();

    // Lost the insert race (or a prior attempt got this far). Re-read and,
    // if it is already settled, return it untouched.
    const delivery =
      created ??
      (await tx.query.deliveries.findFirst({
        where: eq(deliveries.idempotencyKey, input.idempotencyKey),
      }))!;

    if (!created && delivery.status === "settled") {
      return {
        deliveryId: delivery.id,
        status: delivery.status,
        settlement: snapshot(delivery),
        alreadySettled: true,
      };
    }

    // Record the operational route as reported by the optimizer (not mock).
    await tx
      .insert(routes)
      .values({
        deliveryId: delivery.id,
        distanceKm,
        provider: "route-optimizer",
      })
      .onConflictDoNothing({ target: routes.deliveryId });

    const rule = await pricingService.resolveRule(tx as unknown as typeof db, {
      driverId: input.driverId,
      bakeryId: input.bakeryId,
      zone: input.zone ?? null,
      distanceKm,
    });
    const s = pricingService.computeSettlement(input.priceCents, distanceKm, rule);

    await tx
      .update(deliveries)
      .set({
        status: "settled",
        pricingRuleId: s.pricingRuleId,
        distanceKm: s.distanceKm,
        fuelCents: s.fuelCents,
        variableCents: s.variableCents,
        driverPayoutCents: s.driverPayoutCents,
        companyRevenueCents: s.companyRevenueCents,
        cogsCents: s.cogsCents,
        marginBps: s.marginBps,
        settledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, delivery.id));

    // Two ledger legs, both idempotent on the delivery id. Posting the same
    // delivery again is a no-op at the wallet layer (ON CONFLICT DO NOTHING).
    await walletService.post(
      {
        driverId: input.driverId,
        account: "fuel",
        type: "fuel_credit",
        amountCents: s.fuelCents,
        deliveryId: delivery.id,
        idempotencyKey: `fuel:${delivery.id}`,
        description: `Fuel for delivery ${input.waybill}`,
      },
      tx as unknown as typeof db,
    );

    await walletService.post(
      {
        driverId: input.driverId,
        account: "earnings",
        type: "delivery_earning",
        amountCents: s.driverPayoutCents,
        deliveryId: delivery.id,
        availableFrom: unlockDate(new Date()),
        idempotencyKey: `earning:${delivery.id}`,
        description: `Earning for delivery ${input.waybill}`,
      },
      tx as unknown as typeof db,
    );

    return {
      deliveryId: delivery.id,
      status: "settled",
      settlement: s,
      alreadySettled: false,
    };
  });
}
