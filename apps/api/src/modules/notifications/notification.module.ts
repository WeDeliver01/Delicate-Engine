import { Module, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { and, asc, eq, inArray } from "drizzle-orm";
import { formatCents, formatOperatingDateTime } from "@delicate/contracts";
import {
  accounts,
  assignments,
  drivers,
  memberships,
  packageTypes,
  shipments,
  users,
  wallets,
  type DbExecutor,
} from "@delicate/db";
import { ENV, type Env } from "../../config/env.js";
import { DbService } from "../../infra/db.module.js";
import { EventHandlerRegistry } from "../../worker/event-handlers.js";
import { BookingModule } from "../bookings/booking.module.js";
import { TrackingTokenService } from "../bookings/tracking-token.service.js";
import { NotificationService } from "./notification.service.js";
import type { ConsignmentRow } from "./email-layout.js";
import { NotificationDispatcher } from "./notification.dispatcher.js";
import {
  AccountNotificationController,
  AdminNotificationController,
} from "./notification.controller.js";
import { NOTIFICATION_TRANSPORTS } from "./transports/transport.js";
import { EmailTransport } from "./transports/email.transport.js";
import { SmsTransport, WhatsAppTransport } from "./transports/sms.transport.js";
import { TwilioTransport } from "./transports/twilio.transport.js";

/**
 * Telling people what happened. Every handler enqueues inside its own transaction, so a message
 * cannot exist for something that rolled back, and cannot be lost because the mail host happened
 * to be down when the event arrived — the worker sends it later.
 */
@Module({
  // For the recipient's live-tracking token. BookingModule knows nothing of notifications, so
  // this direction has no cycle in it.
  imports: [BookingModule],
  controllers: [AccountNotificationController, AdminNotificationController],
  providers: [
    NotificationService,
    NotificationDispatcher,
    {
      provide: NOTIFICATION_TRANSPORTS,
      // Twilio when it has credentials, the recording stub otherwise. Chosen here rather
      // than inside one transport so the console's "not configured" text keeps naming the
      // exact variable to set, instead of a live transport failing on every send.
      useFactory: (env: Env) => {
        const twilio = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
        return [
          new EmailTransport(env),
          twilio ? new TwilioTransport("sms", env) : new SmsTransport(),
          twilio ? new TwilioTransport("whatsapp", env) : new WhatsAppTransport(),
        ];
      },
      inject: [ENV],
    },
  ],
  exports: [NotificationService, NotificationDispatcher],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly notifications: NotificationService,
    private readonly dbs: DbService,
    private readonly trackingTokens: TrackingTokenService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationModule.name);
  }

  async onModuleInit(): Promise<void> {
    await this.notifications.seedTemplates();

    this.registry.register("booking.confirmed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "booking.confirmed",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `booking:${e.payload.bookingId}:confirmed`,
          payload: {
            customerName: account.name,
            reference: e.payload.reference,
            dropCount: `${e.payload.shipments.length} drop${e.payload.shipments.length === 1 ? "" : "s"}`,
            slot: e.payload.slotDate
              ? `${e.payload.slotDate} ${e.payload.slotWindowKey ?? ""}`.trim()
              : "today",
            waybills: e.payload.shipments.map((s) => s.waybill).join("\n"),
            total: formatCents(e.payload.totalCents),
            trackUrl: `${this.webUrl()}/portal/bookings/${e.payload.bookingId}`,
            // What is actually in the van. Rendered as a table by the email layout rather
            // than substituted into the words, because it is a table.
            consignment: await this.consignment(
              tx,
              e.payload.shipments.map((sh) => sh.shipmentId),
            ),
          },
        });
      });
    });

    this.registry.register("booking.rejected", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "booking.rejected",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `booking:${e.payload.bookingId}:rejected`,
          payload: {
            customerName: account.name,
            reason: humanise(e.payload.reason),
            nextStep:
              e.payload.reason === "insufficient_funds"
                ? "Top up your wallet and try again."
                : "Please try another slot, or get in touch and we will help.",
          },
        });
      });
    });

    this.registry.register("collection.completed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const driverName = await this.driverName(tx, e.payload.driverId);
        for (const shipmentId of e.payload.shipmentIds) {
          const ctx = await this.shipmentContext(tx, shipmentId);
          if (!ctx) continue;
          await this.notifications.enqueue(tx, {
            kind: "shipment.collected",
            audience: "customer",
            to: ctx.accountEmail,
            accountId: ctx.accountId,
            shipmentId,
            dedupeKey: `shipment:${shipmentId}:collected`,
            payload: { ...ctx.payload, driverName },
          });
        }
      });
    });

    /**
     * The driver moved it along, and the people waiting are told.
     *
     * Out for delivery used to be announced the moment a booking was collected, which was a
     * guess: a parcel collected at nine in a van doing twelve drops is not on its way to the
     * twelfth recipient. Now the driver says when it is true of a particular parcel, and this
     * is what tells the person waiting. That is also the point the driver's position becomes
     * visible, so the message and the map start saying the same thing at the same moment.
     */
    this.registry.register("shipment.status_changed", async (e) => {
      const to = e.payload.to;
      if (to !== "out_for_delivery" && to !== "on_hold" && to !== "returned_to_sender") return;
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId, {
          live: to === "out_for_delivery",
        });
        if (!ctx) return;
        if (to === "out_for_delivery") {
          // The person waiting for a cake is the one who most needs to know it is coming.
          await this.notifications.enqueue(tx, {
            kind: "shipment.out_for_delivery",
            audience: "recipient",
            to: ctx.recipientPhone,
            accountId: ctx.accountId,
            shipmentId: e.payload.shipmentId,
            dedupeKey: `shipment:${e.payload.shipmentId}:out_for_delivery`,
            payload: { ...ctx.payload, driverName: await this.driverFor(tx, e.payload.shipmentId) },
          });
          return;
        }
        // On hold and returned both go to the customer, not the recipient: these are about
        // what the business is doing with their parcel, and the person waiting for it cannot
        // act on either.
        await this.notifications.enqueue(tx, {
          kind: to === "on_hold" ? "shipment.on_hold" : "shipment.returned_to_sender",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          // The note is part of the key: a parcel can go on hold twice in a day for different
          // reasons, and the second reason is news.
          dedupeKey: `shipment:${e.payload.shipmentId}:${to}:${e.payload.note ?? ""}`,
          payload: { ...ctx.payload, reasonText: e.payload.note ?? "" },
        });
      });
    });

    /**
     * "Your driver is here."
     *
     * Only on a drop. Nobody waiting for a parcel cares that the driver reached the shop it is
     * being collected from, and a message that says nothing useful teaches people to ignore the
     * ones that do.
     */
    this.registry.register("trip.stop_arrived", async (e) => {
      if (e.payload.kind !== "drop" || !e.payload.shipmentId) return;
      const shipmentId = e.payload.shipmentId;
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, shipmentId, { live: true });
        if (!ctx) return;
        const driverName = await this.driverName(tx, e.payload.driverId);
        await this.notifications.enqueue(tx, {
          kind: "shipment.driver_arriving",
          audience: "recipient",
          to: ctx.recipientPhone,
          accountId: ctx.accountId,
          shipmentId,
          dedupeKey: `shipment:${shipmentId}:arriving:${e.payload.stopId}`,
          payload: { ...ctx.payload, driverName },
        });
      });
    });

    /**
     * The customer hears it from us before the recipient phones them.
     *
     * The sweep that raises this already emits at most one event per shipment per window, so
     * there is no risk of mailing someone every minute about the same late parcel.
     */
    this.registry.register("shipment.at_risk", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId);
        if (!ctx) return;
        await this.notifications.enqueue(tx, {
          kind: "shipment.at_risk",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `shipment:${e.payload.shipmentId}:at_risk:${e.payload.windowEndMinute ?? "none"}`,
          payload: {
            ...ctx.payload,
            windowEnd:
              e.payload.windowEndMinute == null
                ? "today"
                : `${String(Math.floor(e.payload.windowEndMinute / 60)).padStart(2, "0")}:${String(e.payload.windowEndMinute % 60).padStart(2, "0")}`,
            reasonText: AT_RISK_REASONS[e.payload.reason],
          },
        });
      });
    });

    this.registry.register("delivery.completed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        // The recipient's copy links to the delivery note. Issuing the token here as well as
        // on dispatch costs nothing — the same one comes back — and covers the parcel that
        // was delivered without an out-for-delivery message ever going out.
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId, { live: true });
        if (!ctx) return;
        const payload = {
          ...ctx.payload,
          receivedBy: e.payload.receivedBy,
          // In Johannesburg, not the container's UTC: this is a time the recipient reads
          // and checks against when the parcel actually turned up.
          deliveredAt: formatOperatingDateTime(e.occurredAt),
        };
        await this.notifications.enqueue(tx, {
          kind: "shipment.delivered",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `shipment:${e.payload.shipmentId}:delivered`,
          payload,
        });
        await this.notifications.enqueue(tx, {
          kind: "shipment.delivered",
          audience: "recipient",
          to: ctx.recipientPhone,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `shipment:${e.payload.shipmentId}:delivered-recipient`,
          payload,
        });
      });
    });

    this.registry.register("delivery.failed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId);
        if (!ctx) return;
        await this.notifications.enqueue(tx, {
          kind: "shipment.failed",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `shipment:${e.payload.shipmentId}:failed`,
          payload: {
            ...ctx.payload,
            reason: humanise(e.payload.reason),
            nextStep: "We will be in touch to arrange another attempt.",
          },
        });
      });
    });

    this.registry.register("wallet.topup_confirmed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "wallet.topped_up",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `topup:${e.payload.topUpId}:confirmed`,
          payload: {
            customerName: account.name,
            amount: formatCents(e.payload.amountCents),
            balance: formatCents(e.payload.balanceAfterCents),
          },
        });

        // Warn while there is still time to do something about it.
        const prefs = await this.notifications.preferencesFor(tx, e.payload.accountId);
        if (e.payload.balanceAfterCents < prefs.lowBalanceCents) {
          await this.notifications.enqueue(tx, {
            kind: "wallet.low_balance",
            audience: "customer",
            to: account.email,
            accountId: e.payload.accountId,
            dedupeKey: `wallet:${e.payload.accountId}:low:${e.payload.topUpId}`,
            payload: {
              customerName: account.name,
              balance: formatCents(e.payload.balanceAfterCents),
              portalUrl: `${this.webUrl()}/portal/wallet`,
            },
          });
        }
      });
    });

    this.registry.register("account.created", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "account.created",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `account:${e.payload.accountId}:created`,
          payload: {
            customerName: account.name,
            accountName: e.payload.name,
            portalUrl: `${this.webUrl()}/portal/book`,
          },
        });
      });
    });

    this.registry.register("booking.cancelled", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "booking.cancelled",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `booking:${e.payload.bookingId}:cancelled`,
          payload: {
            customerName: account.name,
            reference: e.payload.reference,
            // Rendered straight into the sentence, so it carries its own punctuation or
            // disappears entirely rather than leaving a dangling " because ".
            reason: e.payload.reason ? `: ${humanise(e.payload.reason)}` : "",
          },
        });
      });
    });

    this.registry.register("shipment.assigned", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId);
        if (!ctx) return;
        const shipment = await tx.query.shipments.findFirst({
          where: eq(shipments.id, e.payload.shipmentId),
        });
        await this.notifications.enqueue(tx, {
          kind: "shipment.assigned",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          // Keyed on the driver as well as the shipment: a redelivered event must not
          // message twice, but a genuine reassignment to a different driver is new news and
          // should reach the customer.
          dedupeKey: `shipment:${e.payload.shipmentId}:assigned:${e.payload.driverId}`,
          payload: {
            ...ctx.payload,
            driverName: await this.driverName(tx, e.payload.driverId),
            slot: shipment?.slotDate
              ? `${shipment.slotDate} ${shipment.slotWindowKey ?? ""}`.trim()
              : "today",
          },
        });
      });
    });

    this.registry.register("shipment.change_requested", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId);
        if (!ctx) return;
        await this.notifications.enqueue(tx, {
          // Applied straight away, or waiting for us — two different things to say.
          kind: e.payload.autoApplied ? "shipment.change_applied" : "shipment.change_requested",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `change:${e.payload.changeRequestId}:requested`,
          payload: {
            ...ctx.payload,
            changeKind: CHANGE_KIND_WORDS[e.payload.kind],
            heldBecause: e.payload.heldBecause ?? "we are checking it",
          },
        });
      });
    });

    this.registry.register("shipment.change_decided", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const ctx = await this.shipmentContext(tx, e.payload.shipmentId);
        if (!ctx) return;
        await this.notifications.enqueue(tx, {
          kind: e.payload.approved ? "shipment.change_approved" : "shipment.change_rejected",
          audience: "customer",
          to: ctx.accountEmail,
          accountId: ctx.accountId,
          shipmentId: e.payload.shipmentId,
          dedupeKey: `change:${e.payload.changeRequestId}:decided`,
          payload: {
            ...ctx.payload,
            changeKind: CHANGE_KIND_WORDS[e.payload.kind],
            note: e.payload.note ? ` ${e.payload.note}` : "",
          },
        });
      });
    });

    /*
      Money that moved without the customer asking. A refund, a goodwill credit, a correction
      against a complaint -- all legitimate, and all invisible until a balance is different
      from the one they remember. Telling them is also the cheapest fraud control we have:
      an adjustment nobody outside the business can explain gets queried the same day.
    */
    this.registry.register("wallet.adjusted", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        const credit = e.payload.amountCents >= 0;
        const balance = await this.balance(tx, e.payload.accountId);
        await this.notifications.enqueue(tx, {
          kind: "wallet.adjusted",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          // The entry, not the account: an account gets adjusted more than once.
          dedupeKey: `wallet:${e.payload.entryId}:adjusted`,
          payload: {
            customerName: account.name,
            amount: formatCents(Math.abs(e.payload.amountCents)),
            direction: credit ? "A credit" : "A deduction",
            verb: credit ? "added" : "taken",
            preposition: credit ? "to" : "from",
            reason: humanise(e.payload.reason),
            balance: balance === null ? "" : formatCents(balance),
            portalUrl: `${this.webUrl()}/portal/wallet`,
          },
        });
      });
    });

    this.registry.register("account.credit_terms_changed", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        const postpaid = e.payload.billingMode === "postpaid";
        await this.notifications.enqueue(tx, {
          kind: "account.terms_changed",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `account:${e.payload.accountId}:terms:${e.payload.billingMode}:${e.payload.creditLimitCents}`,
          payload: {
            customerName: account.name,
            accountName: account.name,
            billingMode: postpaid ? "on account" : "prepaid",
            explanation: postpaid
              ? `You can book up to ${formatCents(e.payload.creditLimitCents)} against your account and settle on invoice.`
              : "Deliveries are paid from your wallet balance. Top up before you book.",
            portalUrl: `${this.webUrl()}/portal/money`,
          },
        });
      });
    });

    /*
      Anyone on an account can spend its wallet, so adding somebody is a money event as much
      as an admin one. The owner hears about it whether they did it or somebody else did.
    */
    this.registry.register("membership.granted", async (e) => {
      await this.dbs.transaction(async (tx) => {
        const account = await this.account(tx, e.payload.accountId);
        const member = await tx.query.users.findFirst({ where: eq(users.id, e.payload.userId) });
        const owner = await this.owner(tx, e.payload.accountId);
        // The first membership is the owner creating their own account; account.created
        // already welcomed them, and "you were added to your own account" helps nobody.
        if (!member || member.id === owner?.id) return;
        await this.notifications.enqueue(tx, {
          kind: "account.member_added",
          audience: "customer",
          to: account.email,
          accountId: e.payload.accountId,
          dedupeKey: `membership:${e.payload.accountId}:${e.payload.userId}:granted`,
          payload: {
            customerName: account.name,
            accountName: account.name,
            memberEmail: member.email,
            role: humanise(e.payload.role),
            portalUrl: `${this.webUrl()}/portal/members`,
          },
        });
      });
    });

    this.logger.info("notification handlers registered");
  }

  /**
   * Who to write to for an account, and what to call them.
   *
   * The billing address is the one the customer chose, so it wins. Falling back to the owner's
   * sign-in address matters more than it looks: an account created before we started setting a
   * billing address has none, and a message with nowhere to go is filed as suppressed rather
   * than failed -- so the whole account goes quiet and nothing anywhere says why.
   */
  private async account(tx: DbExecutor, accountId: string) {
    const row = await tx.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
    if (!row) return { name: "there", email: null };
    const owner = await this.owner(tx, accountId);
    return { name: row.name, email: row.billingEmail ?? owner?.email ?? null };
  }

  /**
   * The parcels on a booking, named and counted.
   *
   * Package types are looked up by id because the shipment stores the id, and "1 x Xsmall
   * Cake Box" is what a customer recognises -- a uuid tells them nothing about whether we
   * understood the order.
   */
  private async consignment(tx: DbExecutor, shipmentIds: string[]): Promise<ConsignmentRow[]> {
    if (shipmentIds.length === 0) return [];
    const rows = await tx
      .select({
        waybill: shipments.waybill,
        recipient: shipments.recipient,
        deliveryAddress: shipments.deliveryAddress,
        parcels: shipments.parcels,
      })
      .from(shipments)
      .where(inArray(shipments.id, shipmentIds))
      .orderBy(asc(shipments.waybill));

    const nameOf = new Map((await tx.select().from(packageTypes)).map((t) => [t.id, t.name]));

    return rows.map((row) => {
      const parcels = (row.parcels ?? []) as {
        packageTypeId: string;
        quantity: number;
        weightKg: number | null;
      }[];
      const address = row.deliveryAddress as { suburb?: string | null; formatted?: string };
      const recipient = row.recipient as { name?: string | null };
      const kg = parcels.reduce((sum, par) => sum + (par.weightKg ?? 0) * (par.quantity || 1), 0);
      return {
        waybill: row.waybill,
        destination: address.suburb ?? address.formatted ?? "the destination",
        recipient: recipient.name ?? null,
        contents:
          parcels
            .map((par) => `${par.quantity || 1} x ${nameOf.get(par.packageTypeId) ?? "parcel"}`)
            .join(", ") || "1 x parcel",
        weight: kg > 0 ? `${kg.toFixed(1)} kg` : null,
      };
    });
  }

  /** The wallet balance as it stands now, for a message that quotes it. */
  private async balance(tx: DbExecutor, accountId: string): Promise<number | null> {
    const row = await tx.query.wallets.findFirst({ where: eq(wallets.accountId, accountId) });
    return row?.balanceCents ?? null;
  }

  /** Whoever owns the account: the oldest owner membership, so it is stable. */
  private async owner(
    tx: DbExecutor,
    accountId: string,
  ): Promise<{ id: string; email: string } | null> {
    const [row] = await tx
      .select({ id: users.id, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "customer_owner")))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    return row ?? null;
  }

  private async driverName(tx: DbExecutor, driverId: string): Promise<string> {
    const row = await tx.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
    return row?.fullName ?? "Your driver";
  }

  /**
   * Who is carrying this shipment, from its live assignment.
   *
   * A status change says nothing about who made it, so the driver is looked up rather than
   * taken from the event. Falls back to "Your driver" rather than leaving the recipient a
   * message with a hole in it.
   */
  private async driverFor(tx: DbExecutor, shipmentId: string): Promise<string> {
    const [row] = await tx
      .select({ fullName: drivers.fullName })
      .from(assignments)
      .innerJoin(drivers, eq(drivers.id, assignments.driverId))
      .where(and(eq(assignments.shipmentId, shipmentId), eq(assignments.active, true)))
      .limit(1);
    return row?.fullName ?? "Your driver";
  }

  /** Everything a shipment template needs, or null if the shipment has gone. */
  /**
   * `live` mints the recipient's tracking token, and is opt-in rather than always on: only
   * messages addressed to the person waiting carry that link, so a shipment that is only ever
   * written about to the customer never has a token issued for it at all.
   */
  private async shipmentContext(tx: DbExecutor, shipmentId: string, opts?: { live?: boolean }) {
    const shipment = await tx.query.shipments.findFirst({ where: eq(shipments.id, shipmentId) });
    if (!shipment) return null;
    const account = await this.account(tx, shipment.accountId);
    const address = shipment.deliveryAddress as { suburb?: string | null; city?: string | null };
    const recipient = shipment.recipient as { name?: string; phone?: string };
    const liveUrl = opts?.live ? await this.trackingTokens.linkFor(tx, shipmentId) : "";
    return {
      accountId: shipment.accountId,
      accountEmail: account.email,
      recipientPhone: recipient.phone ?? null,
      payload: {
        customerName: account.name,
        recipientName: recipient.name ?? "there",
        waybill: shipment.waybill,
        destination: address.suburb ?? address.city ?? "the destination",
        trackUrl: `${this.webUrl()}/track?waybill=${shipment.waybill}`,
        liveUrl,
      },
    };
  }

  private webUrl(): string {
    return process.env["WEB_PUBLIC_URL"] ?? "http://localhost:3000";
  }
}

/** The change kinds in the words a customer used when they asked for it. */
const CHANGE_KIND_WORDS: Record<string, string> = {
  recipient_contact: "recipient details",
  delivery_address: "delivery address",
  instructions: "delivery instructions",
  reschedule: "delivery date",
};

/** Turn an internal reason code into something a customer can read. */
function humanise(reason: string): string {
  return reason.replace(/_/g, " ");
}

/** Why a shipment is at risk, in a sentence a customer reads without decoding it. */
const AT_RISK_REASONS: Record<string, string> = {
  window_passed: "The driver has not reached it inside the window we promised.",
  eta_after_window: "The driver's route now runs past the window we promised.",
  unassigned_near_cutoff: "It is not yet on a driver's round for today.",
};
