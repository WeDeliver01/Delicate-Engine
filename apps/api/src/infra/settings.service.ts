import { Injectable, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  Address,
  Bps,
  CompanyTaxProfile,
  LoyaltyProgram,
  SettlementRules,
  SlotPolicy,
  TreasuryPolicy,
  AdminCopySettings,
  type SettingKey,
} from "@delicate/contracts";
import { CATALOG_SEED, settings, type DbExecutor } from "@delicate/db";
import { DbService } from "./db.module.js";
import { AuditService } from "./audit.service.js";
import { AppError } from "../common/errors.js";

/** Every setting key has a schema; reads are validated, writes are audited. */
const SCHEMAS = {
  "company.depot_address": Address,
  "company.vat_registered": z.boolean(),
  "company.vat_bps": Bps,
  "company.timezone": z.string().min(1),
  "booking.same_day_cutoff_minutes": z.number().int().min(0).max(1439),
  "scheduling.policy": SlotPolicy,
  "settlement.rules": SettlementRules,
  "treasury.policy": TreasuryPolicy,
  "company.tax_profile": CompanyTaxProfile,
  // Printed at the foot of every waybill. The operator's words, not ours.
  "company.waybill_terms": z.string().max(4000),
  "notifications.admin_copy": AdminCopySettings,
  "loyalty.program": LoyaltyProgram,
} satisfies Record<SettingKey, z.ZodTypeAny>;

type Schemas = typeof SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<Schemas[K]>;

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache = new Map<string, { value: unknown; at: number }>();
  private readonly ttlMs = 10_000;

  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Put any missing setting at its shipped default.
   *
   * `get` throws when a key has no row, and most callers do not catch it -- so a key added to
   * the code after a database was seeded takes out every endpoint that reads it. That is not
   * hypothetical: `notifications.admin_copy` was added to the seed long after dev was seeded,
   * so the admin settings endpoint 500'd and the panel for setting it could not render. The
   * one screen that fixes the problem was behind the problem.
   *
   * Seeding on boot instead of only on `db:seed` makes that class of fault go away. Existing
   * values are never touched: this fills gaps, it does not reset anybody's configuration.
   */
  async onModuleInit(): Promise<void> {
    for (const [key, value] of Object.entries(CATALOG_SEED.settings)) {
      await this.dbs.db.insert(settings).values({ key, value }).onConflictDoNothing();
    }
  }

  async get<K extends SettingKey>(key: K, tx?: DbExecutor): Promise<SettingValue<K>> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value as SettingValue<K>;
    const row = await (tx ?? this.dbs.db).query.settings.findFirst({
      where: eq(settings.key, key),
    });
    if (!row) throw new AppError("setting_missing", `setting '${key}' is not configured`, 500);
    const value = SCHEMAS[key].parse(row.value) as SettingValue<K>;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    const parsed = SCHEMAS[key].parse(value);
    await this.dbs.transaction(async (tx) => {
      const before = await tx.query.settings.findFirst({ where: eq(settings.key, key) });
      await tx
        .insert(settings)
        .values({ key, value: parsed })
        .onConflictDoUpdate({ target: settings.key, set: { value: parsed } });
      await this.audit.record(tx, {
        action: "settings.update",
        entityType: "setting",
        entityId: key,
        before: before?.value ?? null,
        after: parsed,
      });
    });
    this.cache.delete(key);
  }

  /**
   * Drop the read cache. Used after a bulk change to the settings table (and by the test
   * harness, whose reset truncates and re-seeds settings underneath the cache).
   */
  invalidate(): void {
    this.cache.clear();
  }

  /** VAT in basis points to apply to quotes: 0 when the company is not registered. */
  async vatBps(): Promise<number> {
    const registered = await this.get("company.vat_registered");
    return registered ? await this.get("company.vat_bps") : 0;
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.dbs.db.select().from(settings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
