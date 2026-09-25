import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  Address,
  Contact,
  IMPORT_COLUMNS,
  type ImportAddressesRequest,
  type ImportAddressesResult,
  type ImportRowResult,
  type SavedAddress,
  type UpsertSavedAddressRequest,
} from "@delicate/contracts";
import { savedAddresses, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { Clock } from "../../infra/clock.js";
import { GEO_PROVIDER, type GeoProvider } from "../../infra/geo/geo.provider.js";
import { AppError } from "../../common/errors.js";
import { parseCsv, rowToRecord, toCsv } from "./csv.js";

/** How many rows one import may carry. Enough for a real customer list, small enough to geocode. */
const MAX_IMPORT_ROWS = 2_000;

/**
 * The address book (Phase 4C).
 *
 * The import is deliberately two-pass: it parses, validates and geocodes every row and reports
 * the verdict *before* writing anything. A bulk import that half-succeeded is worse than one
 * that did not run, because the customer cannot tell which half.
 */
@Injectable()
export class AddressBookService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(GEO_PROVIDER) private readonly geo: GeoProvider,
  ) {}

  // ── reads ─────────────────────────────────────────────────────────────────────

  async list(accountId: string, opts: { search?: string; includeArchived?: boolean } = {}) {
    const rows = await this.dbs.db
      .select()
      .from(savedAddresses)
      .where(
        and(
          eq(savedAddresses.accountId, accountId),
          opts.includeArchived ? undefined : eq(savedAddresses.archived, false),
          opts.search
            ? sql`(${savedAddresses.label} ilike ${"%" + opts.search + "%"}
                or ${savedAddresses.address} ->> 'formatted' ilike ${"%" + opts.search + "%"}
                or ${savedAddresses.contact} ->> 'name' ilike ${"%" + opts.search + "%"})`
            : undefined,
        ),
      )
      // Most-used first: a picker is only useful if the common ones are at the top.
      .orderBy(desc(savedAddresses.useCount), savedAddresses.label)
      .limit(500);
    return rows.map(toSavedAddress);
  }

  async get(accountId: string, id: string): Promise<SavedAddress> {
    const row = await this.dbs.db.query.savedAddresses.findFirst({
      where: and(eq(savedAddresses.id, id), eq(savedAddresses.accountId, accountId)),
    });
    if (!row) throw AppError.notFound("saved address");
    return toSavedAddress(row);
  }

  // ── writes ────────────────────────────────────────────────────────────────────

  async upsert(
    accountId: string,
    id: string | null,
    body: UpsertSavedAddressRequest,
  ): Promise<SavedAddress> {
    return this.dbs.transaction(async (tx) => {
      if (body.isDefault) await this.clearDefault(tx, accountId);
      const values = {
        accountId,
        label: body.label.trim(),
        address: body.address,
        contact: body.contact,
        instructions: body.instructions ?? null,
        isCollectionPoint: body.isCollectionPoint ?? false,
        isDefault: body.isDefault ?? false,
      };

      if (id) {
        const existing = await tx.query.savedAddresses.findFirst({
          where: and(eq(savedAddresses.id, id), eq(savedAddresses.accountId, accountId)),
        });
        if (!existing) throw AppError.notFound("saved address");
        const [row] = await tx
          .update(savedAddresses)
          .set(values)
          .where(eq(savedAddresses.id, id))
          .returning();
        return toSavedAddress(row!);
      }

      const [row] = await tx
        .insert(savedAddresses)
        .values(values)
        .onConflictDoNothing()
        .returning();
      if (!row) {
        throw AppError.conflict(
          "label_taken",
          `You already have an address called "${values.label}".`,
        );
      }
      return toSavedAddress(row);
    });
  }

  /** Archive rather than delete: old bookings must still be able to say where they went. */
  async archive(accountId: string, id: string): Promise<SavedAddress> {
    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .update(savedAddresses)
        .set({ archived: true, isDefault: false })
        .where(and(eq(savedAddresses.id, id), eq(savedAddresses.accountId, accountId)))
        .returning();
      if (!row) throw AppError.notFound("saved address");
      await this.audit.record(tx, {
        action: "address_book.archive",
        entityType: "saved_address",
        entityId: id,
        after: { label: row.label },
      });
      return toSavedAddress(row);
    });
  }

  /** Called when an address is actually used, so the picker learns what matters. */
  async markUsed(tx: DbExecutor, accountId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx
      .update(savedAddresses)
      .set({
        useCount: sql`${savedAddresses.useCount} + 1`,
        lastUsedAt: this.clock.now(),
      })
      .where(and(eq(savedAddresses.accountId, accountId), inArray(savedAddresses.id, ids)));
  }

  private async clearDefault(tx: DbExecutor, accountId: string): Promise<void> {
    await tx
      .update(savedAddresses)
      .set({ isDefault: false })
      .where(and(eq(savedAddresses.accountId, accountId), eq(savedAddresses.isDefault, true)));
  }

  // ── bulk ──────────────────────────────────────────────────────────────────────

  /** The file we hand out, so an import matches what an export produced. */
  template(): string {
    return toCsv(
      [...IMPORT_COLUMNS],
      [
        [
          "Menlyn reception",
          "Thandi Mabaso",
          "0821234567",
          "thandi@example.co.za",
          "Shop 42, Menlyn Park Shopping Centre",
          "Menlyn",
          "Pretoria",
          "0181",
          "Ask for reception, cold room at the back",
        ],
      ],
    );
  }

  async export(accountId: string): Promise<string> {
    const rows = await this.list(accountId, { includeArchived: false });
    return toCsv(
      [...IMPORT_COLUMNS],
      rows.map((r) => [
        r.label,
        r.contact.name,
        r.contact.phone,
        r.contact.email ?? "",
        r.address.line1 ?? r.address.formatted,
        r.address.suburb ?? "",
        r.address.city ?? "",
        r.address.postalCode ?? "",
        r.instructions ?? "",
      ]),
    );
  }

  /**
   * Parse, validate, geocode and report. Writes only when `dryRun` is false, and then in one
   * transaction, so the customer never ends up with half a list.
   */
  async import(accountId: string, body: ImportAddressesRequest): Promise<ImportAddressesResult> {
    const table = parseCsv(body.csv);
    if (table.headers.length === 0) {
      throw AppError.validation([{ path: ["csv"], message: "the file is empty" }]);
    }
    for (const required of ["label", "address"] as const) {
      if (!table.headers.includes(required)) {
        throw AppError.validation([
          {
            path: ["csv"],
            message: `the file needs a "${required}" column; found: ${table.headers.join(", ")}`,
          },
        ]);
      }
    }
    if (table.rows.length > MAX_IMPORT_ROWS) {
      throw AppError.validation([
        {
          path: ["csv"],
          message: `${table.rows.length} rows is more than the ${MAX_IMPORT_ROWS} we take at once; split the file.`,
        },
      ]);
    }

    const existing = await this.dbs.db
      .select({ id: savedAddresses.id, label: savedAddresses.label })
      .from(savedAddresses)
      .where(and(eq(savedAddresses.accountId, accountId), eq(savedAddresses.archived, false)));
    const byLabel = new Map(existing.map((e) => [e.label.toLowerCase(), e.id]));

    const results: ImportRowResult[] = [];
    const writes: { id: string | null; values: typeof savedAddresses.$inferInsert }[] = [];
    const seen = new Set<string>();

    for (const { line, cells } of table.rows) {
      const record = rowToRecord(table.headers, cells);
      const label = record["label"] ?? "";
      const result: ImportRowResult = {
        line,
        label,
        outcome: "error",
        message: null,
        resolvedAddress: null,
        needsLocation: false,
      };

      if (!label) {
        result.message = "No label, so there is nothing to call this entry.";
        results.push(result);
        continue;
      }
      if (seen.has(label.toLowerCase())) {
        result.outcome = "skip";
        result.message = "The same label appears earlier in this file.";
        results.push(result);
        continue;
      }
      seen.add(label.toLowerCase());

      const contact = Contact.safeParse({
        name: record["contact_name"] || label,
        phone: record["contact_phone"] ?? "",
        email: record["contact_email"] || null,
      });
      if (!contact.success) {
        result.message = contact.error.issues
          .map((i) => `${i.path.join(".") || "contact"}: ${i.message}`)
          .join("; ");
        results.push(result);
        continue;
      }

      const line1 = record["address"] ?? "";
      const query = [line1, record["suburb"], record["city"], record["postal_code"]]
        .filter(Boolean)
        .join(", ");
      if (!line1) {
        result.message = "No street address.";
        results.push(result);
        continue;
      }

      // Geocode so the address can be priced and routed. A failure is not fatal: the entry is
      // saved without coordinates and flagged, because a phone number and a street still help.
      let address: Address;
      const [match] = await this.geo.geocode(query, 1).catch(() => []);
      if (match) {
        address = {
          formatted: match.formatted,
          line1,
          suburb: record["suburb"] || match.suburb,
          city: record["city"] || match.city,
          postalCode: record["postal_code"] || match.postalCode,
          country: "ZA",
          location: match.location,
          placeId: match.placeId,
        };
        result.resolvedAddress = match.formatted;
      } else {
        address = {
          formatted: query,
          line1,
          suburb: record["suburb"] || null,
          city: record["city"] || null,
          postalCode: record["postal_code"] || null,
          country: "ZA",
          location: { lat: 0, lng: 0 },
          placeId: null,
        };
        result.needsLocation = true;
        result.message = "We could not place this address on the map; add it before booking.";
        result.resolvedAddress = query;
      }

      const existingId = byLabel.get(label.toLowerCase()) ?? null;
      if (existingId && !body.updateExisting) {
        result.outcome = "skip";
        result.message = "You already have an address with this label.";
        results.push(result);
        continue;
      }

      result.outcome = existingId ? "update" : "create";
      results.push(result);
      writes.push({
        id: existingId,
        values: {
          accountId,
          label,
          address,
          contact: contact.data,
          instructions: record["instructions"] || null,
        },
      });
    }

    if (!body.dryRun && writes.length > 0) {
      await this.dbs.transaction(async (tx) => {
        for (const w of writes) {
          if (w.id) {
            await tx.update(savedAddresses).set(w.values).where(eq(savedAddresses.id, w.id));
          } else {
            await tx.insert(savedAddresses).values(w.values);
          }
        }
        await this.audit.record(tx, {
          action: "address_book.import",
          entityType: "account",
          entityId: accountId,
          after: {
            created: results.filter((r) => r.outcome === "create").length,
            updated: results.filter((r) => r.outcome === "update").length,
            skipped: results.filter((r) => r.outcome === "skip").length,
            errors: results.filter((r) => r.outcome === "error").length,
          },
        });
      });
    }

    return {
      dryRun: body.dryRun,
      total: results.length,
      created: results.filter((r) => r.outcome === "create").length,
      updated: results.filter((r) => r.outcome === "update").length,
      skipped: results.filter((r) => r.outcome === "skip").length,
      errors: results.filter((r) => r.outcome === "error").length,
      rows: results,
    };
  }
}

function toSavedAddress(r: typeof savedAddresses.$inferSelect): SavedAddress {
  return {
    id: r.id,
    accountId: r.accountId,
    label: r.label,
    address: r.address as Address,
    contact: r.contact as Contact,
    instructions: r.instructions,
    isCollectionPoint: r.isCollectionPoint,
    isDefault: r.isDefault,
    useCount: r.useCount,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    archived: r.archived,
    createdAt: r.createdAt.toISOString(),
  };
}
