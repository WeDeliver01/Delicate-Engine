import { z } from "zod";
import { Uuid } from "./dto/common.js";
import { NotificationChannel } from "./dto/notifications.js";

/**
 * A driver telling someone where they are.
 *
 * The automatic messages cover what the engine knows: collected, out for delivery, delivered.
 * These are the ones only the driver knows — that they are ten minutes out, that they are
 * standing at the gate — and they are sent because the driver chose to send them, not because
 * a status changed.
 */
export const NotifyTarget = z.enum(["collection", "recipient"]);
export type NotifyTarget = z.infer<typeof NotifyTarget>;

/**
 * How far out the driver is.
 *
 * `arrived` rather than `0`, because "I am here" and "I am no minutes away" are different
 * sentences and the second one is not one a person would write.
 */
export const EtaChoice = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(30),
  z.literal("arrived"),
]);
export type EtaChoice = z.infer<typeof EtaChoice>;

export const DriverNotifyRequest = z.object({
  shipmentId: Uuid,
  target: NotifyTarget,
  /** A phone call is placed by the phone, so only the two the engine can carry are offered. */
  channel: z.enum(["sms", "email"]),
  eta: EtaChoice,
});
export type DriverNotifyRequest = z.infer<typeof DriverNotifyRequest>;

/** Who is actually going to deliver this message. */
export const NotifyDelivery = z.enum([
  /** The engine has it and the worker will send it. */
  "engine",
  /** No provider is configured, so the driver sends it from their own phone. */
  "driver",
  /** It will not be sent at all, and `reason` says why. */
  "suppressed",
]);
export type NotifyDelivery = z.infer<typeof NotifyDelivery>;

export const DriverNotifyResult = z.object({
  delivery: NotifyDelivery,
  channel: NotificationChannel,
  /** The number or address, so the phone can hand it to its own messaging app. */
  to: z.string().nullable(),
  /** The rendered message. The app pre-fills this when the driver is the one sending. */
  text: z.string(),
  reason: z.string().nullable(),
});
export type DriverNotifyResult = z.infer<typeof DriverNotifyResult>;

/**
 * How the message says where the driver is.
 *
 * A placeholder rather than one template per gap, so the wording is edited in one place and
 * cannot drift between "5 minutes away" and "approximately 30 minutes away".
 */
export function etaPhrase(eta: EtaChoice): string {
  return eta === "arrived" ? "has arrived" : `is about ${eta} minutes away`;
}
