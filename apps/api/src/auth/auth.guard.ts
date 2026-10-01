import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AccountRole, PlatformRole, ServiceScope } from "@delicate/contracts";
import { AppError } from "../common/errors.js";
import { requestContext } from "../common/request-context.js";
import { TokenVerifier } from "./token-verifier.js";
import { PrincipalService } from "./principal.service.js";
import { ServiceClientVerifier } from "./service-client-verifier.js";
import { looksLikeServiceCredential } from "./service-credential.js";
import { ACCOUNT_HEADER, ACCOUNT_REF_HEADER, isStaff, type Principal } from "./principal.js";
import {
  ACCOUNT_ROLES_KEY,
  PLATFORM_ROLES_KEY,
  PUBLIC_KEY,
  REQUIRE_ACCOUNT_KEY,
  SCOPES_KEY,
} from "./decorators.js";

/**
 * One guard does authentication and authorisation so the rules are in a single place:
 *  1. @Public routes skip everything.
 *  2. A `dsk_` bearer is a service credential; anything else is a human's token.
 *  3. Humans: verify the token, JIT-provision the user, resolve X-Account-Id against membership.
 *     Services: verify the credential, resolve the named account against the grant list.
 *  4. Enforce @PlatformRoles / @AccountRoles / @RequireAccount / @Scopes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
    private readonly principals: PrincipalService,
    private readonly serviceClients: ServiceClientVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const token = extractBearer(req);
    if (!token) throw AppError.unauthorized("missing bearer token");

    const accountId = header(req, ACCOUNT_HEADER);
    const scopes = this.reflector.getAllAndOverride<ServiceScope[] | undefined>(
      SCOPES_KEY,
      targets,
    );

    const principal = looksLikeServiceCredential(token)
      ? await this.authenticateService(req, token, scopes, accountId)
      : await this.authenticateUser(token, accountId);

    req.principal = principal;
    requestContext.assign({
      userId: principal.user?.id,
      accountId: principal.account?.id,
      serviceClientId: principal.service?.id,
    });

    const platformRoles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(
      PLATFORM_ROLES_KEY,
      targets,
    );
    if (platformRoles?.length) {
      // Staff authority is a property of a person. A credential never has it, whatever it
      // was granted, so a service caller cannot reach an admin route at all.
      const role = principal.user?.platformRole;
      if (!role || !platformRoles.includes(role)) {
        throw AppError.forbidden("insufficient platform role", { required: platformRoles });
      }
    }

    const accountRoles = this.reflector.getAllAndOverride<AccountRole[] | undefined>(
      ACCOUNT_ROLES_KEY,
      targets,
    );
    const requireAccount =
      this.reflector.getAllAndOverride<boolean>(REQUIRE_ACCOUNT_KEY, targets) ||
      !!accountRoles ||
      !!scopes?.length;

    if (requireAccount) {
      if (!principal.account) {
        throw AppError.forbidden("an active account is required", { header: ACCOUNT_HEADER });
      }
      // A membership role is something only a person holds; a service caller passed the
      // grant check instead, which is the equivalent gate for a machine.
      if (accountRoles?.length && !isStaff(principal) && !principal.service) {
        if (!principal.account.role || !accountRoles.includes(principal.account.role)) {
          throw AppError.forbidden("insufficient account role", { required: accountRoles });
        }
      }
    }

    return true;
  }

  private async authenticateUser(token: string, accountId: string | null): Promise<Principal> {
    const verified = await this.verifier.verify(token);
    const user = await this.principals.resolveUser(verified);
    const principal: Principal = { user, service: null, account: null };
    if (accountId) principal.account = await this.principals.resolveAccount(user, accountId);
    return principal;
  }

  private async authenticateService(
    req: Request,
    token: string,
    scopes: ServiceScope[] | undefined,
    accountId: string | null,
  ): Promise<Principal> {
    const service = await this.serviceClients.verify(token);

    // Closed by default: a route that never named a scope was not written with machine
    // callers in mind, and letting one in because it happens to be unguarded is how an
    // integration quietly acquires authority nobody granted it.
    if (!scopes?.length) {
      throw AppError.forbidden("this endpoint is not open to service credentials");
    }
    const missing = scopes.filter((s) => !service.scopes.includes(s));
    if (missing.length) {
      throw AppError.forbidden("insufficient scope", { required: scopes, missing });
    }

    const account = await this.serviceClients.resolveAccount(service, {
      accountId,
      externalRef: header(req, ACCOUNT_REF_HEADER),
    });
    return { user: null, service, account };
  }
}

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}
