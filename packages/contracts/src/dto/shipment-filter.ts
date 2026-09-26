import { z } from "zod";
import { Pagination, Uuid } from "./common.js";
import { IsoDate } from "./slots.js";
import { ShipmentStatus } from "./bookings.js";
import { PERIOD_KEYS } from "../period.js";

/**
 * Filtering a shipment list.
 *
 * The reference system this replaces offers around sixty filters in one wall of selects. Most
 * are never touched, and the handful people use every day are lost among them. So the set here
 * is deliberately smaller: the six on the bar answer almost every question, the rest are found
 * by name when actually needed, and a search that is worth repeating gets saved instead of
 * rebuilt.
 *
 * Anything added here must earn it by answering a question someone actually asks.
 */

/**
 * Which date a period applies to. A shipment has several and they are weeks apart on a
 * postponed job, so "last month" is meaningless until you say last month *of what*.
 */
export const ShipmentDateType = z.enum(["slot", "created", "collected", "delivered"]);
export type ShipmentDateType = z.infer<typeof ShipmentDateType>;

export const SHIPMENT_DATE_TYPE_LABELS: Record<ShipmentDateType, string> = {
  slot: "Scheduled date",
  created: "Booked on",
  collected: "Collected on",
  delivered: "Delivered on",
};

/**
 * The yes/no filters. Each one exists because it answers a question the ops team asks out
 * loud: what still needs a POD, what did the customer change, what is stuck.
 */
export const ShipmentFlag = z.enum([
  "has_pod",
  "missing_pod",
  "rescheduled",
  "address_changed",
  "pending_change",
  "has_declared_value",
  "unassigned",
  "late",
]);
export type ShipmentFlag = z.infer<typeof ShipmentFlag>;

export const SHIPMENT_FLAG_LABELS: Record<ShipmentFlag, string> = {
  has_pod: "Has proof of delivery",
  missing_pod: "Delivered without POD",
  rescheduled: "Has been rescheduled",
  address_changed: "Address was changed",
  pending_change: "Change awaiting approval",
  has_declared_value: "Has declared value",
  unassigned: "No driver assigned",
  late: "Past its window",
};

/**
 * `search` is one box rather than the reference system's eleven. It matches waybill, customer
 * reference, recipient name, phone and delivery address, because a person looking for a
 * shipment has one identifier in hand and should not have to know which field it lives in.
 */
export const ShipmentFilterQuery = Pagination.extend({
  search: z.string().trim().min(1).max(120).optional(),
  status: z
    .union([ShipmentStatus, z.array(ShipmentStatus)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  dateType: ShipmentDateType.default("slot"),
  period: z.enum(PERIOD_KEYS).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  serviceLevelCode: z.string().trim().max(24).optional(),
  driverId: Uuid.optional(),
  accountId: Uuid.optional(),
  flags: z
    .union([ShipmentFlag, z.array(ShipmentFlag)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  sort: z.enum(["newest", "oldest", "slot_asc", "slot_desc"]).default("newest"),
});
export type ShipmentFilterQuery = z.infer<typeof ShipmentFilterQuery>;

/**
 * A filter someone bothered to name. Stored per user rather than per account: "my problem
 * jobs" is a personal working set, and sharing everyone's by default turns the list into
 * another wall to scroll past.
 */
export const SavedFilter = z.object({
  id: Uuid,
  name: z.string(),
  scope: z.enum(["portal", "admin"]),
  query: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type SavedFilter = z.infer<typeof SavedFilter>;

export const CreateSavedFilter = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(["portal", "admin"]),
  query: z.record(z.string(), z.unknown()),
});
export type CreateSavedFilter = z.infer<typeof CreateSavedFilter>;
