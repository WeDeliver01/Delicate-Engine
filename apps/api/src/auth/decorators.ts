import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AccountRole, PlatformRole } from "@delicate/contracts";
import type { Principal } from "./principal.js";

export const PUBLIC_KEY = "auth:public";
export const PLATFORM_ROLES_KEY = "auth:platformRoles";
export const ACCOUNT_ROLES_KEY = "auth:accountRoles";
export const REQUIRE_ACCOUNT_KEY = "auth:requireAccount";

/** Route needs no token (health, webhooks with their own signature checks). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Caller must hold one of these platform (staff) roles. */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);

/**
 * Caller must have an active account (X-Account-Id) on which they hold one of these roles.
 * Staff pass regardless of membership. With no roles listed, any membership is enough.
 */
export const AccountRoles = (...roles: AccountRole[]) => SetMetadata(ACCOUNT_ROLES_KEY, roles);

/** Caller must have an active account; role unconstrained. */
export const RequireAccount = () => SetMetadata(REQUIRE_ACCOUNT_KEY, true);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
  return req.principal;
});

/** The active account id; only valid on routes guarded by @RequireAccount / @AccountRoles. */
export const ActiveAccountId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
  return req.principal?.account?.id;
});
