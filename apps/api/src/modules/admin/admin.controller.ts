import { Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { OutboxStatus, Pagination, Uuid } from "@delicate/contracts";
import { accounts, auditLog, organizations, outboxMessages, wallets } from "@delicate/db";
import { PlatformRoles } from "../../auth/decorators.js";
import { AppError } from "../../common/errors.js";
import { Params, Query } from "../../common/zod.js";
import { AuditService } from "../../infra/audit.service.js";
import { DbService } from "../../infra/db.module.js";

const OutboxQuery = Pagination.extend({
  status: OutboxStatus.optional(),
});

/**
 * Ops/finance console endpoints. Read-mostly in Phase 0; the one mutation (outbox requeue) is
 * audited. Cursor pagination uses `createdAt` desc so lists stay stable under inserts.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin")
@PlatformRoles("super_admin", "finance", "dispatcher")
export class AdminController {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get("accounts")
  async accounts(@Query(Pagination) q: Pagination) {
    const { db } = this.dbs;
    const cursorDate = q.cursor ? new Date(q.cursor) : null;
    const rows = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        billingMode: accounts.billingMode,
        status: accounts.status,
        createdAt: accounts.createdAt,
        organizationName: organizations.name,
        // The balance belongs in the list. Ops asking "who is out of money" should not have
        // to open twenty accounts to find out.
        balanceCents: wallets.balanceCents,
        creditLimitCents: wallets.creditLimitCents,
      })
      .from(accounts)
      .leftJoin(organizations, eq(organizations.id, accounts.organizationId))
      .leftJoin(wallets, eq(wallets.accountId, accounts.id))
      .where(cursorDate ? lt(accounts.createdAt, cursorDate) : undefined)
      .orderBy(desc(accounts.createdAt))
      .limit(q.limit + 1);
    return page(rows, q.limit);
  }

  @Get("audit")
  @PlatformRoles("super_admin", "finance")
  async auditEntries(@Query(Pagination) q: Pagination) {
    const cursorDate = q.cursor ? new Date(q.cursor) : null;
    const rows = await this.dbs.db
      .select()
      .from(auditLog)
      .where(cursorDate ? lt(auditLog.createdAt, cursorDate) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(q.limit + 1);
    return page(rows, q.limit);
  }

  @Get("outbox")
  @PlatformRoles("super_admin")
  async outbox(@Query(OutboxQuery) q: z.infer<typeof OutboxQuery>) {
    const cursorDate = q.cursor ? new Date(q.cursor) : null;
    const rows = await this.dbs.db
      .select({
        id: outboxMessages.id,
        eventId: outboxMessages.eventId,
        eventType: outboxMessages.eventType,
        dedupeKey: outboxMessages.dedupeKey,
        status: outboxMessages.status,
        attempts: outboxMessages.attempts,
        nextAttemptAt: outboxMessages.nextAttemptAt,
        lastError: outboxMessages.lastError,
        deliveredAt: outboxMessages.deliveredAt,
        createdAt: outboxMessages.createdAt,
      })
      .from(outboxMessages)
      .where(
        and(
          q.status ? eq(outboxMessages.status, q.status) : undefined,
          cursorDate ? lt(outboxMessages.createdAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(outboxMessages.createdAt))
      .limit(q.limit + 1);
    return page(rows, q.limit);
  }

  @Get("outbox/stats")
  @PlatformRoles("super_admin")
  async outboxStats() {
    const rows = await this.dbs.db
      .select({ status: outboxMessages.status, count: sql<number>`count(*)::int` })
      .from(outboxMessages)
      .groupBy(outboxMessages.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  }

  /** Re-arm a dead or failed message for immediate redelivery. Audited. */
  @Post("outbox/:id/requeue")
  @PlatformRoles("super_admin")
  async requeue(@Params(z.object({ id: Uuid })) params: { id: string }) {
    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .update(outboxMessages)
        .set({ status: "pending", nextAttemptAt: new Date(), lockedBy: null, lockedAt: null })
        .where(
          and(
            eq(outboxMessages.id, params.id),
            or(inArray(outboxMessages.status, ["dead", "failed"])),
          ),
        )
        .returning({ id: outboxMessages.id, eventType: outboxMessages.eventType });
      if (!row) throw AppError.notFound("dead or failed outbox message");
      await this.audit.record(tx, {
        action: "outbox.requeue",
        entityType: "outbox_message",
        entityId: row.id,
        after: { status: "pending" },
      });
      return row;
    });
  }
}

function page<T extends { createdAt: Date }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? items[items.length - 1]!.createdAt.toISOString() : null;
  return { items, nextCursor };
}
