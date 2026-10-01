import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  dateFlagsFor,
  priceQuote,
  toCustomerBreakdown,
  type EstimateRequest,
  type EstimateResponse,
  type LatLng,
  type PackageType,
  type Quote,
  type QuoteRequest,
} from "@delicate/contracts";
import { quotes, waybillCounters, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";
import { GEO_PROVIDER, type GeoProvider } from "../../infra/geo/geo.provider.js";
import { AppError } from "../../common/errors.js";
import { CatalogService } from "./catalog.service.js";
import { Clock } from "../../infra/clock.js";

const QUOTE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Turns a request into a priced, persisted quote. The persisted row carries a snapshot of the
 * catalog it was priced against so the number can be reproduced later even after admins change
 * the rate card (invariant: a charged price is always explainable).
 */
@Injectable()
export class QuoteService {
  constructor(
    private readonly dbs: DbService,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
    @Inject(GEO_PROVIDER) private readonly geo: GeoProvider,
    private readonly clock: Clock,
  ) {}

  /** Public, unsaved estimate for the marketing site. Uses the default rate card. */
  async estimate(input: EstimateRequest): Promise<EstimateResponse> {
    const [rateCard, serviceLevel, vatBps, depot, packageTypes] = await Promise.all([
      this.catalog.rateCardFor(null),
      this.catalog.serviceLevelByCode(input.serviceLevelCode),
      this.settings.vatBps(),
      this.settings.get("company.depot_address"),
      this.catalog.packageTypesByCodes(input.packageTypeCodes),
    ]);
    const legsKm = await this.geo.routeLegsKm(
      loop(
        depot.location,
        input.collection.location,
        input.drops.map((d) => d.location),
      ),
    );
    const breakdown = priceQuote({
      legsKm,
      dropCount: input.drops.length,
      rateCard,
      serviceLevel,
      parcels: packageTypes.map((packageType) => ({ packageType, quantity: 1 })),
      options: input.options,
      vatBps,
    });
    // The public estimator is the most exposed surface there is -- no sign-in at all -- so
    // it gets the same projection as everything else.
    // The provider is recorded against saved quotes for audit, but not returned: naming it
    // says which vendor we use, and "haversine" says our routing is degraded and today's
    // prices are approximations. Neither is the customer's business.
    return { breakdown: toCustomerBreakdown(breakdown), serviceLevelCode: serviceLevel.code };
  }

  /** Full quote for an account: persisted, bookable for 24h. */
  async create(accountId: string, input: QuoteRequest): Promise<Quote> {
    const [rateCard, serviceLevel, vatBps, depot] = await Promise.all([
      this.catalog.rateCardFor(accountId),
      this.catalog.serviceLevelByCode(input.serviceLevelCode),
      this.settings.vatBps(),
      this.settings.get("company.depot_address"),
    ]);
    const packageTypeIds = input.drops.flatMap((d) => d.parcels.map((p) => p.packageTypeId));
    const packageTypeMap = await this.catalog.packageTypesByIds([...new Set(packageTypeIds)]);

    const parcels = new Map<string, { packageType: PackageType; quantity: number }>();
    for (const d of input.drops) {
      for (const p of d.parcels) {
        const pt = packageTypeMap.get(p.packageTypeId)!;
        if (p.weightKg != null && pt.maxWeightKg != null && p.weightKg > pt.maxWeightKg) {
          throw AppError.validation([
            {
              path: ["drops", "parcels", "weightKg"],
              message: `${pt.name} is limited to ${pt.maxWeightKg} kg`,
            },
          ]);
        }
        const cur = parcels.get(pt.id) ?? { packageType: pt, quantity: 0 };
        cur.quantity += p.quantity;
        parcels.set(pt.id, cur);
      }
    }

    const legsKm = await this.geo.routeLegsKm(
      loop(
        depot.location,
        input.collection.address.location,
        input.drops.map((d) => d.address.location),
      ),
    );
    const breakdown = priceQuote({
      legsKm,
      dropCount: input.drops.length,
      rateCard,
      serviceLevel,
      parcels: [...parcels.values()],
      options: input.options,
      vatBps,
      // Only set when the caller said which day the job is for. Every rate card carries zero
      // for both surcharges, so this changes no price until the business decides it should.
      ...(input.deliveryDate ? { dateFlags: dateFlagsFor(input.deliveryDate) } : {}),
    });

    const reference = await this.nextReference();
    const [row] = await this.dbs.db
      .insert(quotes)
      .values({
        accountId,
        reference,
        label: input.label ?? null,
        serviceLevelCode: serviceLevel.code,
        rateCardId: rateCard.id,
        request: { ...input, accountId },
        snapshot: {
          rateCard,
          serviceLevel,
          packageTypes: [...packageTypeMap.values()],
          vatBps,
          depot,
        },
        breakdown,
        distanceProvider: this.geo.name,
        expiresAt: new Date(this.clock.now().getTime() + QUOTE_TTL_MS),
      })
      .returning();
    return toQuote(row!);
  }

  async get(id: string, accountId: string, tx?: DbExecutor): Promise<Quote> {
    const row = await (tx ?? this.dbs.db).query.quotes.findFirst({ where: eq(quotes.id, id) });
    if (!row || row.accountId !== accountId) throw AppError.notFound("quote");
    return toQuote(row);
  }

  /**
   * The customer's saved quotes.
   *
   * Expiry is computed on read rather than swept by a job: a quote is expired the moment its
   * time passes, and a background task that has not run yet would show a stale "valid" badge
   * on something the booking endpoint is about to refuse.
   */
  async list(accountId: string, limit = 50): Promise<{ items: Quote[] }> {
    const rows = await this.dbs.db
      .select()
      .from(quotes)
      .where(eq(quotes.accountId, accountId))
      .orderBy(desc(quotes.createdAt))
      .limit(limit);
    const now = this.clock.now();
    return {
      items: rows.map((r) =>
        toQuote(r.status === "priced" && r.expiresAt < now ? { ...r, status: "expired" } : r),
      ),
    };
  }

  /** Name a quote so it can be found again. */
  async rename(id: string, accountId: string, label: string | null): Promise<Quote> {
    const [row] = await this.dbs.db
      .update(quotes)
      .set({ label })
      .where(and(eq(quotes.id, id), eq(quotes.accountId, accountId)))
      .returning();
    if (!row) throw AppError.notFound("quote");
    return toQuote(row);
  }

  /**
   * Price the same request again, as a new quote.
   *
   * An expired quote is never revived in place: it was priced on a rate card and a distance
   * that may both have moved, and quietly extending it would mean charging today's delivery at
   * a price we no longer offer. The old row stays exactly as it was.
   */
  async reprice(id: string, accountId: string): Promise<Quote> {
    const row = await this.dbs.db.query.quotes.findFirst({ where: eq(quotes.id, id) });
    if (!row || row.accountId !== accountId) throw AppError.notFound("quote");
    const request = row.request as QuoteRequest;
    return this.create(accountId, { ...request, label: row.label ?? undefined });
  }

  /** QT-YYMMDD-NNNN, from the same gap-free counter the waybills use. */
  private async nextReference(): Promise<string> {
    const tz = await this.settings.get("company.timezone");
    const day = new Date(this.clock.now().toLocaleString("en-US", { timeZone: tz }))
      .toISOString()
      .slice(2, 10)
      .replace(/-/g, "");
    const key = `QT:${day}`;
    await this.dbs.db.insert(waybillCounters).values({ day: key }).onConflictDoNothing();
    const [counter] = await this.dbs.db
      .update(waybillCounters)
      .set({ next: sql`${waybillCounters.next} + 1` })
      .where(eq(waybillCounters.day, key))
      .returning({ next: waybillCounters.next });
    return `QT-${day}-${String(counter!.next - 1).padStart(4, "0")}`;
  }

  /**
   * Called inside the booking transaction: marks the quote consumed, once.
   *
   * The predicate is the lock. Two bookings racing the same quote both read it as `priced`
   * before either commits, so checking the status beforehand decides nothing; the update that
   * matches no row is the one that loses, and it loses with `quote_used` rather than with a
   * unique-constraint violation nobody can interpret.
   */
  async markBooked(tx: DbExecutor, id: string): Promise<void> {
    const [row] = await tx
      .update(quotes)
      .set({ status: "booked" })
      .where(and(eq(quotes.id, id), eq(quotes.status, "priced")))
      .returning({ id: quotes.id });
    if (row) return;
    const existing = await tx.query.quotes.findFirst({ where: eq(quotes.id, id) });
    if (!existing) throw AppError.notFound("quote");
    throw AppError.conflict("quote_used", "this quote has already been booked");
  }
}

/** depot → collection → drops… → depot */
function loop(depot: LatLng, collection: LatLng, drops: LatLng[]): LatLng[] {
  return [depot, collection, ...drops, depot];
}

export function toQuote(r: typeof quotes.$inferSelect): Quote {
  return {
    id: r.id,
    accountId: r.accountId,
    reference: r.reference,
    label: r.label,
    serviceLevelCode: r.serviceLevelCode,
    rateCardId: r.rateCardId,
    status: r.status,
    request: r.request as Quote["request"],
    // Projected here, at the only place a quote becomes a response: the row keeps the
    // full workings, the customer gets the prices.
    breakdown: toCustomerBreakdown(r.breakdown as Parameters<typeof toCustomerBreakdown>[0]),
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}
