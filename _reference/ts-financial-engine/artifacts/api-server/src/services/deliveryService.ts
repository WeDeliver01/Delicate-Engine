import { and, eq, isNull, or } from "drizzle-orm";
import { db, drivers, bakeries, driverBakeryAssignments, deliveries, zoneRates } from "@workspace/db";
import { unlockDate } from "../lib/vesting.js";
import { routeService } from "./routeService.js";
import { pricingService, type Settlement } from "./pricingService.js";
import { walletService } from "./walletService.js";

export interface CreateDeliveryInput {
  bakeryId: string;
  driverId: string;
  customer: { lat: number; lng: number; address?: string };
  zone?: string;
  priceCents?: number;
  idempotencyKey: string;
  currency?: string;
}

export interface CreateDeliveryResult {
  deliveryId: string;
  status: string;
  settlement: Settlement;
  alreadyExisted: boolean;
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

async function resolvePrice(bakeryId: string, zone?: string): Promise<number | null> {
  if (!zone) return null;
  const rows = await db
    .select()
    .from(zoneRates)
    .where(and(eq(zoneRates.zone, zone), or(eq(zoneRates.bakeryId, bakeryId), isNull(zoneRates.bakeryId))));
  const specific = rows.find((r) => r.bakeryId === bakeryId);
  return (specific ?? rows[0])?.priceCents ?? null;
}

export class DeliveryService {
  async createAndSettle(input: CreateDeliveryInput): Promise<CreateDeliveryResult> {
    const existing = await db.query.deliveries.findFirst({ where: eq(deliveries.idempotencyKey, input.idempotencyKey) });
    if (existing && existing.status === "settled") {
      return { deliveryId: existing.id, status: existing.status, alreadyExisted: true, settlement: snapshot(existing) };
    }

    const [driver, bakery, assignment] = await Promise.all([
      db.query.drivers.findFirst({ where: and(eq(drivers.id, input.driverId), eq(drivers.active, true)) }),
      db.query.bakeries.findFirst({ where: and(eq(bakeries.id, input.bakeryId), eq(bakeries.active, true)) }),
      db.query.driverBakeryAssignments.findFirst({
        where: and(eq(driverBakeryAssignments.driverId, input.driverId), eq(driverBakeryAssignments.bakeryId, input.bakeryId), eq(driverBakeryAssignments.active, true)),
      }),
    ]);
    if (!driver) throw new Error(`Driver ${input.driverId} not found / inactive`);
    if (!bakery) throw new Error(`Bakery ${input.bakeryId} not found / inactive`);
    if (!assignment) throw new Error(`Driver is not assigned to this bakery`);

    const priceCents = input.priceCents ?? (await resolvePrice(input.bakeryId, input.zone));
    if (priceCents == null) throw new Error(`No price provided and no zone rate found`);

    const route = await routeService.compute(
      { lat: driver.depotLat, lng: driver.depotLng },
      { lat: bakery.pickupLat, lng: bakery.pickupLng },
      { lat: input.customer.lat, lng: input.customer.lng },
    );

    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(deliveries)
        .values({
          bakeryId: input.bakeryId,
          driverId: input.driverId,
          customerAddress: input.customer.address ?? null,
          customerLat: input.customer.lat,
          customerLng: input.customer.lng,
          zone: input.zone ?? null,
          priceCents,
          currency: input.currency ?? "ZAR",
          idempotencyKey: input.idempotencyKey,
          status: "created",
        })
        .onConflictDoNothing({ target: deliveries.idempotencyKey })
        .returning();

      const delivery =
        created ??
        (await tx.query.deliveries.findFirst({ where: eq(deliveries.idempotencyKey, input.idempotencyKey) }))!;
      if (!created) {
        return { deliveryId: delivery.id, status: delivery.status, alreadyExisted: true, settlement: snapshot(delivery) };
      }

      await routeService.persist(tx as unknown as typeof db, delivery.id, route);

      const rule = await pricingService.resolveRule(tx as unknown as typeof db, {
        driverId: input.driverId,
        bakeryId: input.bakeryId,
        zone: input.zone ?? null,
        distanceKm: route.distanceKm,
      });
      const s = pricingService.computeSettlement(priceCents, route.distanceKm, rule);

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

      await walletService.post(
        {
          driverId: input.driverId,
          account: "fuel",
          type: "fuel_credit",
          amountCents: s.fuelCents,
          deliveryId: delivery.id,
          idempotencyKey: `fuel:${delivery.id}`,
          description: `Fuel for delivery ${delivery.id}`,
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
          description: `Earning for delivery ${delivery.id}`,
        },
        tx as unknown as typeof db,
      );

      return { deliveryId: delivery.id, status: "settled", alreadyExisted: false, settlement: s };
    });
  }

  async refund(deliveryId: string): Promise<void> {
    const delivery = await db.query.deliveries.findFirst({ where: eq(deliveries.id, deliveryId) });
    if (!delivery || delivery.driverPayoutCents == null) throw new Error("Delivery not settled");
    await db.transaction(async (tx) => {
      await walletService.post(
        {
          driverId: delivery.driverId,
          account: "earnings",
          type: "refund",
          amountCents: -delivery.driverPayoutCents!,
          deliveryId,
          idempotencyKey: `refund:${deliveryId}`,
          description: `Reversal for delivery ${deliveryId}`,
        },
        tx as unknown as typeof db,
      );
      await tx.update(deliveries).set({ status: "cancelled", updatedAt: new Date() }).where(eq(deliveries.id, deliveryId));
    });
  }
}

export const deliveryService = new DeliveryService();
