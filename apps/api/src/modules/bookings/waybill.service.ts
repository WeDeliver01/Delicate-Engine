import { Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import type {
  Address,
  Contact,
  QuoteParcel,
  QuoteRequest,
  WaybillDocument,
} from "@delicate/contracts";
import { accounts, bookings, proofsOfDelivery, shipments } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { SchedulingService } from "../scheduling/scheduling.service.js";

/**
 * The waybill document.
 *
 * Assembled here rather than in the browser so that what is printed is the engine's account of
 * the consignment, not the page's. A courier's waybill is the evidence in a dispute about what
 * was handed over and to whom; it should not depend on which version of a React component the
 * customer happened to load.
 */
@Injectable()
export class WaybillService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
    private readonly scheduling: SchedulingService,
    private readonly clock: Clock,
  ) {}

  async forShipment(shipmentId: string, accountId: string | null): Promise<WaybillDocument> {
    const [row] = await this.dbs.db
      .select({
        shipment: shipments,
        bookingReference: bookings.reference,
        customerReference: bookings.customerReference,
        collection: bookings.collection,
        options: bookings.options,
        accountName: accounts.name,
      })
      .from(shipments)
      .innerJoin(bookings, eq(bookings.id, shipments.bookingId))
      .innerJoin(accounts, eq(accounts.id, shipments.accountId))
      .where(eq(shipments.id, shipmentId));

    if (!row) throw AppError.notFound("shipment", { shipmentId });
    if (accountId && row.shipment.accountId !== accountId) {
      throw AppError.notFound("shipment", { shipmentId });
    }

    const [company, policy, serviceLevel, pod, terms] = await Promise.all([
      this.settings.get("company.tax_profile"),
      this.settings.get("scheduling.policy"),
      this.catalog.serviceLevelByCode(row.shipment.serviceLevelCode).catch(() => null),
      this.dbs.db.query.proofsOfDelivery.findFirst({
        where: eq(proofsOfDelivery.shipmentId, shipmentId),
      }),
      this.settings.get("company.waybill_terms").catch(() => null),
    ]);

    const collection = row.collection as QuoteRequest["collection"];
    const options = row.options as QuoteRequest["options"];
    const parcels = row.shipment.parcels as QuoteParcel[];
    const window = policy.windows.find((w) => w.key === row.shipment.slotWindowKey);

    return {
      waybill: row.shipment.waybill,
      shipmentId: row.shipment.id,
      bookingReference: row.bookingReference,
      customerReference: row.customerReference,
      status: row.shipment.status,
      issuedAt: this.clock.now().toISOString(),

      carrier: company,

      sender: {
        accountName: row.accountName,
        address: collection.address,
        contact: collection.contact ?? null,
        instructions: collection.instructions ?? null,
      },

      recipient: {
        contact: row.shipment.recipient as Contact,
        address: row.shipment.deliveryAddress as Address,
        instructions: row.shipment.instructions,
      },

      service: {
        code: row.shipment.serviceLevelCode,
        name: serviceLevel?.name ?? row.shipment.serviceLevelCode,
        slotDate: row.shipment.slotDate,
        slotWindow: window?.label ?? row.shipment.slotWindowKey,
      },

      parcels,
      // The number of physical items, not the number of lines: three of one type is three
      // parcels, and that is what the person signing is counting.
      parcelCount: parcels.reduce((n, p) => n + p.quantity, 0),
      declaredValueCents: options.liabilityCover ? (options.declaredValueCents ?? null) : null,

      proofOfDelivery: pod
        ? {
            receivedBy: pod.receivedBy,
            capturedAt: pod.capturedAt.toISOString(),
            note: pod.note,
          }
        : null,

      terms: typeof terms === "string" && terms.trim() ? terms : DEFAULT_TERMS,
    };
  }

  /** Several at once, for a driver printing a run. Ordered so the stack matches the route. */
  async forShipments(ids: string[], accountId: string | null): Promise<WaybillDocument[]> {
    if (!ids.length) return [];
    const rows = await this.dbs.db
      .select({ id: shipments.id, sequence: shipments.sequence })
      .from(shipments)
      .where(inArray(shipments.id, ids));
    const ordered = rows.sort((a, b) => a.sequence - b.sequence).map((r) => r.id);
    return Promise.all(ordered.map((id) => this.forShipment(id, accountId)));
  }
}

/**
 * Used until the operator writes their own in the console. Deliberately short: a waybill that
 * nobody reads because it is a wall of small print protects nobody.
 */
const DEFAULT_TERMS = `Goods are accepted for carriage subject to our standard terms and conditions of carriage, available on request and at delicatecourier.co.za. The sender warrants that the contents are correctly described and lawfully carried. Our liability is limited to the declared value stated on this waybill where liability cover has been purchased, and is otherwise limited in terms of our standard conditions. Signature below is acknowledgement that the parcels listed were received in apparent good order and condition.`;
