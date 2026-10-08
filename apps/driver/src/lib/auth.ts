import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import {
  canRefresh,
  hostOf,
  needsRefresh,
  parseStored,
  signInMessage,
  toSession,
  type Session,
} from "./session";

const KEY = "delicate.driver.session";

/**
 * Who the driver is.
 *
 * Sign-in is Supabase email and password, the same identity the office uses, exchanged for the
 * bearer token the engine verifies. Nothing about this is particular to drivers — the engine
 * links the signed-in user to a driver row by email on first contact.
 *
 * The session lives in the device keychain/keystore, never in plain storage, and is renewed
 * before it expires. That renewal is the whole reason this file is more than two functions:
 * a Supabase access token lasts about an hour and a shift lasts five, so without it a driver
 * is signed out somewhere around the fourth delivery.
 */

export const SUPABASE_URL: string =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (Constants.expoConfig?.extra as { supabaseUrl?: string } | undefined)?.supabaseUrl ??
  "";

export const SUPABASE_ANON_KEY: string =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  (Constants.expoConfig?.extra as { supabaseAnonKey?: string } | undefined)?.supabaseAnonKey ??
  "";

/** Whether this build was given an identity provider at all. */
export function canSignInWithPassword(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

export class SignInError extends Error {}

// ── storage ───────────────────────────────────────────────────────────────────

async function read(): Promise<Session | null> {
  try {
    return parseStored(await SecureStore.getItemAsync(KEY));
  } catch {
    // Keychain unavailable (a reset simulator, a locked device at boot). Treated as signed
    // out, which asks for a password rather than failing every request with a silent 401.
    return null;
  }
}

async function write(session: Session | null): Promise<void> {
  try {
    if (session) await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* keychain unavailable — the driver signs in again */
  }
}

// ── the token the engine sees ─────────────────────────────────────────────────

/**
 * One refresh at a time.
 *
 * The day screen fires several requests at once on every focus. Without this each one would
 * notice the expiry, and they would race: Supabase rotates the refresh token on use, so the
 * second request would present one that had just been spent and be refused — signing out a
 * driver who was doing nothing wrong.
 */
let inFlight: Promise<Session | null> | null = null;

export async function getToken(): Promise<string | null> {
  const session = await read();
  if (!session) return null;
  if (!needsRefresh(session, Date.now())) return session.accessToken;
  if (!canRefresh(session)) {
    // A hand-pasted token from before sessions existed. Nothing to renew it with, so it is
    // used until the engine rejects it.
    return session.accessToken;
  }
  const renewed = await (inFlight ??= refresh(session).finally(() => {
    inFlight = null;
  }));
  return renewed?.accessToken ?? null;
}

async function refresh(session: Session): Promise<Session | null> {
  if (!canSignInWithPassword()) return session;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      // The refresh token is spent or revoked: this session is over and no retry fixes it.
      await write(null);
      return null;
    }
    const next = toSession(body, Date.now());
    if (!next) return session;
    await write(next);
    return next;
  } catch {
    // No signal. Keep what we have — the driver is mid-round, and the engine refusing one
    // request is far better than being signed out at the side of a road.
    return session;
  }
}

// ── signing in and out ────────────────────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<void> {
  if (!canSignInWithPassword()) {
    throw new SignInError(
      "This build has no sign-in configured. It was built without EXPO_PUBLIC_SUPABASE_URL.",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
  } catch {
    // Name the host. "Check your signal" sends someone to look at their phone when the real
    // answer is usually that the build went out pointing at an address that does not exist,
    // and nothing about the phone will ever fix that.
    throw new SignInError(
      `Cannot reach ${hostOf(SUPABASE_URL)}. Check your signal — and if it keeps failing, tell the office: this build may have the wrong sign-in address.`,
    );
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new SignInError(signInMessage(res.status, body));

  const session = toSession(body, Date.now());
  if (!session) throw new SignInError("Sign-in returned something unexpected. Tell the office.");
  await write(session);
}

/** Used by the dev-token path and by anything that needs to drop the session. */
export async function setToken(token: string | null): Promise<void> {
  if (!token) return write(null);
  await write({ accessToken: token, refreshToken: "", expiresAt: Number.POSITIVE_INFINITY });
}

export async function signOut(): Promise<void> {
  await write(null);
}

export async function isSignedIn(): Promise<boolean> {
  return (await read()) !== null;
}
