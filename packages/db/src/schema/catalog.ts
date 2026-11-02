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

/**
 * A named set of accounts priced by their own rules -- a franchise group, a reseller, the
 * three bakeries that negotiated together.
 *
 * The rules themselves are an ordinary rate card (`rate_cards.groupId`), because a group's
 * deal is never "the default minus 10%" for long: it is its own cost per kilometre, its own
 * minimum, its own surcharges turned on or off. One card per group is live at a time and the
 * rest are drafts, so rates can be prepared and then published rather than edited underneath
 * the customers they price.
 *
 * Switching the group off leaves its card and its membership intact and sends every member
 * back to the default card. That is the lever you want at 16:00 on a Friday when a deal has
 * gone wrong, and it is reversible.
 */
export const rateGroups = pgTable(
  "rate_groups",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("rate_groups_name_uq").on(t.name)],
);

/**
 * Who is in a group. An account belongs to at most one -- the account id is the primary key --
 * so "which rules price this booking" has exactly one answer and nobody has to reason about
 * precedence between two groups that both claim the same customer.
 */
export const rateGroupMembers = pgTable(
  "rate_group_members",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => rateGroups.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [index("rate_group_members_group_idx").on(t.groupId)],
);

/**
 * Who a card was written for. `platform` cards are the house rates (one of them is the
 * default); `group` and `account` cards are negotiated and only ever reached through the
 * group they belong to or the account assignment that points at them.
 */
export const rateCardScopeEnum = pgEnum("rate_card_scope", ["platform", "group", "account"]);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: id(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    /**
     * Live, in the sense the operator means it: an inactive card prices nothing. A group's
     * draft rates sit here as inactive cards until somebody publishes one.
     */
    active: boolean("active").notNull().default(true),
    scope: rateCardScopeEnum("scope").notNull().default("platform"),
    /** Set on a `group` card: the group whose rules these are. */
    groupId: uuid("group_id").references(() => rateGroups.id, { onDelete: "cascade" }),
    /** Set on an `account` card: who it was negotiated with. The assignment still rules. */
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    costPerKmCents: integer("cost_per_km_cents").notNull(),
    marginBps: integer("margin_bps").notNull(),
    fuelSurchargeBps: integer("fuel_surcharge_bps").notNull().default(0),
    minFeeCents: integer("min_fee_cents").notNull().default(0),
    extraDropFeeCents: integer("extra_drop_fee_cents").notNull().default(0),
    /** What share of its own kilometres a drop after the first is charged. 6000 = 60%. */
    extraDropKmFactorBps: integer("extra_drop_km_factor_bps").notNull().default(6_000),
    liabilityCoverBps: integer("liability_cover_bps").notNull().default(0),
    liabilityCoverMinCents: integer("liability_cover_min_cents").notNull().default(0),
    /** A share of the declared value, charged on every order that carries one. 200 = 2%. */
    orderValueFeeBps: integer("order_value_fee_bps").notNull().default(200),
    earlyCollectionFeeCents: integer("early_collection_fee_cents").notNull().default(0),
    signatureFeeCents: integer("signature_fee_cents").notNull().default(0),
    weddingVenueFeeCents: integer("wedding_venue_fee_cents").notNull().default(0),
    roadFactorBps: integer("road_factor_bps").notNull().default(13_000),
    /**
     * Price below the cost floor. False everywhere except an internal testing card -- see
     * the field on the RateCard contract for why the hole exists and what it costs.
     */
    exemptFromCostFloor: boolean("exempt_from_cost_floor").notNull().default(false),
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
    // one live card per group: publishing the next one retires the one it replaces
    uniqueIndex("rate_cards_group_live_uq")
      .on(t.groupId)
      .where(sql`${t.groupId} is not null and ${t.active} = true`),
    index("rate_cards_group_idx").on(t.groupId),
    index("rate_cards_account_idx").on(t.accountId),
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
