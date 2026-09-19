import type { AccountRole, PlatformRole } from "@delicate/contracts";

/**
 * Who is calling, resolved once per request by the AuthGuard and attached to `req.principal`.
 *
 * - `user` is always present on authenticated routes (just-in-time provisioned from the token).
 * - `account` is present when the client sent `X-Account-Id` and the user may act on it. Staff
 *   (super_admin / finance / dispatcher) may act on any account; their `accountRole` is null.
 */
export interface Principal {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    platformRole: PlatformRole | null;
  };
  account: {
    id: string;
    role: AccountRole | null;
  } | null;
}

export const ACCOUNT_HEADER = "x-account-id";

export function isStaff(p: Principal): boolean {
  return (
    p.user.platformRole === "super_admin" ||
    p.user.platformRole === "finance" ||
    p.user.platformRole === "dispatcher"
  );
}
