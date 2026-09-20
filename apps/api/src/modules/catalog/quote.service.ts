import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  priceQuote,
  type EstimateRequest,
  type EstimateResponse,
  type LatLng,
  type PackageType,
  type Quote,
  type QuoteRequest,
} from "@delicate/contracts";
import { quotes, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";
import { GEO_PROVIDER, type GeoProvider } from "../../infra/geo/geo.provider.js";
import { AppError } from "../../common/errors.js";
import { CatalogService } from "./catalog.service.js";

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
    return { breakdown, serviceLevelCode: serviceLevel.code, distanceProvider: this.geo.name };
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
    });

    const [row] = await this.dbs.db
      .insert(quotes)
      .values({
        accountId,
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
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
      })
      .returning();
    return toQuote(row!);
  }

  async get(id: string, accountId: string, tx?: DbExecutor): Promise<Quote> {
    const row = await (tx ?? this.dbs.db).query.quotes.findFirst({ where: eq(quotes.id, id) });
    if (!row || row.accountId !== accountId) throw AppError.notFound("quote");
    return toQuote(row);
  }

  /** Called inside the booking transaction: marks the quote consumed (once). */
  async markBooked(tx: DbExecutor, id: string): Promise<void> {
    const [row] = await tx
      .update(quotes)
      .set({ status: "booked" })
      .where(eq(quotes.id, id))
      .returning({ id: quotes.id, status: quotes.status });
    if (!row) throw AppError.notFound("quote");
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
    serviceLevelCode: r.serviceLevelCode,
    rateCardId: r.rateCardId,
    status: r.status,
    request: r.request as Quote["request"],
    breakdown: r.breakdown as Quote["breakdown"],
    distanceProvider: r.distanceProvider,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}
