import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type {
  Account,
  AdminAccountDetail,
  CredentialAction,
  AccountMembership,
  AccountRole,
  AddMemberRequest,
  CreateAccountRequest,
  Member,
  MeResponse,
  UpdateAccountRequest,
  UpdateOrganizationRequest,
  UpdateProfileRequest,
  UserProfile,
} from "@delicate/contracts";
import { accounts, memberships, organizations, users, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { AuditService } from "../../infra/audit.service.js";
import { AppError } from "../../common/errors.js";
import { WalletService } from "../wallet/wallet.service.js";
import { SupabaseAdminService } from "./supabase-admin.service.js";
import type { AuthenticatedUser } from "../../auth/principal.js";

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
    private readonly supabase: SupabaseAdminService,
  ) {}

  async me(user: AuthenticatedUser, actingAsId_?: string | null): Promise<MeResponse> {
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

    // Only when the account is not one of their own. Staff looking at an account they
    // genuinely belong to are not acting as anyone, and a banner there would be noise that
    // teaches people to ignore the banner that matters.
    const actingAsId = actingAsId_ && !rows.some((r) => r.id === actingAsId_) ? actingAsId_ : null;
    const actingAs = actingAsId
      ? ((await db.query.accounts.findFirst({
          where: eq(accounts.id, actingAsId),
          columns: { id: true, name: true },
        })) ?? null)
      : null;

    return {
      user: toProfile(row),
      accounts: rows.map(
        (r) => ({ ...r, createdAt: r.createdAt.toISOString() }) as AccountMembership,
      ),
      actingAs,
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
    user: AuthenticatedUser,
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
        .values({
          name: input.name,
          type: input.type,
          organizationId,
          billingMode: "prepaid",
          /*
            The address we write to. Without it every notification this account ever earns is
            recorded as suppressed for having nowhere to go, and every invoice is addressed to
            nobody -- quietly, because a suppressed message is not a failed one and nothing
            raises its hand. The person creating the account is the right default; they can
            change it to accounts@ later.
          */
          billingEmail: user.email,
        })
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
    user: AuthenticatedUser,
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

  /** Everything the console shows about one account, in one round trip. */
  async adminDetail(accountId: string): Promise<AdminAccountDetail> {
    const row = await this.dbs.db.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
    if (!row) throw AppError.notFound("account");
    const organization = row.organizationId
      ? ((await this.dbs.db.query.organizations.findFirst({
          where: eq(organizations.id, row.organizationId),
        })) ?? null)
      : null;
    return {
      account: toAccount(row),
      billingEmail: row.billingEmail,
      billingAddress: row.billingAddress ?? null,
      requiresVehicleClass: row.requiresVehicleClass,
      organization: organization
        ? {
            id: organization.id,
            name: organization.name,
            registrationNumber: organization.registrationNumber,
            vatNumber: organization.vatNumber,
          }
        : null,
      members: await this.listMembers(accountId),
    };
  }

  /**
   * Change an account on the customer's behalf.
   *
   * Staff only, and every field here is one somebody can be wrong about in a way that costs
   * money -- an invoice to the wrong address, a suspended account that should be open -- so
   * the before and after of each change is kept.
   */
  async updateAccount(accountId: string, patch: UpdateAccountRequest): Promise<AdminAccountDetail> {
    await this.dbs.transaction(async (tx) => {
      const before = await tx.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
      if (!before) throw AppError.notFound("account");
      const [after] = await tx
        .update(accounts)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.type === undefined ? {} : { type: patch.type }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.billingEmail === undefined ? {} : { billingEmail: patch.billingEmail }),
          ...(patch.requiresVehicleClass === undefined
            ? {}
            : { requiresVehicleClass: patch.requiresVehicleClass }),
        })
        .where(eq(accounts.id, accountId))
        .returning();
      await this.audit.record(tx, {
        action: "account.update",
        entityType: "account",
        entityId: accountId,
        before,
        after,
      });
    });
    return this.adminDetail(accountId);
  }

  /** The business behind the account: what goes on the invoice above the address. */
  async updateOrganization(
    accountId: string,
    patch: UpdateOrganizationRequest,
  ): Promise<AdminAccountDetail> {
    await this.dbs.transaction(async (tx) => {
      const account = await tx.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
      if (!account?.organizationId) {
        throw AppError.notFound("organization", { accountId });
      }
      const before = await tx.query.organizations.findFirst({
        where: eq(organizations.id, account.organizationId),
      });
      const [after] = await tx
        .update(organizations)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.registrationNumber === undefined
            ? {}
            : { registrationNumber: patch.registrationNumber }),
          ...(patch.vatNumber === undefined ? {} : { vatNumber: patch.vatNumber }),
        })
        .where(eq(organizations.id, account.organizationId))
        .returning();
      await this.audit.record(tx, {
        action: "organization.update",
        entityType: "organization",
        entityId: account.organizationId,
        before,
        after,
      });
    });
    return this.adminDetail(accountId);
  }

  /**
   * Act on somebody's sign-in: a reset link, a corrected address, a door closed, a password
   * set by hand.
   *
   * The password is never stored, never logged and never written to the audit row — what is
   * recorded is that a named person set one, when, and for whom. That is the fact anybody
   * investigating later needs, and the only one it is safe to keep.
   */
  async credentialAction(
    userId: string,
    action: CredentialAction,
    resetRedirectUrl: string,
  ): Promise<{ done: true }> {
    const user = await this.dbs.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw AppError.notFound("user");

    switch (action.action) {
      case "send_reset":
        await this.supabase.sendPasswordReset(user.email, resetRedirectUrl);
        break;
      case "set_email":
        await this.supabase.setEmail(userId, action.email);
        break;
      case "set_password":
        await this.supabase.setPassword(userId, action.password);
        break;
      case "block_sign_in":
        await this.supabase.setSignInBlocked(userId, action.blocked);
        break;
    }

    /*
      Our own copy of the address follows Supabase's, or the next time they sign in the
      engine would match them on an address we no longer agree about.
    */
    await this.dbs.transaction(async (tx) => {
      if (action.action === "set_email") {
        await tx.update(users).set({ email: action.email }).where(eq(users.id, userId));
      }
      await this.audit.record(tx, {
        action: `user.${action.action}`,
        entityType: "user",
        entityId: userId,
        before: { email: user.email },
        // Never the password itself. That a named person set one is the fact worth keeping.
        after: action.action === "set_password" ? { passwordSet: true } : action,
      });
    });
    return { done: true };
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
