import { Injectable } from "@nestjs/common";
import { auditLog, type DbExecutor } from "@delicate/db";
import { requestContext } from "../common/request-context.js";

export interface AuditEntry {
  action: string; // e.g. "account.create", "membership.revoke"
  entityType: string; // e.g. "account"
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Append-only audit log (invariant #10). Written with the caller's transaction so a rolled-back
 * change never leaves a phantom audit row. Actor and request id come from the request context;
 * the actor is a user or a service client, never both.
 */
@Injectable()
export class AuditService {
  async record(tx: DbExecutor, entry: AuditEntry): Promise<void> {
    const ctx = requestContext.get();
    await tx.insert(auditLog).values({
      actorUserId: ctx?.userId ?? null,
      actorServiceClientId: ctx?.serviceClientId ?? null,
      actorAccountId: ctx?.accountId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
    });
  }
}
