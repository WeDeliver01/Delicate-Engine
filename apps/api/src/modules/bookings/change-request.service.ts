import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  operatingToday,
  type ChangeRequest,
  type ChangeRequestKind,
  type ChangeRequestPayload,
  type ChangeRequestStatus,
  type CreateChangeRequest,
  type DecideChangeRequest,
  type ShipmentStatus,
} from "@delicate/contracts";
import { shipmentChangeRequests, shipments, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { SchedulingService } from "../scheduling/scheduling.service.js";

/**
 * Changes to a shipment that is already booked.
 *
 * The rule that decides who may approve what:
 *
 *   - A phone number or a delivery note costs nothing to change and helps the driver, so the
 *     engine applies it immediately. Making someone wait for a human to approve a corrected
 *     phone number would mean the driver arrives with the wrong one.
 *   - An address changes the distance, which changes the price and possibly the route the van
 *     is already driving, so it waits for ops.
 *   - A new date releases a reserved slot and takes another, which can fail, so it waits too.
 *
 * Everything is recorded the same way either way, so the customer sees one consistent story
 * and there is one place to look for what was changed on a shipment and who allowed it.
 */
@Injectable()
export class ChangeRequestService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly scheduling: SchedulingService,
  ) {}

  /** Statuses where the parcel has not yet reached its end state, so a change still means something. */
  private static readonly OPEN: ShipmentStatus[] = [
    "booked",
    "assigned",
    "collected",
    "in_transit",
  ];

  /**
   * Whether the engine can apply this itself, and if not, what to tell the customer it is
   * waiting on. Returning the reason rather than a bare boolean means the held request can
   * explain itself in the queue and in the customer's own view.
   */
  private holdReason(kind: ChangeRequestKind, status: ShipmentStatus): string | null {
    switch (kind) {
      case "recipient_contact":
      case "instructions":
        // Free, and most useful the sooner it reaches the driver.
        return null;
      case "delivery_address":
        return status === "booked"
          ? "an address change alters the distance, so the price has to be re-checked"
          : "the parcel is already with a driver, so the route has to be re-planned";
      case "reschedule":
        return "a new date needs a slot on that day, which has to be confirmed";
    }
  }

  async create(
    shipmentId: string,
    accountId: string,
    input: CreateChangeRequest,
  ): Promise<ChangeRequest> {
    const userId = requestContext.get()?.userId ?? null;

    return this.dbs.db.transaction(async (tx) => {
      // Locked for the length of the decision: two tabs asking for different addresses at the
      // same moment must not both read the same "previous" value and both look applied.
      const [shipment] = await tx
        .select()
        .from(shipments)
        .where(and(eq(shipments.id, shipmentId), eq(shipments.accountId, accountId)))
        .for("update");
      if (!shipment) throw AppError.notFound("shipment", { shipmentId });

      if (!ChangeRequestService.OPEN.includes(shipment.status)) {
        throw AppError.conflict(
          "shipment_closed",
          `this shipment is ${shipment.status} — it cannot be changed`,
        );
      }

      const kind = input.payload.kind;
      const duplicate = await tx.query.shipmentChangeRequests.findFirst({
        where: and(
          eq(shipmentChangeRequests.shipmentId, shipmentId),
          eq(shipmentChangeRequests.kind, kind),
          eq(shipmentChangeRequests.status, "pending"),
        ),
      });
      if (duplicate) {
        throw AppError.conflict(
          "change_already_pending",
          "a change to this is already waiting for approval",
        );
      }

      const previous = this.snapshot(kind, shipment);
      const heldBecause = this.holdReason(kind, shipment.status);
      const status: ChangeRequestStatus = heldBecause ? "pending" : "auto_applied";

      if (!heldBecause) await this.apply(tx, shipmentId, input.payload);

      const [row] = await tx
        .insert(shipmentChangeRequests)
        .values({
          shipmentId,
          accountId,
          kind,
          status,
          requested: input.payload,
          previous,
          reason: input.reason ?? null,
          heldBecause,
          requestedByUserId: userId,
          ...(heldBecause ? {} : { decidedAt: this.clock.now() }),
        })
        .returning();

      await this.audit.record(tx, {
        action: heldBecause ? "shipment.change_requested" : "shipment.change_applied",
        entityType: "shipment",
        entityId: shipmentId,
        before: previous,
        after: input.payload,
      });

      await this.outbox.emit(
        tx,
        "shipment.change_requested",
        {
          changeRequestId: row!.id,
          shipmentId,
          accountId,
          waybill: shipment.waybill,
          kind,
          autoApplied: !heldBecause,
          heldBecause,
        },
        // The request row is the business fact, and there is exactly one of it.
        { dedupeKey: `change-requested:${row!.id}` },
      );

      return toChangeRequest(row!, shipment.waybill);
    });
  }

  /** Ops rules on a held change. Approving is what actually writes it onto the shipment. */
  async decide(id: string, input: DecideChangeRequest): Promise<ChangeRequest> {
    const userId = requestContext.get()?.userId ?? null;

    return this.dbs.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(shipmentChangeRequests)
        .where(eq(shipmentChangeRequests.id, id))
        .for("update");
      if (!row) throw AppError.notFound("change_request", { id });
      if (row.status !== "pending") {
        throw AppError.conflict("already_decided", `this request is already ${row.status}`);
      }

      const [shipment] = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.id, row.shipmentId))
        .for("update");
      if (!shipment) throw AppError.notFound("shipment", { shipmentId: row.shipmentId });

      const approved = input.decision === "approve";
      if (approved) {
        // The shipment may have moved on while the request sat in the queue. Applying a new
        // address to something already delivered would rewrite history.
        if (!ChangeRequestService.OPEN.includes(shipment.status)) {
          throw AppError.conflict(
            "shipment_closed",
            `this shipment is now ${shipment.status} — the change can no longer be applied`,
          );
        }
        await this.apply(tx, row.shipmentId, row.requested as ChangeRequestPayload);
      }

      const [updated] = await tx
        .update(shipmentChangeRequests)
        .set({
          status: approved ? "approved" : "rejected",
          decidedByUserId: userId,
          decidedAt: this.clock.now(),
          decisionNote: input.note ?? null,
        })
        .where(eq(shipmentChangeRequests.id, id))
        .returning();

      await this.audit.record(tx, {
        action: approved ? "shipment.change_approved" : "shipment.change_rejected",
        entityType: "shipment",
        entityId: row.shipmentId,
        before: row.previous,
        after: approved ? row.requested : null,
      });

      await this.outbox.emit(
        tx,
        "shipment.change_decided",
        {
          changeRequestId: id,
          shipmentId: row.shipmentId,
          accountId: row.accountId,
          waybill: shipment.waybill,
          kind: row.kind,
          approved,
          note: input.note ?? null,
        },
        // A request is decided once: the row is locked and refuses a second ruling, so its id
        // is the whole key.
        { dedupeKey: `change-decided:${id}` },
      );

      return toChangeRequest(updated!, shipment.waybill);
    });
  }

  /** A customer taking back a request ops has not looked at yet. */
  async withdraw(id: string, accountId: string): Promise<ChangeRequest> {
    const [row] = await this.dbs.db
      .update(shipmentChangeRequests)
      .set({ status: "withdrawn", decidedAt: this.clock.now() })
      .where(
        and(
          eq(shipmentChangeRequests.id, id),
          eq(shipmentChangeRequests.accountId, accountId),
          eq(shipmentChangeRequests.status, "pending"),
        ),
      )
      .returning();
    if (!row) throw AppError.notFound("change_request", { id });
    return toChangeRequest(row);
  }

  /** The ops queue, and a customer's own history. */
  async list(opts: {
    accountId?: string;
    shipmentId?: string;
    status?: ChangeRequestStatus[];
    limit?: number;
  }) {
    const rows = await this.dbs.db
      .select({ req: shipmentChangeRequests, waybill: shipments.waybill })
      .from(shipmentChangeRequests)
      .innerJoin(shipments, eq(shipments.id, shipmentChangeRequests.shipmentId))
      .where(
        and(
          opts.accountId ? eq(shipmentChangeRequests.accountId, opts.accountId) : undefined,
          opts.shipmentId ? eq(shipmentChangeRequests.shipmentId, opts.shipmentId) : undefined,
          opts.status?.length ? inArray(shipmentChangeRequests.status, opts.status) : undefined,
        ),
      )
      .orderBy(desc(shipmentChangeRequests.createdAt))
      .limit(opts.limit ?? 100);
    return { items: rows.map((r) => toChangeRequest(r.req, r.waybill)) };
  }

  /** How many are waiting, for the badge on the console's sidebar. */
  async pendingCount(): Promise<number> {
    const rows = await this.dbs.db
      .select({ id: shipmentChangeRequests.id })
      .from(shipmentChangeRequests)
      .where(eq(shipmentChangeRequests.status, "pending"));
    return rows.length;
  }

  /** What the fields hold now, so an approval years later can still be read against it. */
  private snapshot(kind: ChangeRequestKind, s: typeof shipments.$inferSelect) {
    switch (kind) {
      case "recipient_contact":
        return { recipient: s.recipient };
      case "delivery_address":
        return { deliveryAddress: s.deliveryAddress };
      case "instructions":
        return { instructions: s.instructions };
      case "reschedule":
        return { slotDate: s.slotDate, slotWindowKey: s.slotWindowKey };
    }
  }

  /** Write the change onto the shipment. Only ever called inside the deciding transaction. */
  private async apply(tx: DbExecutor, shipmentId: string, payload: ChangeRequestPayload) {
    switch (payload.kind) {
      case "recipient_contact":
        await tx
          .update(shipments)
          .set({ recipient: payload.recipient })
          .where(eq(shipments.id, shipmentId));
        return;
      case "delivery_address":
        await tx
          .update(shipments)
          .set({ deliveryAddress: payload.deliveryAddress })
          .where(eq(shipments.id, shipmentId));
        return;
      case "instructions":
        await tx
          .update(shipments)
          .set({ instructions: payload.instructions })
          .where(eq(shipments.id, shipmentId));
        return;
      case "reschedule": {
        // Refusing a date already gone is worth doing here rather than trusting the form: a
        // request can sit in the queue overnight and be approved the morning after.
        if (payload.slotDate < operatingToday(this.clock.now())) {
          throw AppError.conflict("date_passed", "that date has already passed");
        }
        const [current] = await tx
          .select({ date: shipments.slotDate, windowKey: shipments.slotWindowKey })
          .from(shipments)
          .where(eq(shipments.id, shipmentId));

        // Take the new space before giving up the old one. If the new day is full this throws
        // and the whole transaction rolls back, leaving the shipment on the slot it already
        // had — whereas releasing first could drop the only space on a busy day and fail to
        // get it back.
        await this.scheduling.reserve(tx, {
          date: payload.slotDate,
          windowKey: payload.slotWindowKey,
        });
        if (current?.date && current.windowKey) {
          await this.scheduling.release(tx, {
            date: current.date,
            windowKey: current.windowKey,
          });
        }

        await tx
          .update(shipments)
          .set({ slotDate: payload.slotDate, slotWindowKey: payload.slotWindowKey })
          .where(eq(shipments.id, shipmentId));
        return;
      }
    }
  }
}

function toChangeRequest(
  r: typeof shipmentChangeRequests.$inferSelect,
  waybill?: string,
): ChangeRequest {
  return {
    id: r.id,
    shipmentId: r.shipmentId,
    accountId: r.accountId,
    ...(waybill ? { waybill } : {}),
    kind: r.kind,
    status: r.status,
    requested: r.requested as Record<string, unknown>,
    previous: r.previous as Record<string, unknown>,
    reason: r.reason,
    heldBecause: r.heldBecause,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
