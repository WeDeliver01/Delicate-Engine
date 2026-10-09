import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type {
  CreateTopUpRequest,
  CreateTopUpResponse,
  PaymentProviderName,
  TopUp,
} from "@delicate/contracts";
import { inboxMessages, topUps, type DbExecutor } from "@delicate/db";
import { ENV, type Env } from "../../config/env.js";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { OutboxService } from "../../infra/outbox.service.js";
import { AppError } from "../../common/errors.js";
import { requestContext } from "../../common/request-context.js";
import { WalletService } from "./wallet.service.js";
import { LedgerService, cr, dr } from "../ledger/ledger.service.js";
import { PAYMENT_PROVIDERS, type PaymentProvider } from "./payments/payment.provider.js";

/**
 * Top-up lifecycle: pending (instructions issued) → confirmed (wallet credited) | failed |
 * cancelled. Confirmation is the ONLY path that credits, and it is idempotent: confirming a
 * confirmed top-up is a no-op, and the wallet entry key is derived from the top-up id.
 */
@Injectable()
export class TopUpService {
  private readonly providers: Map<PaymentProviderName, PaymentProvider>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[],
  ) {
    this.providers = new Map(providers.map((p) => [p.name, p]));
  }

  async availableProviders(): Promise<PaymentProviderName[]> {
    const all = [...this.providers.values()];
    const enabled = await Promise.all(all.map((p) => p.isEnabled()));
    return all.filter((_p, i) => enabled[i]).map((p) => p.name);
  }

  async create(
    accountId: string,
    payerEmail: string | null,
    input: CreateTopUpRequest,
  ): Promise<CreateTopUpResponse> {
    const provider = this.providers.get(input.provider);
    if (!provider || !(await provider.isEnabled())) {
      throw new AppError("provider_unavailable", `${input.provider} is not available`, 400, {
        available: await this.availableProviders(),
      });
    }
    const topUp = await this.dbs.transaction(async (tx) => {
      await this.wallet.ensure(tx, accountId);
      const [row] = await tx
        .insert(topUps)
        .values({
          accountId,
          provider: input.provider,
          amountCents: input.amountCents,
          reference: newReference(),
          initiatedByUserId: requestContext.get()?.userId ?? null,
        })
        .returning();
      await this.outbox.emit(
        tx,
        "wallet.topup_requested",
        { accountId, topUpId: row!.id, provider: input.provider, amountCents: input.amountCents },
        { dedupeKey: `topup:${row!.id}:requested` },
      );
      return toTopUp(row!);
    });

    const base = this.env.WEB_PUBLIC_URL.replace(/\/$/, "");
    /*
      Back where they started. Usually the wallet, but a top-up is often only a step in
      something else — being short at the end of a booking, most of all — and the schema
      restricts this to a path inside our own portal, so it cannot be bent into a redirect
      to somebody else's site.
    */
    const path = input.returnTo ?? "/portal/wallet";
    const sep = path.includes("?") ? "&" : "?";
    const instructions = await provider.initiate(topUp, {
      returnUrl: `${base}${path}${sep}topup=${topUp.id}&result=return`,
      cancelUrl: `${base}${path}${sep}topup=${topUp.id}&result=cancel`,
      notifyUrl: `${this.env.API_PUBLIC_URL.replace(/\/$/, "")}/v1/webhooks/${provider.name}`,
      payerEmail,
    });
    return { topUp, instructions };
  }

  /** Credit the wallet for a top-up. Idempotent. `by` = "finance" (console) or provider name. */
  async confirm(
    tx: DbExecutor,
    topUpId: string,
    by: string,
    providerRef: string | null,
    metadata?: unknown,
  ): Promise<TopUp> {
    const [row] = await tx.select().from(topUps).where(eq(topUps.id, topUpId)).for("update");
    if (!row) throw AppError.notFound("top-up");
    if (row.status === "confirmed") return toTopUp(row);
    if (row.status !== "pending")
      throw AppError.conflict("topup_not_pending", `top-up is ${row.status}`);

    const entry = await this.wallet.post(tx, {
      accountId: row.accountId,
      amountCents: row.amountCents,
      kind: "topup",
      reference: row.id,
      description: `Top-up via ${row.provider} (${row.reference})`,
      idempotencyKey: `topup:${row.id}`,
    });
    await this.ledger.post(tx, {
      kind: "topup",
      refType: "top_up",
      refId: row.id,
      description: `Top-up ${row.reference} via ${row.provider}`,
      idempotencyKey: `topup:${row.id}`,
      lines: [
        dr("CASH_CLEARING", row.amountCents, { type: "company" }, row.reference),
        cr(
          "CUSTOMER_PREPAID_LIABILITY",
          row.amountCents,
          { type: "account", id: row.accountId },
          row.reference,
        ),
      ],
    });
    const [updated] = await tx
      .update(topUps)
      .set({
        status: "confirmed",
        providerRef,
        confirmedAt: new Date(),
        confirmedByUserId: by === "finance" ? (requestContext.get()?.userId ?? null) : null,
        metadata: metadata ?? row.metadata,
      })
      .where(eq(topUps.id, topUpId))
      .returning();
    await this.audit.record(tx, {
      action: "topup.confirm",
      entityType: "top_up",
      entityId: topUpId,
      before: { status: row.status },
      after: { status: "confirmed", by, providerRef },
    });
    await this.outbox.emit(
      tx,
      "wallet.topup_confirmed",
      {
        accountId: row.accountId,
        topUpId,
        provider: row.provider,
        amountCents: row.amountCents,
        balanceAfterCents: entry.balanceAfterCents,
      },
      { dedupeKey: `topup:${topUpId}:confirmed` },
    );
    return toTopUp(updated!);
  }

  async cancel(topUpId: string, reason: string): Promise<TopUp> {
    return this.dbs.transaction(async (tx) => {
      const [row] = await tx.select().from(topUps).where(eq(topUps.id, topUpId)).for("update");
      if (!row) throw AppError.notFound("top-up");
      if (row.status !== "pending")
        throw AppError.conflict("topup_not_pending", `top-up is ${row.status}`);
      const [updated] = await tx
        .update(topUps)
        .set({ status: "cancelled", metadata: { reason } })
        .where(eq(topUps.id, topUpId))
        .returning();
      await this.audit.record(tx, {
        action: "topup.cancel",
        entityType: "top_up",
        entityId: topUpId,
        after: { reason },
      });
      return toTopUp(updated!);
    });
  }

  /**
   * Provider notification (webhook). Lands in the inbox first (dedupe on provider + payment id),
   * then verifies and confirms. Returns quickly; providers retry on non-2xx.
   */
  async handleNotification(
    providerName: PaymentProviderName,
    input: {
      rawBody: string;
      params: Record<string, string>;
      headers: Record<string, string | string[] | undefined>;
      sourceIp?: string;
    },
  ): Promise<{ duplicate: boolean; status: string }> {
    const provider = this.providers.get(providerName);
    if (!provider) throw AppError.notFound("payment provider");
    const verified = await provider.verifyNotification(input);
    const externalId = verified.providerRef || `${verified.reference}:${verified.status}`;

    return this.dbs.transaction(async (tx) => {
      const inserted = await tx
        .insert(inboxMessages)
        .values({
          source: `payments:${providerName}`,
          externalId,
          dedupeKey: `topup:${verified.reference}:${verified.status}:${externalId}`,
          eventType: `payment.${verified.status}`,
          payload: verified.raw,
          headers: input.headers,
        })
        .onConflictDoNothing()
        .returning({ id: inboxMessages.id });
      if (inserted.length === 0) return { duplicate: true, status: verified.status };

      const [row] = await tx
        .select()
        .from(topUps)
        .where(eq(topUps.id, verified.reference))
        .for("update");
      if (!row) throw AppError.notFound("top-up", { reference: verified.reference });
      if (verified.status === "complete") {
        if (verified.amountCents !== row.amountCents) {
          throw new AppError("amount_mismatch", "paid amount does not match the top-up", 400, {
            expected: row.amountCents,
            received: verified.amountCents,
          });
        }
        await this.confirm(tx, row.id, providerName, verified.providerRef, verified.raw);
      } else if (
        (verified.status === "failed" || verified.status === "cancelled") &&
        row.status === "pending"
      ) {
        await tx
          .update(topUps)
          .set({
            status: verified.status,
            providerRef: verified.providerRef,
            metadata: verified.raw,
          })
          .where(eq(topUps.id, row.id));
      }
      await tx
        .update(inboxMessages)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(inboxMessages.id, inserted[0]!.id));
      return { duplicate: false, status: verified.status };
    });
  }

  async listForAccount(accountId: string, limit: number, cursor?: string) {
    const cursorDate = cursor ? new Date(cursor) : null;
    const rows = await this.dbs.db
      .select()
      .from(topUps)
      .where(
        and(
          eq(topUps.accountId, accountId),
          cursorDate ? lt(topUps.createdAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(topUps.createdAt))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(toTopUp);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.createdAt : null };
  }

  async listPending(limit: number, cursor?: string) {
    const cursorDate = cursor ? new Date(cursor) : null;
    const rows = await this.dbs.db
      .select()
      .from(topUps)
      .where(
        and(
          eq(topUps.status, "pending"),
          cursorDate ? lt(topUps.createdAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(topUps.createdAt))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(toTopUp);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.createdAt : null };
  }
}

/** Human-friendly EFT reference, e.g. DC-7K3M9QX2. Unambiguous alphabet, unique in the table. */
function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `DC-${out}`;
}

export function toTopUp(r: typeof topUps.$inferSelect): TopUp {
  return {
    id: r.id,
    accountId: r.accountId,
    provider: r.provider,
    amountCents: r.amountCents,
    status: r.status,
    reference: r.reference,
    providerRef: r.providerRef,
    createdAt: r.createdAt.toISOString(),
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
  };
}
