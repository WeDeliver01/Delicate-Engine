import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  etaPhrase,
  type DriverNotifyRequest,
  type DriverNotifyResult,
  type Driver,
} from "@delicate/contracts";
import { accounts, bookings, shipments } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AppError } from "../../common/errors.js";
import { NotificationService } from "../notifications/notification.service.js";
import { AssignmentService } from "../dispatch/assignment.service.js";
import { TrackingTokenService } from "../bookings/tracking-token.service.js";

interface Contactable {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * The driver telling someone where they are.
 *
 * Separate from the automatic messages, which say what the engine knows: collected, out for
 * delivery, delivered. These are the ones only the driver knows — ten minutes out, standing at
 * the gate — and they go when the driver decides, not when a status changes.
 *
 * Every send is written down whether or not it leaves the building, because a driver's claim
 * that they told someone they were coming is worth having a record of.
 */
@Injectable()
export class DriverNotifyService {
  constructor(
    private readonly dbs: DbService,
    private readonly notifications: NotificationService,
    private readonly assignment: AssignmentService,
    private readonly trackingTokens: TrackingTokenService,
  ) {}

  async notify(driver: Driver, input: DriverNotifyRequest): Promise<DriverNotifyResult> {
    const { configured, detail } = this.notifications.channelConfigured(input.channel);

    return this.dbs.transaction(async (tx) => {
      const shipment = await tx.query.shipments.findFirst({
        where: eq(shipments.id, input.shipmentId),
      });
      if (!shipment) throw AppError.notFound("shipment");
      const active = await this.assignment.activeAssignment(input.shipmentId, tx);
      if (!active || active.driverId !== driver.id)
        throw AppError.forbidden("this shipment is not assigned to you");

      const who = await this.addressee(tx, shipment, input);
      const to = (input.channel === "sms" ? who.contact.phone : who.contact.email) ?? null;
      // Only the recipient's messages carry the live link; the collection contact is not shown
      // a driver's position before collection (docs/TRACKING.md §6).
      const liveUrl =
        input.target === "recipient" ? await this.trackingTokens.linkFor(tx, shipment.id) : "";

      const [message] = await this.notifications.enqueue(tx, {
        kind:
          input.target === "recipient"
            ? "shipment.driver_arriving"
            : "shipment.collection_arriving",
        audience: input.target === "recipient" ? "recipient" : "customer",
        channel: input.channel,
        to,
        accountId: shipment.accountId,
        shipmentId: shipment.id,
        // The chosen gap is part of the key: "ten minutes away" and "I have arrived" are two
        // things to say, and a driver who taps the same one twice meant it once.
        dedupeKey: `shipment:${shipment.id}:arriving:${input.target}:${input.eta}`,
        payload: {
          ...who.payload,
          waybill: shipment.waybill,
          driverName: driver.fullName,
          eta: etaPhrase(input.eta),
          liveUrl,
        },
      });

      if (!message) {
        return {
          delivery: "suppressed" as const,
          channel: input.channel,
          to,
          text: "",
          reason: `Nothing is configured to send by ${input.channel} for this.`,
        };
      }

      // Three different outcomes, and the difference between the last two matters.
      //
      // No provider is a gap in our setup, and the driver's own phone closes it: they send the
      // text themselves, from a number the recipient can reply to.
      //
      // An opt-out is not a gap. The account asked us not to contact their recipients, or
      // there is no number on file, and handing the driver the message to send anyway would
      // route around a decision the customer made. So that one is refused with its reason.
      if (!message.suppressedBecause) {
        return {
          delivery: "engine" as const,
          channel: input.channel,
          to,
          text: message.body,
          reason: null,
        };
      }
      // Keyed on what stopped it, not on whether a provider happens to be configured. Those
      // came apart the moment an opted-out account was tested against an unconfigured
      // provider: both were true, and the message went to the driver's phone to send by
      // hand — round the back of a decision the customer had made.
      const noProvider =
        message.suppressedBy === "transport" && input.channel === "sms" && Boolean(to);
      return {
        delivery: noProvider ? ("driver" as const) : ("suppressed" as const),
        channel: input.channel,
        to,
        text: message.body,
        reason: noProvider
          ? (detail ?? "No SMS provider is configured, so send it from your phone.")
          : message.suppressedBecause,
      };
    });
  }

  /** Who the message is for, and the words that name them. */
  private async addressee(
    tx: Parameters<NotificationService["enqueue"]>[0],
    shipment: typeof shipments.$inferSelect,
    input: DriverNotifyRequest,
  ): Promise<{ contact: Contactable; payload: Record<string, unknown> }> {
    if (input.target === "recipient") {
      const recipient = (shipment.recipient ?? {}) as Contactable;
      // The recipient's templates say who the parcel is from, so the sender's name has to be
      // in the payload. It was not, and the message read "your delivery from ."
      const [account] = await tx
        .select({ name: accounts.name })
        .from(accounts)
        .where(eq(accounts.id, shipment.accountId));
      return {
        contact: recipient,
        payload: {
          recipientName: recipient.name ?? "there",
          customerName: account?.name ?? "the sender",
        },
      };
    }
    // The collection contact is whoever is handing the parcel over, which is on the booking
    // rather than the shipment: one collection covers every parcel in it.
    const booking = await tx.query.bookings.findFirst({
      where: eq(bookings.id, shipment.bookingId),
    });
    const collection = (booking?.collection ?? {}) as { contact?: Contactable | null };
    const contact = collection.contact ?? {};
    return { contact, payload: { customerName: contact.name ?? "there" } };
  }
}
