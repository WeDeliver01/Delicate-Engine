/**
 * What a signed-in driver's session is, and when it needs renewing.
 *
 * Pure on purpose, and in its own file with no native imports, so the one piece of this that
 * silently ruins a driver's day — deciding the token is still good when it is not — can be
 * tested rather than discovered at eleven on a Tuesday with a van full of parcels.
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * Supabase's token response. Only the fields we rely on; it sends more.
 * `expires_in` is seconds, and is what every GoTrue response carries.
 */
export interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

/**
 * Renew this long before the token actually dies.
 *
 * A request that starts valid and lands expired is the failure this avoids: the phone is on a
 * bad signal at the back of an estate, the POST takes twenty seconds, and the parcel is marked
 * delivered against a token that died in flight. Sixty seconds covers that with room to spare,
 * and costs nothing — a refresh is one small request.
 */
export const REFRESH_SKEW_MS = 60_000;

/**
 * Turn a token response into a session, or null if it is not one.
 *
 * Returns null rather than throwing, and rather than trusting: a 200 from the wrong endpoint,
 * or a body with the fields missing, must not become a session that fails on every later call
 * with no explanation.
 */
export function toSession(body: unknown, now: number): Session | null {
  if (!body || typeof body !== "object") return null;
  const {
    access_token: access,
    refresh_token: refresh,
    expires_in: expires,
  } = body as TokenResponse;
  if (typeof access !== "string" || access.length === 0) return null;
  if (typeof refresh !== "string" || refresh.length === 0) return null;
  // A response without an expiry is treated as an hour, Supabase's own default. Better a
  // slightly early refresh than a session we believe is immortal.
  const seconds = typeof expires === "number" && expires > 0 ? expires : 3600;
  return { accessToken: access, refreshToken: refresh, expiresAt: now + seconds * 1000 };
}

/** Whether the access token should be renewed before being used again. */
export function needsRefresh(session: Session, now: number): boolean {
  return now >= session.expiresAt - REFRESH_SKEW_MS;
}

/**
 * Whether a stored session is worth trying to refresh at all.
 *
 * A refresh token outlives its access token by a long way, so an expired access token is
 * normal and recoverable. What is not recoverable is a session with nothing to refresh with.
 *
 * Deliberately a plain predicate rather than a type guard: it answers "does this have a
 * refresh token", not "is this a session", and as a guard it would narrow an already-known
 * Session to `never` on the false branch.
 */
export function canRefresh(session: Session | null): boolean {
  return !!session && session.refreshToken.length > 0;
}

/** Read a stored session back, rejecting anything that is not one. */
export function parseStored(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Session>;
    if (typeof value.accessToken !== "string" || value.accessToken.length === 0) return null;
    if (typeof value.refreshToken !== "string") return null;
    if (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return null;
    return {
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      expiresAt: value.expiresAt,
    };
  } catch {
    // Not JSON. Most likely a token pasted by hand before this app had sessions, which has no
    // refresh token and no expiry — treat it as a session that works until the engine says
    // otherwise, so an upgrade does not sign a driver out mid-shift.
    return raw.includes(".")
      ? { accessToken: raw, refreshToken: "", expiresAt: Number.POSITIVE_INFINITY }
      : null;
  }
}

/**
 * What to tell a driver when sign-in fails.
 *
 * Supabase's own messages are written for developers. A driver at a depot gate needs to know
 * whether to try again, retype something, or phone the office.
 */
export function signInMessage(status: number, body: unknown): string {
  const described = (body as { error_description?: unknown; msg?: unknown } | null) ?? null;
  const raw =
    typeof described?.error_description === "string"
      ? described.error_description
      : typeof described?.msg === "string"
        ? described.msg
        : "";
  if (status === 400 || status === 401) {
    return /email not confirmed/i.test(raw)
      ? "That account has not been confirmed yet. Ask the office to confirm it."
      : "That email and password do not match. Check them and try again.";
  }
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  if (status >= 500)
    return "Sign-in is down. Try again shortly, and tell the office if it continues.";
  return raw || "Could not sign in. Try again.";
}

/**
 * The host part of a URL, for telling someone which address could not be reached.
 *
 * A regex rather than `new URL`, which is not dependable on Hermes. Returns the input
 * unchanged when it does not look like a URL at all, because a mangled value is exactly what
 * this is most useful for showing.
 */
export function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  return match?.[1] ?? url.trim();
}
