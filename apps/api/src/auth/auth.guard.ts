import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AccountRole, PlatformRole } from "@delicate/contracts";
import { AppError } from "../common/errors.js";
import { requestContext } from "../common/request-context.js";
import { TokenVerifier } from "./token-verifier.js";
import { PrincipalService } from "./principal.service.js";
import { ACCOUNT_HEADER, isStaff, type Principal } from "./principal.js";
import {
  ACCOUNT_ROLES_KEY,
  PLATFORM_ROLES_KEY,
  PUBLIC_KEY,
  REQUIRE_ACCOUNT_KEY,
} from "./decorators.js";

/**
 * One guard does authentication and authorisation so the rules are in a single place:
 *  1. @Public routes skip everything.
 *  2. Verify the bearer token; JIT-provision the user row; load platform role.
 *  3. If X-Account-Id is present, resolve the caller's role on it (staff bypass membership).
 *  4. Enforce @PlatformRoles / @AccountRoles / @RequireAccount.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
    private readonly principals: PrincipalService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const token = extractBearer(req);
    if (!token) throw AppError.unauthorized("missing bearer token");

    const verified = await this.verifier.verify(token);
    const user = await this.principals.resolveUser(verified);

    const accountHeader = req.headers[ACCOUNT_HEADER];
    const accountId =
      typeof accountHeader === "string" && accountHeader.length > 0 ? accountHeader : null;

    const principal: Principal = { user, account: null };
    if (accountId) {
      principal.account = await this.principals.resolveAccount(user, accountId);
    }
    req.principal = principal;
    requestContext.assign({ userId: user.id, accountId: principal.account?.id });

    const platformRoles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(
      PLATFORM_ROLES_KEY,
      targets,
    );
    if (platformRoles?.length) {
      if (!user.platformRole || !platformRoles.includes(user.platformRole)) {
        throw AppError.forbidden("insufficient platform role", { required: platformRoles });
      }
    }

    const accountRoles = this.reflector.getAllAndOverride<AccountRole[] | undefined>(
      ACCOUNT_ROLES_KEY,
      targets,
    );
    const requireAccount =
      this.reflector.getAllAndOverride<boolean>(REQUIRE_ACCOUNT_KEY, targets) || !!accountRoles;

    if (requireAccount) {
      if (!principal.account) {
        throw AppError.forbidden("an active account is required", { header: ACCOUNT_HEADER });
      }
      if (accountRoles?.length && !isStaff(principal)) {
        if (!principal.account.role || !accountRoles.includes(principal.account.role)) {
          throw AppError.forbidden("insufficient account role", { required: accountRoles });
        }
      }
    }

    return true;
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}
