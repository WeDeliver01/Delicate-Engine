import { describe, expect, it } from "vitest";
import {
  REFRESH_SKEW_MS,
  canRefresh,
  hostOf,
  needsRefresh,
  parseStored,
  signInMessage,
  toSession,
  type Session,
} from "./session";

const NOW = 1_800_000_000_000;
const session = (over: Partial<Session> = {}): Session => ({
  accessToken: "header.payload.signature",
  refreshToken: "r-123",
  expiresAt: NOW + 3_600_000,
  ...over,
});

describe("reading a token response", () => {
  it("takes the tokens and works out when they die", () => {
    const out = toSession({ access_token: "a", refresh_token: "r", expires_in: 3600 }, NOW);
    expect(out).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: NOW + 3_600_000 });
  });

  it("assumes an hour when no expiry is given, rather than forever", () => {
    const out = toSession({ access_token: "a", refresh_token: "r" }, NOW);
    expect(out!.expiresAt).toBe(NOW + 3_600_000);
  });

  it("refuses a response that is not a session", () => {
    // A 200 from the wrong endpoint must not become a session that fails every later call
    // with no explanation.
    expect(toSession(null, NOW)).toBeNull();
    expect(toSession({}, NOW)).toBeNull();
    expect(toSession({ access_token: "a" }, NOW)).toBeNull();
    expect(toSession({ refresh_token: "r" }, NOW)).toBeNull();
    expect(toSession({ access_token: "", refresh_token: "r" }, NOW)).toBeNull();
    expect(toSession("not an object", NOW)).toBeNull();
  });
});

describe("deciding when to refresh", () => {
  it("leaves a fresh token alone", () => {
    expect(needsRefresh(session(), NOW)).toBe(false);
  });

  it("refreshes before the token actually dies, not after", () => {
    // The failure this prevents: a request that starts valid and lands expired, on a bad
    // signal at the back of an estate, marking a parcel delivered against a dead token.
    const expiring = session({ expiresAt: NOW + REFRESH_SKEW_MS - 1 });
    expect(needsRefresh(expiring, NOW)).toBe(true);
    const safe = session({ expiresAt: NOW + REFRESH_SKEW_MS + 1 });
    expect(needsRefresh(safe, NOW)).toBe(false);
  });

  it("refreshes one that is already gone", () => {
    expect(needsRefresh(session({ expiresAt: NOW - 1 }), NOW)).toBe(true);
  });

  it("knows what cannot be refreshed", () => {
    expect(canRefresh(null)).toBe(false);
    expect(canRefresh(session({ refreshToken: "" }))).toBe(false);
    expect(canRefresh(session())).toBe(true);
  });
});

describe("reading a stored session", () => {
  it("round-trips", () => {
    expect(parseStored(JSON.stringify(session()))).toEqual(session());
  });

  it("rejects nothing, rubbish and half a session", () => {
    expect(parseStored(null)).toBeNull();
    expect(parseStored("")).toBeNull();
    expect(parseStored("{}")).toBeNull();
    expect(parseStored(JSON.stringify({ accessToken: "a" }))).toBeNull();
    expect(parseStored(JSON.stringify({ accessToken: "a", refreshToken: "r" }))).toBeNull();
  });

  it("keeps a driver signed in across the upgrade that introduced sessions", () => {
    // Before this, the keystore held a bare pasted JWT. Treating that as rubbish would sign
    // every driver out the moment they updated, mid-shift.
    const bare = "header.payload.signature";
    const out = parseStored(bare);
    expect(out).toMatchObject({ accessToken: bare, refreshToken: "" });
    expect(needsRefresh(out!, NOW)).toBe(false);
    expect(canRefresh(out)).toBe(false);
  });

  it("does not mistake a stray word for a token", () => {
    expect(parseStored("hello")).toBeNull();
  });
});

describe("what a driver is told when sign-in fails", () => {
  it("says what to do, not what the API said", () => {
    expect(signInMessage(400, { error_description: "Invalid login credentials" })).toContain(
      "do not match",
    );
    expect(signInMessage(429, {})).toContain("Wait a minute");
    expect(signInMessage(503, {})).toContain("Try again shortly");
  });

  it("singles out an unconfirmed account, which no amount of retyping fixes", () => {
    expect(signInMessage(400, { error_description: "Email not confirmed" })).toContain(
      "not been confirmed",
    );
  });
});

describe("naming the host that could not be reached", () => {
  it("takes the host out of a URL", () => {
    expect(hostOf("https://abcd.supabase.co")).toBe("abcd.supabase.co");
    expect(hostOf("https://abcd.supabase.co/auth/v1")).toBe("abcd.supabase.co");
    expect(hostOf("http://10.0.2.2:8080/api")).toBe("10.0.2.2:8080");
  });

  it("shows a mangled value rather than hiding it", () => {
    // This is the case it exists for: a build that went out with a placeholder in it.
    expect(hostOf("https://xxxxxxxxxxxx.supabase.co")).toBe("xxxxxxxxxxxx.supabase.co");
    expect(hostOf("not a url")).toBe("not a url");
    expect(hostOf("")).toBe("");
  });
});
