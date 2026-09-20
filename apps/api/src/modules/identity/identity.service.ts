import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type {
  Account,
  AccountMembership,
  AccountRole,
  AddMemberRequest,
  CreateAccountRequest,
  Member,
  MeResponse,
  UpdateProfileRequest,
  UserProfile,
} from "@delicate/contracts";
import { accounts, memberships, organizations, users, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { AuditService } from "../../infra/audit.service.js";
import { AppError } from "../../common/errors.js";
import { WalletService } from "../wallet/wallet.service.js";
import type { Principal } from "../../auth/principal.js";

/**
 * Identity & Accounts domain. Every mutation runs in one transaction that writes the change,
 * its audit row and its outbox event together.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly dbs: DbService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
  ) {}

  async me(user: Principal["user"]): Promise<MeResponse> {
    const { db } = this.dbs;
    const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!row) throw AppError.notFound("user");

    const rows = await db
      .select({
        id: accounts.id,
        organizationId: accounts.organizationId,
        name: accounts.name,
        type: accounts.type,
        billingMode: accounts.billingMode,
        status: accounts.status,
        createdAt: accounts.createdAt,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.accountId))
      .where(eq(memberships.userId, user.id))
      .orderBy(accounts.name);

    return {
      user: toProfile(row),
      accounts: rows.map(
        (r) => ({ ...r, createdAt: r.createdAt.toISOString() }) as AccountMembership,
      ),
    };
  }

  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<UserProfile> {
    return this.dbs.transaction(async (tx) => {
      const before = await tx.query.users.findFirst({ where: eq(users.id, userId) });
      if (!before) throw AppError.notFound("user");
      const [after] = await tx
        .update(users)
        .set({ fullName: patch.fullName ?? before.fullName, phone: patch.phone ?? before.phone })
        .where(eq(users.id, userId))
        .returning();
      await this.audit.record(tx, {
        action: "user.update_profile",
        entityType: "user",
        entityId: userId,
        before: { fullName: before.fullName, phone: before.phone },
        after: { fullName: after!.fullName, phone: after!.phone },
      });
      return toProfile(after!);
    });
  }

  async createAccount(
    user: Principal["user"],
    input: CreateAccountRequest,
  ): Promise<AccountMembership> {
    return this.dbs.transaction(async (tx) => {
      let organizationId: string | null = null;

      if (input.type === "individual") {
        const existing = await tx
          .select({ id: accounts.id })
          .from(memberships)
          .innerJoin(accounts, eq(accounts.id, memberships.accountId))
          .where(and(eq(memberships.userId, user.id), eq(accounts.type, "individual")))
          .limit(1);
        if (existing.length > 0) {
          throw AppError.conflict(
            "individual_account_exists",
            "you already have a personal account",
          );
        }
      } else {
        organizationId = await this.resolveOrganization(tx, user, input);
      }

      const [account] = await tx
        .insert(accounts)
        .values({ name: input.name, type: input.type, organizationId, billingMode: "prepaid" })
        .returning();
      await tx
        .insert(memberships)
        .values({ accountId: account!.id, userId: user.id, role: "customer_owner" });
      await this.wallet.ensure(tx, account!.id);

      await this.audit.record(tx, {
        action: "account.create",
        entityType: "account",
        entityId: account!.id,
        after: account,
      });
      await this.outbox.emit(
        tx,
        "account.created",
        {
          accountId: account!.id,
          organizationId,
          type: account!.type,
          billingMode: account!.billingMode,
          name: account!.name,
        },
        { dedupeKey: `account:${account!.id}:created` },
      );
      await this.outbox.emit(
        tx,
        "membership.granted",
        { accountId: account!.id, userId: user.id, role: "customer_owner" },
        {
          dedupeKey: `membership:${account!.id}:${user.id}:granted:${account!.createdAt.getTime()}`,
        },
      );

      return { ...toAccount(account!), role: "customer_owner" };
    });
  }

  /**
   * Business accounts hang off an organization. The caller may attach to an organization they
   * already own an account in, or create a new one inline. They may never attach to a stranger's.
   */
  private async resolveOrganization(
    tx: DbExecutor,
    user: Principal["user"],
    input: CreateAccountRequest,
  ): Promise<string> {
    const org = input.organization;
    if (org?.id) {
      const owned = await tx
        .select({ id: accounts.id })
        .from(memberships)
        .innerJoin(accounts, eq(accounts.id, memberships.accountId))
        .where(
          and(
            eq(memberships.userId, user.id),
            eq(memberships.role, "customer_owner"),
            eq(accounts.organizationId, org.id),
          ),
        )
        .limit(1);
      if (owned.length === 0)
        throw AppError.forbidden("you do not own an account in that organization");
      return org.id;
    }
    if (!org?.name) {
      throw AppError.validation([
        { path: ["organization", "name"], message: "required for business accounts" },
      ]);
    }
    const [created] = await tx
      .insert(organizations)
      .values({
        name: org.name,
        registrationNumber: org.registrationNumber ?? null,
        vatNumber: org.vatNumber ?? null,
      })
      .returning();
    await this.audit.record(tx, {
      action: "organization.create",
      entityType: "organization",
      entityId: created!.id,
      after: created,
    });
    return created!.id;
  }

  async getAccount(accountId: string): Promise<Account> {
    const row = await this.dbs.db.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
    if (!row) throw AppError.notFound("account");
    return toAccount(row);
  }

  async listMembers(accountId: string): Promise<Member[]> {
    const rows = await this.dbs.db
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.accountId, accountId))
      .orderBy(memberships.createdAt);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /**
   * Phase 0: the invitee must already have signed in once (so their Supabase id exists here).
   * Email invitations for unknown users arrive with the notifications module.
   */
  async addMember(accountId: string, input: AddMemberRequest): Promise<Member> {
    return this.dbs.transaction(async (tx) => {
      const target = await tx.query.users.findFirst({
        where: eq(users.email, input.email.toLowerCase()),
      });
      if (!target) {
        throw AppError.notFound("user", { hint: "ask them to sign up first, then add them" });
      }
      const [row] = await tx
        .insert(memberships)
        .values({ accountId, userId: target.id, role: input.role })
        .onConflictDoUpdate({
          target: [memberships.accountId, memberships.userId],
          set: { role: input.role },
        })
        .returning();
      await this.audit.record(tx, {
        action: "membership.grant",
        entityType: "membership",
        entityId: `${accountId}:${target.id}`,
        after: row,
      });
      await this.outbox.emit(
        tx,
        "membership.granted",
        { accountId, userId: target.id, role: input.role },
        { dedupeKey: `membership:${accountId}:${target.id}:granted:${Date.now()}` },
      );
      return {
        userId: target.id,
        email: target.email,
        fullName: target.fullName,
        role: row!.role,
        createdAt: row!.createdAt.toISOString(),
      };
    });
  }

  async removeMember(accountId: string, userId: string): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const existing = await tx.query.memberships.findFirst({
        where: and(eq(memberships.accountId, accountId), eq(memberships.userId, userId)),
      });
      if (!existing) throw AppError.notFound("membership");

      if (existing.role === "customer_owner") {
        const [count] = await tx
          .select({ owners: sql<number>`count(*)::int` })
          .from(memberships)
          .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "customer_owner")));
        if ((count?.owners ?? 0) <= 1) {
          throw AppError.conflict("last_owner", "an account must keep at least one owner");
        }
      }

      await tx
        .delete(memberships)
        .where(and(eq(memberships.accountId, accountId), eq(memberships.userId, userId)));
      await this.audit.record(tx, {
        action: "membership.revoke",
        entityType: "membership",
        entityId: `${accountId}:${userId}`,
        before: existing,
      });
      await this.outbox.emit(
        tx,
        "membership.revoked",
        { accountId, userId },
        { dedupeKey: `membership:${accountId}:${userId}:revoked:${Date.now()}` },
      );
    });
  }

  async changeMemberRole(accountId: string, userId: string, role: AccountRole): Promise<Member> {
    const target = await this.dbs.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw AppError.notFound("user");
    return this.addMember(accountId, { email: target.email, role });
  }
}

function toProfile(row: typeof users.$inferSelect): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    platformRole: row.platformRole,
  };
}

function toAccount(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    type: row.type,
    billingMode: row.billingMode,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
