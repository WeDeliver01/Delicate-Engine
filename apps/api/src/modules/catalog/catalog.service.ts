import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import type {
  CatalogResponse,
  PackageCategory,
  PackageType,
  UpsertPackageCategoryRequest,
  RateCard,
  ServiceLevel,
  UpsertPackageTypeRequest,
  UpsertServiceLevelRequest,
} from "@delicate/contracts";
import { packageCategories, packageTypes, serviceLevels, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { RatesService } from "../rates/rates.service.js";
import { AppError } from "../../common/errors.js";

/** Catalog reads for pricing/booking plus audited admin writes. */
@Injectable()
export class CatalogService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly rates: RatesService,
  ) {}

  async publicCatalog(): Promise<CatalogResponse> {
    const [sl, pt, vatBps, bookingLimits, categories] = await Promise.all([
      this.dbs.db.query.serviceLevels.findMany({
        where: eq(serviceLevels.active, true),
        orderBy: asc(serviceLevels.sortOrder),
      }),
      this.dbs.db.query.packageTypes.findMany({
        where: eq(packageTypes.active, true),
        orderBy: asc(packageTypes.sortOrder),
      }),
      this.settings.vatBps(),
      this.settings.get("booking.limits"),
      this.listPackageCategories(true),
    ]);
    return {
      serviceLevels: sl.map(toServiceLevel),
      packageTypes: pt.map(toPackageType),
      vatBps,
      currency: "ZAR",
      bookingLimits,
      packageCategories: categories,
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

  /**
   * Which rate card prices this account's work.
   *
   * Asked here because pricing reads the catalog, answered in the Rates module because the
   * ordering between an account's own card, its rate group's and the house default is one
   * decision and belongs in one place.
   */
  rateCardFor(accountId: string | null, tx?: DbExecutor): Promise<RateCard> {
    return this.rates.rateCardFor(accountId, tx);
  }

  // ── admin ─────────────────────────────────────────────────────────────────

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

  async listPackageCategories(activeOnly = false): Promise<PackageCategory[]> {
    const rows = await this.dbs.db.query.packageCategories.findMany({
      where: activeOnly ? eq(packageCategories.active, true) : undefined,
      orderBy: asc(packageCategories.sortOrder),
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      active: r.active,
    }));
  }

  /**
   * Add a category, rename one, or retire it.
   *
   * A package type carries the category's name rather than pointing at it, so a rename has
   * to move both in one transaction or the types are orphaned under a heading that no longer
   * exists. That is the whole reason this is a service method and not two lines in a
   * controller.
   */
  async upsertPackageCategory(
    id: string | null,
    input: UpsertPackageCategoryRequest,
  ): Promise<PackageCategory> {
    return this.dbs.transaction(async (tx) => {
      const before = id
        ? await tx.query.packageCategories.findFirst({ where: eq(packageCategories.id, id) })
        : null;
      if (id && !before) throw AppError.notFound("package category");

      const [row] = id
        ? await tx
            .update(packageCategories)
            .set(input)
            .where(eq(packageCategories.id, id))
            .returning()
        : await tx.insert(packageCategories).values(input).returning();

      if (before && before.name !== row!.name) {
        await tx
          .update(packageTypes)
          .set({ category: row!.name })
          .where(eq(packageTypes.category, before.name));
      }
      await this.audit.record(tx, {
        action: id ? "package_category.update" : "package_category.create",
        entityType: "package_category",
        entityId: row!.id,
        before,
        after: row,
      });
      return { id: row!.id, name: row!.name, sortOrder: row!.sortOrder, active: row!.active };
    });
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
    lengthCm: r.lengthCm,
    widthCm: r.widthCm,
    heightCm: r.heightCm,
    maxWeightKg: r.maxWeightKg == null ? null : Number(r.maxWeightKg),
    surchargeCents: r.surchargeCents,
    sortOrder: r.sortOrder,
    active: r.active,
  };
}
