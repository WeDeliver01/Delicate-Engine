import type { AccountRole, PlatformRole, ServiceScope } from "@delicate/contracts";
import { AppError } from "../common/errors.js";

/**
 * Who is calling, resolved once per request by the AuthGuard and attached to `req.principal`.
 *
 * Exactly one of `user` and `service` is set:
 *
 * - `user` — a person, just-in-time provisioned from their token.
 * - `service` — another system holding a credential, acting for an account it was granted.
 *
 * `account` is present when the caller named one and may act on it. Staff (super_admin /
 * finance / dispatcher) may act on any account; their `accountRole` is null, and so is a
 * service caller's, which holds its authority through the grant rather than a membership.
 */
export interface ServicePrincipal {
  id: string;
  slug: string;
  name: string;
  scopes: ServiceScope[];
}

export interface Principal {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    platformRole: PlatformRole | null;
  } | null;
  service: ServicePrincipal | null;
  account: {
    id: string;
    role: AccountRole | null;
    /**
     * True when a staff member named an account they do not belong to. The request proceeds —
     * that is the point of the capability — but everything it writes is marked, and the portal
     * says so on screen rather than letting someone forget whose account they are in.
     */
    impersonating: boolean;
  } | null;
}

/** The person behind a request, on the many paths that only ever run for one. */
export type AuthenticatedUser = NonNullable<Principal["user"]>;

export const ACCOUNT_HEADER = "x-account-id";
/** The caller's own identifier for the account, resolved through `account_external_refs`. */
export const ACCOUNT_REF_HEADER = "x-account-ref";

export function isStaff(p: Principal): boolean {
  return (
    p.user?.platformRole === "super_admin" ||
    p.user?.platformRole === "finance" ||
    p.user?.platformRole === "dispatcher"
  );
}

/**
 * The human behind a request, on a route that has one.
 *
 * Service credentials are refused on any route that does not declare `@Scopes(...)`, so these
 * routes never see one — this makes that guarantee explicit instead of implied by a cast.
 */
export function requireUser(p: Principal): AuthenticatedUser {
  if (!p.user) throw AppError.forbidden("this endpoint is for people, not service credentials");
  return p.user;
}
