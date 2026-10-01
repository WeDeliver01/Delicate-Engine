import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AccountRole, PlatformRole, ServiceScope } from "@delicate/contracts";
import type { Principal } from "./principal.js";

export const PUBLIC_KEY = "auth:public";
export const PLATFORM_ROLES_KEY = "auth:platformRoles";
export const ACCOUNT_ROLES_KEY = "auth:accountRoles";
export const REQUIRE_ACCOUNT_KEY = "auth:requireAccount";
export const SCOPES_KEY = "auth:scopes";

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

/**
 * Opens a route to service credentials holding every one of these scopes.
 *
 * This is the only way a machine caller reaches anything: a route without `@Scopes` refuses
 * service credentials outright. New endpoints are therefore closed to integrations until
 * somebody decides otherwise, rather than open until somebody notices.
 */
export const Scopes = (...scopes: ServiceScope[]) => SetMetadata(SCOPES_KEY, scopes);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
  return req.principal;
});

/** The active account id; only valid on routes guarded by @RequireAccount / @AccountRoles. */
export const ActiveAccountId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
  return req.principal?.account?.id;
});
