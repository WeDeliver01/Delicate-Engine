import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { and, eq } from "drizzle-orm";
import type { ServiceScope } from "@delicate/contracts";
import { accountExternalRefs, accounts, serviceClientAccounts, serviceClients } from "@delicate/db";
import { DbService } from "../infra/db.module.js";
import { AppError } from "../common/errors.js";
import { parseCredential, secretMatches } from "./service-credential.js";
import type { ServicePrincipal } from "./principal.js";

/** How stale `lastUsedAt` may get before we spend a write refreshing it. */
const LAST_USED_REFRESH_MS = 5 * 60 * 1000;

/**
 * Turns a service credential into a principal, and the account the caller names into an
 * account it is actually allowed to act for.
 *
 * Revocation is immediate by design: every request reads the row, so there is no cached
 * credential to outlive a key someone has just pulled.
 */
@Injectable()
export class ServiceClientVerifier {
  constructor(
    private readonly dbs: DbService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ServiceClientVerifier.name);
  }

  async verify(token: string): Promise<ServicePrincipal> {
    const parsed = parseCredential(token);
    if (!parsed) throw AppError.unauthorized("malformed service credential");

    const row = await this.dbs.db.query.serviceClients.findFirst({
      where: eq(serviceClients.keyId, parsed.keyId),
    });
    // Same answer for "no such key" and "wrong secret": a caller probing keys should not be
    // able to tell which half they got right.
    if (!row || !secretMatches(parsed.secret, row.secretHash)) {
      this.logger.warn(
        { keyId: parsed.keyId, known: Boolean(row) },
        "rejected a service credential",
      );
      throw AppError.unauthorized("invalid service credential");
    }
    if (row.status !== "active") {
      throw AppError.unauthorized("this service credential has been revoked");
    }

    void this.touch(row.id, row.lastUsedAt);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      scopes: row.scopes as ServiceScope[],
    };
  }

  /**
   * Resolve the account a service caller named, and prove it may act for it.
   *
   * Three ways to name one: our account id, the caller's own identifier for it, or the
   * account's short code. The second exists so an integrating system can keep using its ids
   * and never store ours; the third exists so that most of them need not do either.
   *
   * Resolving a name is not the same as being allowed to use it. Whichever way the account
   * was named, the grant below is what authorises — so a caller that guesses a code it was
   * never granted gets exactly as far as one that guesses a uuid.
   */
  async resolveAccount(
    service: ServicePrincipal,
    named: { accountId?: string | null; externalRef?: string | null },
  ): Promise<{ id: string; role: null }> {
    let accountId = named.accountId ?? null;

    if (!accountId && named.externalRef) {
      const ref = await this.dbs.db.query.accountExternalRefs.findFirst({
        where: and(
          // The system is the caller's own slug, never a value it sends: one integration
          // cannot resolve another's references by guessing a name.
          eq(accountExternalRefs.system, service.slug),
          eq(accountExternalRefs.externalId, named.externalRef),
        ),
      });

      // A mapping wins where one exists, so a system that has registered its own id keeps
      // the meaning it registered even if that id collides with somebody's code.
      accountId = ref?.accountId ?? (await this.accountIdByCode(named.externalRef));

      if (!accountId) {
        throw AppError.forbidden("no account is mapped to this reference", {
          system: service.slug,
          externalId: named.externalRef,
        });
      }
    }

    if (!accountId) {
      throw AppError.forbidden("an active account is required", {
        headers: ["x-account-id", "x-account-ref"],
      });
    }

    const grant = await this.dbs.db.query.serviceClientAccounts.findFirst({
      where: and(
        eq(serviceClientAccounts.serviceClientId, service.id),
        eq(serviceClientAccounts.accountId, accountId),
      ),
    });
    if (!grant) throw AppError.forbidden("this credential may not act for that account");

    const account = await this.dbs.db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { id: true, status: true },
    });
    if (!account) throw AppError.forbidden("unknown account");
    if (account.status !== "active") throw AppError.forbidden("account is not active");

    return { id: account.id, role: null };
  }

  /**
   * The account wearing this short code, if any.
   *
   * Codes are issued uppercase, so the input is folded up rather than the column folded down:
   * the comparison stays an equality on the unique index, and a merchant who typed "hbb001"
   * into their store settings is still understood.
   */
  private async accountIdByCode(ref: string): Promise<string | null> {
    const code = ref.trim().toUpperCase();
    if (!code) return null;
    const row = await this.dbs.db.query.accounts.findFirst({
      where: eq(accounts.code, code),
      columns: { id: true },
    });
    return row?.id ?? null;
  }

  /** Best-effort, and deliberately not awaited: a write per request would be a silly cost. */
  private async touch(id: string, lastUsedAt: Date | null): Promise<void> {
    const now = Date.now();
    if (lastUsedAt && now - lastUsedAt.getTime() < LAST_USED_REFRESH_MS) return;
    try {
      await this.dbs.db
        .update(serviceClients)
        .set({ lastUsedAt: new Date(now) })
        .where(eq(serviceClients.id, id));
    } catch (err) {
      this.logger.debug({ err }, "could not record service credential use");
    }
  }
}
