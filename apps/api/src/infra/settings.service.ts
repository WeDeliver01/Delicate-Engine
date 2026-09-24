import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  Address,
  Bps,
  SettlementRules,
  SlotPolicy,
  TreasuryPolicy,
  type SettingKey,
} from "@delicate/contracts";
import { settings, type DbExecutor } from "@delicate/db";
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
} satisfies Record<SettingKey, z.ZodTypeAny>;

type Schemas = typeof SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<Schemas[K]>;

@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();
  private readonly ttlMs = 10_000;

  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

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
