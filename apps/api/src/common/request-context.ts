import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Per-request context available anywhere on the call stack without threading it through
 * every signature. Auth populates `userId` (or `serviceClientId`) and `accountId` after
 * verification; the audit and outbox services read them so every write is attributed
 * automatically, whoever made it.
 */
export interface RequestContext {
  requestId: string;
  ip?: string;
  userId?: string;
  accountId?: string;
  /** Set instead of `userId` when another system is calling. */
  serviceClientId?: string;
}

class RequestContextStore {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  run<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  get(): RequestContext | undefined {
    return this.als.getStore();
  }

  /** Mutate the current context in place (e.g. once the user is known). */
  assign(patch: Partial<RequestContext>): void {
    const store = this.als.getStore();
    if (store) Object.assign(store, patch);
  }
}

export const requestContext = new RequestContextStore();

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader("x-request-id", requestId);
  requestContext.run({ requestId, ip: req.ip }, () => next());
}
