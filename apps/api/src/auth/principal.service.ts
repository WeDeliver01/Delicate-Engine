import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { accounts, memberships, users } from "@delicate/db";
import { DbService } from "../infra/db.module.js";
import { AppError } from "../common/errors.js";
import type { VerifiedToken } from "./token-verifier.js";
import { isStaff, type AuthenticatedUser, type Principal } from "./principal.js";

/**
 * Turns a verified token into our own notion of a user, and an account header into an
 * authorised active account. Provisioning is just-in-time: the first request from a new
 * Supabase user creates their `users` row (Supabase owns credentials; we own the profile).
 */
@Injectable()
export class PrincipalService {
  constructor(private readonly dbs: DbService) {}

  async resolveUser(token: VerifiedToken): Promise<AuthenticatedUser> {
    const { db } = this.dbs;
    const existing = await db.query.users.findFirst({ where: eq(users.id, token.userId) });
    if (existing) {
      return {
        id: existing.id,
        email: existing.email,
        fullName: existing.fullName,
        platformRole: existing.platformRole,
      };
    }
    if (!token.email) throw AppError.unauthorized("token has no email; cannot provision user");

    const [created] = await db
      .insert(users)
      .values({ id: token.userId, email: token.email })
      .onConflictDoNothing()
      .returning();
    const row = created ?? (await db.query.users.findFirst({ where: eq(users.id, token.userId) }));
    if (!row) throw AppError.unauthorized("could not provision user");
    return { id: row.id, email: row.email, fullName: row.fullName, platformRole: row.platformRole };
  }

  async resolveAccount(
    user: AuthenticatedUser,
    accountId: string,
  ): Promise<NonNullable<Principal["account"]>> {
    const { db } = this.dbs;
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { id: true, status: true },
    });
    if (!account) throw AppError.forbidden("unknown account");
    if (account.status !== "active") throw AppError.forbidden("account is not active");

    const membership = await db.query.memberships.findFirst({
      where: and(eq(memberships.accountId, accountId), eq(memberships.userId, user.id)),
      columns: { role: true },
    });
    if (membership) return { id: account.id, role: membership.role, impersonating: false };

    // No membership. Staff may still act here — support cannot help with a booking they
    // cannot see — but it is recorded as acting on someone's behalf rather than passed off
    // as the customer's own doing. Their account role stays null: authority comes from the
    // platform role, not from a membership they do not have.
    if (isStaff({ user, service: null, account: null })) {
      return { id: account.id, role: null, impersonating: true };
    }

    throw AppError.forbidden("not a member of this account");
  }
}
