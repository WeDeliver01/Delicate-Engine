import {
  bigint,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./_shared.js";

/**
 * What we have already asked a mapping provider, so we do not ask twice.
 *
 * Geoapify's free plan allows 3,000 lookups a day, and every quote needs a geocode per address
 * and a distance per leg. Most of those are questions we have answered before: the same depot,
 * the same regular customers, the same bakery on the same corner. Keeping the answers turns a
 * daily quota into a non-issue and makes pricing work when the provider is down.
 *
 * These live in Postgres rather than a cache server because they are worth keeping. A cache you
 * lose on restart gives the quota back every deploy, and the whole point is that the business
 * accumulates its own map of the places it delivers to.
 */

/**
 * An address we have resolved to coordinates.
 *
 * Keyed on a fingerprint of the normalised text, so "10 Camellia Avenue", "10 Camellia Ave" and
 * "10 camellia avenue, Lynnwood" are one row rather than three lookups.
 */
export const geocodedAddresses = pgTable(
  "geocoded_addresses",
  {
    id: id(),
    /** SHA-256 of the normalised query. Hashed so the index stays small and fixed-width. */
    fingerprint: text("fingerprint").notNull(),
    /** What the fingerprint was taken of, kept for debugging a surprising match. */
    normalized: text("normalized").notNull(),
    formatted: text("formatted").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    suburb: text("suburb"),
    city: text("city"),
    postalCode: text("postal_code"),
    provider: text("provider").notNull(),
    providerPlaceId: text("provider_place_id"),
    /** How often this row has saved a call, which is how the cache proves its worth. */
    hitCount: integer("hit_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("geocoded_addresses_fingerprint_uq").on(t.fingerprint),
    index("geocoded_addresses_used_idx").on(t.lastUsedAt),
  ],
);

/**
 * The road distance between two points.
 *
 * Keyed on coordinates rounded to about ten metres, because two addresses that close share a
 * road distance to within rounding and pretending otherwise would mean never getting a hit.
 *
 * Distance is cached hard and duration is not cached at all. A road layout changes rarely, so a
 * stored distance stays true for months; travel time changes with the hour and would be a lie
 * by lunchtime. Pricing uses distance, which is exactly the stable half.
 */
export const routeLegs = pgTable(
  "route_legs",
  {
    id: id(),
    /** SHA-256 of the rounded "fromLat,fromLng>toLat,toLng" pair plus the travel mode. */
    fingerprint: text("fingerprint").notNull(),
    fromLat: doublePrecision("from_lat").notNull(),
    fromLng: doublePrecision("from_lng").notNull(),
    toLat: doublePrecision("to_lat").notNull(),
    toLng: doublePrecision("to_lng").notNull(),
    /** Metres, so the stored value is an integer and rounding happens once, on the way in. */
    metres: bigint("metres", { mode: "number" }).notNull(),
    provider: text("provider").notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    measuredAt: timestamp("measured_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("route_legs_fingerprint_uq").on(t.fingerprint),
    index("route_legs_measured_idx").on(t.measuredAt),
  ],
);

/**
 * One row per provider per day, counting what we have spent of their allowance.
 *
 * In the database rather than in memory because the API and the worker both price things, and
 * two processes each counting to 2,400 is a way to spend 4,800. It is also the only count that
 * survives a restart, and a deploy at lunchtime should not hand the budget back.
 */
export const geoUsageDaily = pgTable(
  "geo_usage_daily",
  {
    /** YYYY-MM-DD in the operating timezone, so a day rolls over at midnight in Johannesburg. */
    day: text("day").notNull(),
    provider: text("provider").notNull(),
    /** Calls actually made to the provider; cache hits are not spending. */
    calls: integer("calls").notNull().default(0),
    /** Calls we declined to make because the budget was spent. */
    skipped: integer("skipped").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("geo_usage_daily_uq").on(t.day, t.provider)],
);
