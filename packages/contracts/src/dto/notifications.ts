import { z } from "zod";
import { Uuid } from "./common.js";

/**
 * Notifications.
 *
 * Every message the business sends is recorded before it is sent and never deleted, for the same
 * reason the ledger is append-only: "we told the customer" is a claim that has to be provable.
 * A row exists whether or not a provider is configured — an unsendable message is `suppressed`
 * with a reason, not silently dropped, so nobody discovers months later that SMS was never wired.
 */

export const NotificationChannel = z.enum(["email", "sms", "whatsapp"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/**
 * queued → sending → sent is the happy path. `failed` retries; `suppressed` means we chose not
 * to send (no provider, no address, or the recipient opted out) and will not retry.
 */
export const NotificationStatus = z.enum([
  "queued",
  "sending",
  "sent",
  "failed",
  "suppressed",
  "dead",
]);
export type NotificationStatus = z.infer<typeof NotificationStatus>;

/**
 * What we send and when. Adding one here is the only way to send anything: a template key that
 * does not exist cannot be enqueued.
 */
export const NotificationKind = z.enum([
  "account.created",
  "booking.confirmed",
  "booking.rejected",
  "booking.cancelled",
  "shipment.assigned",
  "shipment.collected",
  "shipment.out_for_delivery",
  "shipment.delivered",
  "shipment.failed",
  "shipment.change_applied",
  "shipment.change_requested",
  "shipment.change_approved",
  "shipment.change_rejected",
  "wallet.topped_up",
  "wallet.low_balance",
  "invoice.issued",
  "invoice.overdue",
]);

/** Grouped for the console, so a screen of toggles reads as a few decisions rather than 17. */
export const NOTIFICATION_GROUPS: { group: string; kinds: string[] }[] = [
  { group: "Sign-ups", kinds: ["account.created"] },
  { group: "Bookings", kinds: ["booking.confirmed", "booking.rejected", "booking.cancelled"] },
  {
    group: "Tracking",
    kinds: [
      "shipment.assigned",
      "shipment.collected",
      "shipment.out_for_delivery",
      "shipment.delivered",
      "shipment.failed",
    ],
  },
  {
    group: "Changes",
    kinds: [
      "shipment.change_applied",
      "shipment.change_requested",
      "shipment.change_approved",
      "shipment.change_rejected",
    ],
  },
  {
    group: "Money",
    kinds: ["wallet.topped_up", "wallet.low_balance", "invoice.issued", "invoice.overdue"],
  },
];

/**
 * Who inside the business gets a copy of what goes out.
 *
 * Every message can be copied to one internal address. `kinds: "all"` does exactly that —
 * which is a lot of mail, and the reason the list can be narrowed instead without touching
 * code. Every message is recorded and searchable in the console regardless of this setting,
 * so narrowing it loses nothing but inbox volume.
 */
export const AdminCopySettings = z.object({
  enabled: z.boolean(),
  address: z.string().email(),
  kinds: z.union([z.literal("all"), z.array(NotificationKind)]),
});
export type AdminCopySettings = z.infer<typeof AdminCopySettings>;
export type NotificationKind = z.infer<typeof NotificationKind>;

/** Who a message is aimed at: the account that booked, or the person receiving the parcel. */
export const NotificationAudience = z.enum(["customer", "recipient"]);
export type NotificationAudience = z.infer<typeof NotificationAudience>;

export const NotificationTemplate = z.object({
  id: Uuid,
  kind: NotificationKind,
  channel: NotificationChannel,
  audience: NotificationAudience,
  /** Email only. */
  subject: z.string().max(200).nullable(),
  /** Mustache-ish `{{ field }}` placeholders, filled from the notification's payload. */
  body: z.string().min(1).max(4000),
  enabled: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type NotificationTemplate = z.infer<typeof NotificationTemplate>;

export const UpdateTemplateRequest = NotificationTemplate.pick({
  subject: true,
  body: true,
  enabled: true,
}).partial();
export type UpdateTemplateRequest = z.infer<typeof UpdateTemplateRequest>;

export const Notification = z.object({
  id: Uuid,
  kind: NotificationKind,
  channel: NotificationChannel,
  audience: NotificationAudience,
  status: NotificationStatus,
  accountId: Uuid.nullable(),
  shipmentId: Uuid.nullable(),
  /** Redacted on the way out: the last few characters only. */
  to: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  attempts: z.number().int(),
  /** Why it was suppressed or what the provider said when it failed. */
  detail: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof Notification>;

/**
 * Per-account opt-outs. Transactional messages about a delivery in progress are not optional —
 * a recipient expecting a cake needs to know the driver is coming — so only the marketing-ish
 * kinds can be switched off here.
 */
export const NotificationPreferences = z.object({
  accountId: Uuid,
  email: z.boolean(),
  sms: z.boolean(),
  whatsapp: z.boolean(),
  /** Notify the parcel's recipient, not just the account that booked. */
  notifyRecipients: z.boolean(),
  /** Warn when the wallet can no longer cover a typical booking. */
  lowBalanceCents: z.number().int().nonnegative(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const UpdateNotificationPreferencesRequest = NotificationPreferences.omit({
  accountId: true,
}).partial();
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesRequest
>;

/** What the admin console shows about the sending pipeline. */
export const NotificationChannelStatus = z.object({
  channel: NotificationChannel,
  configured: z.boolean(),
  provider: z.string(),
  /** Why it cannot send, when it cannot. */
  detail: z.string().nullable(),
  queued: z.number().int(),
  sent24h: z.number().int(),
  failed24h: z.number().int(),
  suppressed24h: z.number().int(),
});
export type NotificationChannelStatus = z.infer<typeof NotificationChannelStatus>;
