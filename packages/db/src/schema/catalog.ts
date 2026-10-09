import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * Platform settings as typed JSON rows. Read through SettingsService, which validates each key
 * against its Zod schema; never read raw.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps(),
});

/** Catalog: what can be booked and how it is priced. All admin-editable. */

export const serviceLevels = pgTable(
  "service_levels",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    multiplierBps: integer("multiplier_bps").notNull().default(10_000),
    surchargeCents: integer("surcharge_cents").notNull().default(0),
    requiresSlot: boolean("requires_slot").notNull().default(true),
    sameDayCutoffMinutes: integer("same_day_cutoff_minutes"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("service_levels_code_uq").on(t.code)],
);

/**
 * What sort of thing is in the box: a cheesecake, a tier cake, macarons.
 *
 * A managed list rather than free text on each package type, because the operator adds to it
 * as the business does and because thirty box sizes in one flat dropdown is a list nobody
 * reads. The package type still carries the name, so renaming one is a rename in both places
 * -- done in a single transaction by the catalog service.
 */
export const packageCategories = pgTable(
  "package_categories",
  {
    id: id(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("package_categories_name_uq").on(t.name)],
);

export const packageTypes = pgTable(
  "package_types",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull().default("other"),
    maxWeightKg: numeric("max_weight_kg", { precision: 8, scale: 2 }),
    /**
     * The box, in whole centimetres.
     *
     * Not used for pricing yet -- the rate card is distance and weight -- but it is what a
     * dispatcher needs to know whether three of these and a wedding cake fit in one car, and
     * it is on the packaging list the business already keeps, so it belongs with the rest of
     * the package type rather than in somebody's spreadsheet.
     */
    lengthCm: integer("length_cm"),
    widthCm: integer("width_cm"),
    heightCm: integer("height_cm"),
    surchargeCents: integer("surcharge_cents").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("package_types_code_uq").on(t.code)],
);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: id(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    costPerKmCents: integer("cost_per_km_cents").notNull(),
    marginBps: integer("margin_bps").notNull(),
    fuelSurchargeBps: integer("fuel_surcharge_bps").notNull().default(0),
    minFeeCents: integer("min_fee_cents").notNull().default(0),
    extraDropFeeCents: integer("extra_drop_fee_cents").notNull().default(0),
    /** What share of its own kilometres a drop after the first is charged. 6000 = 60%. */
    extraDropKmFactorBps: integer("extra_drop_km_factor_bps").notNull().default(6_000),
    liabilityCoverBps: integer("liability_cover_bps").notNull().default(0),
    liabilityCoverMinCents: integer("liability_cover_min_cents").notNull().default(0),
    earlyCollectionFeeCents: integer("early_collection_fee_cents").notNull().default(0),
    signatureFeeCents: integer("signature_fee_cents").notNull().default(0),
    weddingVenueFeeCents: integer("wedding_venue_fee_cents").notNull().default(0),
    roadFactorBps: integer("road_factor_bps").notNull().default(13_000),
    // Date-conditional surcharges. Zero means off, which is how every card ships.
    weekendSurchargeBps: integer("weekend_surcharge_bps").notNull().default(0),
    weekendSurchargeCents: integer("weekend_surcharge_cents").notNull().default(0),
    publicHolidaySurchargeBps: integer("public_holiday_surcharge_bps").notNull().default(0),
    publicHolidaySurchargeCents: integer("public_holiday_surcharge_cents").notNull().default(0),
    /** What a narrow window costs on top of the slot. Zero until the business prices it. */
    timedWindowSurchargeBps: integer("timed_window_surcharge_bps").notNull().default(0),
    timedWindowSurchargeCents: integer("timed_window_surcharge_cents").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("rate_cards_name_uq").on(t.name),
    // exactly one default card at a time
    uniqueIndex("rate_cards_default_uq")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = true`),
  ],
);

/** Account-specific pricing: an account on a negotiated card. Absent = default card. */
export const accountRateCards = pgTable("account_rate_cards", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  rateCardId: uuid("rate_card_id")
    .notNull()
    .references(() => rateCards.id, { onDelete: "restrict" }),
  ...timestamps(),
});

export const quoteStatusEnum = pgEnum("quote_status", ["priced", "booked", "expired"]);

/**
 * A persisted quote: the exact request, the catalog snapshot it was priced against, and the
 * breakdown. A booking references a quote id, so the charged price is always explainable.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    serviceLevelCode: text("service_level_code").notNull(),
    rateCardId: uuid("rate_card_id")
      .notNull()
      .references(() => rateCards.id, { onDelete: "restrict" }),
    /**
     * Human reference, QT-YYMMDD-NNNN. A quote a customer saves is a document they may email
     * to a colleague or read out on the phone, and a uuid is neither of those things.
     * Nullable because every quote priced before this existed has none.
     */
    reference: text("reference"),
    /** What the customer called it, e.g. "Saturday market run". */
    label: text("label"),
    status: quoteStatusEnum("status").notNull().default("priced"),
    request: jsonb("request").notNull(),
    snapshot: jsonb("snapshot").notNull(), // { rateCard, serviceLevel, packageTypes, vatBps }
    breakdown: jsonb("breakdown").notNull(),
    distanceProvider: text("distance_provider").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index("quotes_account_idx").on(t.accountId, t.createdAt),
    uniqueIndex("quotes_reference_uq").on(t.reference),
  ],
);
