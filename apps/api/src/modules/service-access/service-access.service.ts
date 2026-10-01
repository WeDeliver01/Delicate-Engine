import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  AccountExternalRef,
  CreateServiceClientRequest,
  LinkAccountExternalRefRequest,
  ServiceClient,
  ServiceClientWithSecret,
  ServiceScope,
  UpdateServiceClientRequest,
} from "@delicate/contracts";
import { accountExternalRefs, accounts, serviceClientAccounts, serviceClients } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { generateCredential } from "../../auth/service-credential.js";

/**
 * Issuing and withdrawing machine access.
 *
 * Every call here is a privileged action and is audited. The secret appears exactly once, in
 * the response to the call that created or rotated it: we store a hash, so there is nothing
 * to show afterwards and nothing to leak from the database.
 */
@Injectable()
export class ServiceAccessService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateServiceClientRequest): Promise<ServiceClientWithSecret> {
    await this.assertAccountsExist(input.accountIds);
    const credential = generateCredential();

    const client = await this.dbs.transaction(async (tx) => {
      const existing = await tx.query.serviceClients.findFirst({
        where: eq(serviceClients.slug, input.slug),
      });
      if (existing)
        throw AppError.conflict("slug_taken", "a service client already uses that slug");

      const [row] = await tx
        .insert(serviceClients)
        .values({
          name: input.name,
          slug: input.slug,
          keyId: credential.keyId,
          secretHash: credential.secretHash,
          secretHint: credential.secretHint,
          scopes: input.scopes,
          createdByUserId: requestContext.get()?.userId ?? null,
        })
        .returning();

      if (input.accountIds.length) {
        await tx.insert(serviceClientAccounts).values(
          input.accountIds.map((accountId) => ({
            serviceClientId: row!.id,
            accountId,
          })),
        );
      }

      await this.audit.record(tx, {
        action: "service_client.create",
        entityType: "service_client",
        entityId: row!.id,
        after: {
          slug: row!.slug,
          keyId: row!.keyId,
          scopes: input.scopes,
          accountIds: input.accountIds,
        },
      });
      return row!;
    });

    return {
      ...toServiceClient(client, input.accountIds),
      secret: credential.token,
    };
  }

  async update(id: string, input: UpdateServiceClientRequest): Promise<ServiceClient> {
    const before = await this.require(id);
    if (input.accountIds) await this.assertAccountsExist(input.accountIds);

    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .update(serviceClients)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.scopes ? { scopes: input.scopes } : {}),
        })
        .where(eq(serviceClients.id, id))
        .returning();

      let accountIds = before.accountIds;
      if (input.accountIds) {
        // Replace the grant list wholesale: "these accounts and no others" is the only
        // reading of this field that cannot silently leave an old grant behind.
        await tx.delete(serviceClientAccounts).where(eq(serviceClientAccounts.serviceClientId, id));
        if (input.accountIds.length) {
          await tx
            .insert(serviceClientAccounts)
            .values(input.accountIds.map((accountId) => ({ serviceClientId: id, accountId })));
        }
        accountIds = input.accountIds;
      }

      await this.audit.record(tx, {
        action: "service_client.update",
        entityType: "service_client",
        entityId: id,
        before: { name: before.name, scopes: before.scopes, accountIds: before.accountIds },
        after: { name: row!.name, scopes: row!.scopes, accountIds },
      });
      return toServiceClient(row!, accountIds);
    });
  }

  /**
   * Issue a new secret for the same client. The old one stops working the moment this
   * commits — there is no overlap window, so a rotation is a coordinated change, not a
   * background tidy-up.
   */
  async rotate(id: string): Promise<ServiceClientWithSecret> {
    const before = await this.require(id);
    const credential = generateCredential();

    const row = await this.dbs.transaction(async (tx) => {
      const [updated] = await tx
        .update(serviceClients)
        .set({
          keyId: credential.keyId,
          secretHash: credential.secretHash,
          secretHint: credential.secretHint,
          status: "active",
          revokedAt: null,
        })
        .where(eq(serviceClients.id, id))
        .returning();
      await this.audit.record(tx, {
        action: "service_client.rotate",
        entityType: "service_client",
        entityId: id,
        before: { keyId: before.keyId },
        after: { keyId: credential.keyId },
      });
      return updated!;
    });

    return { ...toServiceClient(row, before.accountIds), secret: credential.token };
  }

  async revoke(id: string): Promise<ServiceClient> {
    const before = await this.require(id);
    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .update(serviceClients)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(eq(serviceClients.id, id))
        .returning();
      await this.audit.record(tx, {
        action: "service_client.revoke",
        entityType: "service_client",
        entityId: id,
        before: { status: before.status },
        after: { status: "revoked" },
      });
      return toServiceClient(row!, before.accountIds);
    });
  }

  async list(): Promise<{ items: ServiceClient[] }> {
    const rows = await this.dbs.db
      .select()
      .from(serviceClients)
      .orderBy(desc(serviceClients.createdAt));
    if (!rows.length) return { items: [] };
    const grants = await this.dbs.db
      .select()
      .from(serviceClientAccounts)
      .where(
        inArray(
          serviceClientAccounts.serviceClientId,
          rows.map((r) => r.id),
        ),
      );
    return {
      items: rows.map((r) =>
        toServiceClient(
          r,
          grants.filter((g) => g.serviceClientId === r.id).map((g) => g.accountId),
        ),
      ),
    };
  }

  async get(id: string): Promise<ServiceClient> {
    return this.require(id);
  }

  // ── external references ─────────────────────────────────────────────────────

  async linkExternalRef(input: LinkAccountExternalRefRequest): Promise<AccountExternalRef> {
    await this.assertAccountsExist([input.accountId]);
    return this.dbs.transaction(async (tx) => {
      const existing = await tx.query.accountExternalRefs.findFirst({
        where: and(
          eq(accountExternalRefs.system, input.system),
          eq(accountExternalRefs.externalId, input.externalId),
        ),
      });
      if (existing && existing.accountId !== input.accountId) {
        throw AppError.conflict(
          "external_ref_taken",
          "that reference already points at a different account",
          { accountId: existing.accountId },
        );
      }
      const [row] = existing
        ? await tx
            .update(accountExternalRefs)
            .set({ note: input.note })
            .where(eq(accountExternalRefs.id, existing.id))
            .returning()
        : await tx
            .insert(accountExternalRefs)
            .values({
              accountId: input.accountId,
              system: input.system,
              externalId: input.externalId,
              note: input.note,
              createdByUserId: requestContext.get()?.userId ?? null,
            })
            .returning();

      await this.audit.record(tx, {
        action: existing ? "account.external_ref_update" : "account.external_ref_link",
        entityType: "account",
        entityId: input.accountId,
        before: existing ? { note: existing.note } : undefined,
        after: { system: input.system, externalId: input.externalId, note: input.note },
      });
      return toExternalRef(row!);
    });
  }

  async unlinkExternalRef(id: string): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .delete(accountExternalRefs)
        .where(eq(accountExternalRefs.id, id))
        .returning();
      if (!row) throw AppError.notFound("external reference");
      await this.audit.record(tx, {
        action: "account.external_ref_unlink",
        entityType: "account",
        entityId: row.accountId,
        before: { system: row.system, externalId: row.externalId },
      });
    });
  }

  async listExternalRefs(accountId?: string): Promise<{ items: AccountExternalRef[] }> {
    const rows = await this.dbs.db
      .select()
      .from(accountExternalRefs)
      .where(accountId ? eq(accountExternalRefs.accountId, accountId) : undefined)
      .orderBy(desc(accountExternalRefs.createdAt));
    return { items: rows.map(toExternalRef) };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async require(id: string): Promise<ServiceClient> {
    const row = await this.dbs.db.query.serviceClients.findFirst({
      where: eq(serviceClients.id, id),
    });
    if (!row) throw AppError.notFound("service client");
    const grants = await this.dbs.db
      .select({ accountId: serviceClientAccounts.accountId })
      .from(serviceClientAccounts)
      .where(eq(serviceClientAccounts.serviceClientId, id));
    return toServiceClient(
      row,
      grants.map((g) => g.accountId),
    );
  }

  private async assertAccountsExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const rows = await this.dbs.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.id, ids));
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw AppError.notFound("account", { missing });
  }
}

function toServiceClient(
  r: typeof serviceClients.$inferSelect,
  accountIds: string[],
): ServiceClient {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    keyId: r.keyId,
    secretHint: r.secretHint,
    status: r.status,
    scopes: r.scopes as ServiceScope[],
    accountIds,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toExternalRef(r: typeof accountExternalRefs.$inferSelect): AccountExternalRef {
  return {
    id: r.id,
    accountId: r.accountId,
    system: r.system,
    externalId: r.externalId,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
