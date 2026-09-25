import { z } from "zod";
import { Uuid } from "./common.js";
import { Address } from "./geo.js";
import { Contact } from "./quotes.js";

/**
 * The address book.
 *
 * A florist sending to the same twenty office receptions every week should not retype them, and
 * a bakery moving to same-day should be able to bring its existing customer list in one file
 * rather than one form at a time.
 */

export const SavedAddress = z.object({
  id: Uuid,
  accountId: Uuid,
  /** What the customer calls it: "Menlyn office", "Mrs Dlamini". */
  label: z.string().min(1).max(120),
  address: Address,
  contact: Contact,
  instructions: z.string().max(500).nullable(),
  /** Offer this as the collection point rather than a delivery destination. */
  isCollectionPoint: z.boolean(),
  /** Pre-selected when a new booking starts. At most one per account. */
  isDefault: z.boolean(),
  /** How often it has actually been used, so the picker can lead with the useful ones. */
  useCount: z.number().int(),
  lastUsedAt: z.string().datetime().nullable(),
  archived: z.boolean(),
  createdAt: z.string().datetime(),
});
export type SavedAddress = z.infer<typeof SavedAddress>;

export const UpsertSavedAddressRequest = z.object({
  label: z.string().min(1).max(120),
  address: Address,
  contact: Contact,
  instructions: z.string().max(500).nullable().optional(),
  isCollectionPoint: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});
export type UpsertSavedAddressRequest = z.infer<typeof UpsertSavedAddressRequest>;

/**
 * Bulk import. Always parsed and reported on before anything is written: an import that half
 * worked is worse than one that did not run, so the caller sees every row's verdict first and
 * commits deliberately.
 */
export const ImportAddressesRequest = z.object({
  /** Raw CSV text, with a header row. */
  csv: z.string().min(1).max(2_000_000),
  /** Parse, geocode and report without writing anything. */
  dryRun: z.boolean().default(true),
  /** Overwrite an existing entry with the same label instead of reporting a conflict. */
  updateExisting: z.boolean().default(false),
});
export type ImportAddressesRequest = z.infer<typeof ImportAddressesRequest>;

export const ImportRowOutcome = z.enum(["create", "update", "skip", "error"]);
export type ImportRowOutcome = z.infer<typeof ImportRowOutcome>;

export const ImportRowResult = z.object({
  /** 1-based line number in the file, counting the header as line 1. */
  line: z.number().int(),
  label: z.string(),
  outcome: ImportRowOutcome,
  /** Why it was skipped or rejected, in words the customer can act on. */
  message: z.string().nullable(),
  /** What we resolved the address to, so a wrong geocode is visible before it is saved. */
  resolvedAddress: z.string().nullable(),
  /** True when the address could not be geocoded and was stored without coordinates. */
  needsLocation: z.boolean(),
});
export type ImportRowResult = z.infer<typeof ImportRowResult>;

export const ImportAddressesResult = z.object({
  dryRun: z.boolean(),
  total: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.number().int(),
  rows: z.array(ImportRowResult),
});
export type ImportAddressesResult = z.infer<typeof ImportAddressesResult>;

/** The columns an import file may carry, in the order the template writes them. */
export const IMPORT_COLUMNS = [
  "label",
  "contact_name",
  "contact_phone",
  "contact_email",
  "address",
  "suburb",
  "city",
  "postal_code",
  "instructions",
] as const;
