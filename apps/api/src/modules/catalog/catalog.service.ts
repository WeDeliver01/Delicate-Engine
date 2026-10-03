import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import type {
  CatalogResponse,
  PackageType,
  RateCard,
  ServiceLevel,
  UpsertPackageTypeRequest,
  UpsertRateCardRequest,
  UpsertServiceLevelRequest,
} from "@delicate/contracts";
import {
  accountRateCards,
  packageTypes,
  rateCards,
  serviceLevels,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { AppError } from "../../common/errors.js";

/** Catalog reads for pricing/booking plus audited admin writes. */
@Injectable()
export class CatalogService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async publicCatalog(): Promise<CatalogResponse> {
    const [sl, pt, vatBps] = await Promise.all([
      this.dbs.db.query.serviceLevels.findMany({
        where: eq(serviceLevels.active, true),
        orderBy: asc(serviceLevels.sortOrder),
      }),
      this.dbs.db.query.packageTypes.findMany({
        where: eq(packageTypes.active, true),
        orderBy: asc(packageTypes.sortOrder),
      }),
      this.settings.vatBps(),
    ]);
    return {
      serviceLevels: sl.map(toServiceLevel),
      packageTypes: pt.map(toPackageType),
      vatBps,
      currency: "ZAR",
    };
  }

  async serviceLevelByCode(code: string, tx?: DbExecutor): Promise<ServiceLevel> {
    const row = await (tx ?? this.dbs.db).query.serviceLevels.findFirst({
      where: and(eq(serviceLevels.code, code), eq(serviceLevels.active, true)),
    });
    if (!row) throw AppError.notFound("service level", { code });
    return toServiceLevel(row);
  }

  async packageTypesByIds(ids: string[], tx?: DbExecutor): Promise<Map<string, PackageType>> {
    const rows = await (tx ?? this.dbs.db).query.packageTypes.findMany({
      where: eq(packageTypes.active, true),
    });
    const map = new Map(rows.map((r) => [r.id, toPackageType(r)]));
    for (const id of ids) if (!map.has(id)) throw AppError.notFound("package type", { id });
    return map;
  }

  async packageTypesByCodes(codes: string[], tx?: DbExecutor): Promise<PackageType[]> {
    if (codes.length === 0) return [];
    const rows = await (tx ?? this.dbs.db).query.packageTypes.findMany({
      where: eq(packageTypes.active, true),
    });
    const byCode = new Map(rows.map((r) => [r.code, toPackageType(r)]));
    return codes.map((c) => {
      const pt = byCode.get(c);
      if (!pt) throw AppError.notFound("package type", { code: c });
      return pt;
    });
  }

  /** The rate card that applies to an account (negotiated) or the default (public / no override). */
  async rateCardFor(accountId: string | null, tx?: DbExecutor): Promise<RateCard> {
    const db = tx ?? this.dbs.db;
    if (accountId) {
      const link = await db.query.accountRateCards.findFirst({
        where: eq(accountRateCards.accountId, accountId),
      });
      if (link) {
        const card = await db.query.rateCards.findFirst({
          where: and(eq(rateCards.id, link.rateCardId), eq(rateCards.active, true)),
        });
        if (card) return toRateCard(card);
      }
    }
    const def = await db.query.rateCards.findFirst({
      where: and(eq(rateCards.isDefault, true), eq(rateCards.active, true)),
    });
    if (!def)
      throw new AppError("no_default_rate_card", "no active default rate card is configured", 500);
    return toRateCard(def);
  }

  // ── admin ──────────────────────────────────────────────────────────────────

  async listRateCards(): Promise<RateCard[]> {
    const rows = await this.dbs.db.query.rateCards.findMany({ orderBy: [asc(rateCards.name)] });
    return rows.map(toRateCard);
  }

  async upsertRateCard(id: string | null, input: UpsertRateCardRequest): Promise<RateCard> {
    return this.dbs.transaction(async (tx) => {
      const before = id
        ? await tx.query.rateCards.findFirst({ where: eq(rateCards.id, id) })
        : null;
      if (id && !before) throw AppError.notFound("rate card");
      if (input.isDefault) {
        // exactly one default: demote the current one first
        await tx.update(rateCards).set({ isDefault: false }).where(eq(rateCards.isDefault, true));
      }
      const values = { ...input };
      const [row] = id
        ? await tx.update(rateCards).set(values).where(eq(rateCards.id, id)).returning()
        : await tx
            .insert(rateCards)
            .values({ ...values, isDefault: input.isDefault ?? false })
            .returning();
      await this.audit.record(tx, {
        action: id ? "rate_card.update" : "rate_card.create",
        entityType: "rate_card",
        entityId: row!.id,
        before,
        after: row,
      });
      return toRateCard(row!);
    });
  }

  async assignRateCard(accountId: string, rateCardId: string | null): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const before = await tx.query.accountRateCards.findFirst({
        where: eq(accountRateCards.accountId, accountId),
      });
      if (rateCardId) {
        const card = await tx.query.rateCards.findFirst({ where: eq(rateCards.id, rateCardId) });
        if (!card) throw AppError.notFound("rate card");
        await tx
          .insert(accountRateCards)
          .values({ accountId, rateCardId })
          .onConflictDoUpdate({ target: accountRateCards.accountId, set: { rateCardId } });
      } else {
        await tx.delete(accountRateCards).where(eq(accountRateCards.accountId, accountId));
      }
      await this.audit.record(tx, {
        action: "account.rate_card.assign",
        entityType: "account",
        entityId: accountId,
        before,
        after: { rateCardId },
      });
    });
  }

  async listServiceLevels(): Promise<ServiceLevel[]> {
    const rows = await this.dbs.db.query.serviceLevels.findMany({
      orderBy: asc(serviceLevels.sortOrder),
    });
    return rows.map(toServiceLevel);
  }

  async upsertServiceLevel(
    id: string | null,
    input: UpsertServiceLevelRequest,
  ): Promise<ServiceLevel> {
    return this.dbs.transaction(async (tx) => {
      const before = id
        ? await tx.query.serviceLevels.findFirst({ where: eq(serviceLevels.id, id) })
        : null;
      if (id && !before) throw AppError.notFound("service level");
      const [row] = id
        ? await tx.update(serviceLevels).set(input).where(eq(serviceLevels.id, id)).returning()
        : await tx.insert(serviceLevels).values(input).returning();
      await this.audit.record(tx, {
        action: id ? "service_level.update" : "service_level.create",
        entityType: "service_level",
        entityId: row!.id,
        before,
        after: row,
      });
      return toServiceLevel(row!);
    });
  }

  async listPackageTypes(): Promise<PackageType[]> {
    const rows = await this.dbs.db.query.packageTypes.findMany({
      orderBy: asc(packageTypes.sortOrder),
    });
    return rows.map(toPackageType);
  }

  async upsertPackageType(
    id: string | null,
    input: UpsertPackageTypeRequest,
  ): Promise<PackageType> {
    return this.dbs.transaction(async (tx) => {
      const before = id
        ? await tx.query.packageTypes.findFirst({ where: eq(packageTypes.id, id) })
        : null;
      if (id && !before) throw AppError.notFound("package type");
      const values = {
        ...input,
        maxWeightKg: input.maxWeightKg == null ? null : String(input.maxWeightKg),
      };
      const [row] = id
        ? await tx.update(packageTypes).set(values).where(eq(packageTypes.id, id)).returning()
        : await tx.insert(packageTypes).values(values).returning();
      await this.audit.record(tx, {
        action: id ? "package_type.update" : "package_type.create",
        entityType: "package_type",
        entityId: row!.id,
        before,
        after: row,
      });
      return toPackageType(row!);
    });
  }
}

export function toServiceLevel(r: typeof serviceLevels.$inferSelect): ServiceLevel {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    multiplierBps: r.multiplierBps,
    surchargeCents: r.surchargeCents,
    requiresSlot: r.requiresSlot,
    sameDayCutoffMinutes: r.sameDayCutoffMinutes,
    sortOrder: r.sortOrder,
    active: r.active,
  };
}

export function toPackageType(r: typeof packageTypes.$inferSelect): PackageType {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    category: r.category,
    maxWeightKg: r.maxWeightKg == null ? null : Number(r.maxWeightKg),
    surchargeCents: r.surchargeCents,
    sortOrder: r.sortOrder,
    active: r.active,
  };
}

export function toRateCard(r: typeof rateCards.$inferSelect): RateCard {
  return {
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    active: r.active,
    costPerKmCents: r.costPerKmCents,
    marginBps: r.marginBps,
    fuelSurchargeBps: r.fuelSurchargeBps,
    minFeeCents: r.minFeeCents,
    extraDropFeeCents: r.extraDropFeeCents,
    liabilityCoverBps: r.liabilityCoverBps,
    liabilityCoverMinCents: r.liabilityCoverMinCents,
    earlyCollectionFeeCents: r.earlyCollectionFeeCents,
    signatureFeeCents: r.signatureFeeCents,
    weddingVenueFeeCents: r.weddingVenueFeeCents,
    weekendSurchargeBps: r.weekendSurchargeBps,
    weekendSurchargeCents: r.weekendSurchargeCents,
    publicHolidaySurchargeBps: r.publicHolidaySurchargeBps,
    publicHolidaySurchargeCents: r.publicHolidaySurchargeCents,
    timedWindowSurchargeBps: r.timedWindowSurchargeBps,
    timedWindowSurchargeCents: r.timedWindowSurchargeCents,
    roadFactorBps: r.roadFactorBps,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
