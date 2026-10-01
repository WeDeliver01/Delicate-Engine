import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The service credential format: `dsk_<keyId>_<secret>`.
 *
 * `dsk` makes it recognisable in a log or a leaked file (and lets the guard tell a credential
 * from a JWT without parsing one as the other). `keyId` is the public half we look the row up
 * by; `secret` is 256 bits of randomness we only ever keep a hash of.
 *
 * The secret is random rather than chosen, so a plain SHA-256 is the right hash: there is no
 * password to brute-force, and a slow KDF on a credential checked on every request would cost
 * real latency for no security.
 */

export const CREDENTIAL_PREFIX = "dsk_";

export interface ParsedCredential {
  keyId: string;
  secret: string;
}

export interface GeneratedCredential extends ParsedCredential {
  /** The whole thing, shown to the operator once. */
  token: string;
  secretHash: string;
  secretHint: string;
}

export function looksLikeServiceCredential(token: string): boolean {
  return token.startsWith(CREDENTIAL_PREFIX);
}

export function generateCredential(): GeneratedCredential {
  const keyId = randomBytes(8).toString("hex"); // 16 chars
  const secret = randomBytes(32).toString("base64url"); // 43 chars
  return {
    keyId,
    secret,
    token: `${CREDENTIAL_PREFIX}${keyId}_${secret}`,
    secretHash: hashSecret(secret),
    secretHint: secret.slice(-4),
  };
}

/** Never throws: anything that is not a well-formed credential is simply not one. */
export function parseCredential(token: string): ParsedCredential | null {
  if (!looksLikeServiceCredential(token)) return null;
  const rest = token.slice(CREDENTIAL_PREFIX.length);
  const separator = rest.indexOf("_");
  if (separator <= 0) return null;
  const keyId = rest.slice(0, separator);
  const secret = rest.slice(separator + 1);
  if (!/^[0-9a-f]{16}$/.test(keyId) || secret.length < 32 || secret.length > 128) return null;
  return { keyId, secret };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), "hex");
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
