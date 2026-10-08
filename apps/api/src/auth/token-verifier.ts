import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";
import { ENV, type Env } from "../config/env.js";
import { AppError } from "../common/errors.js";

export const DEV_ISSUER = "delicate-dev";
const SUPABASE_AUDIENCE = "authenticated";

export interface VerifiedToken {
  userId: string;
  email: string | null;
  /** From the provider's profile, when it gives us one. See `displayName`. */
  fullName: string | null;
  issuer: "supabase" | "dev";
  claims: JWTPayload;
}

/**
 * Verifies bearer tokens from two issuers:
 *  - Supabase Auth (production identity): HS256 against the project's legacy shared secret,
 *    anything else against its published JWKS. Both are kept available at once, because a
 *    project migrating to asymmetric keys issues tokens of both kinds for a while.
 *  - Dev issuer (never in production): HS256 with AUTH_DEV_SECRET so local development and
 *    integration tests do not need a Supabase project.
 */
@Injectable()
export class TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;
  private readonly supabaseSecret: Uint8Array | null;
  private readonly devSecret: Uint8Array | null;
  private readonly supabaseIssuer: string | null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TokenVerifier.name);
    this.supabaseIssuer = env.SUPABASE_URL
      ? `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`
      : null;
    this.supabaseSecret = env.SUPABASE_JWT_SECRET
      ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
      : null;
    // Always available when we know the project, even alongside a shared secret. Supabase can
    // sign with the legacy HS256 secret today and with an asymmetric key after the project
    // migrates — and during that migration it issues both. Treating them as either/or means
    // configuring the secret silently stops asymmetric tokens working, which is a confusing
    // way to lose every login.
    this.jwks = this.supabaseIssuer
      ? createRemoteJWKSet(new URL(`${this.supabaseIssuer}/.well-known/jwks.json`))
      : null;
    this.devSecret =
      env.NODE_ENV !== "production" && env.AUTH_DEV_SECRET
        ? new TextEncoder().encode(env.AUTH_DEV_SECRET)
        : null;
  }

  async verify(token: string): Promise<VerifiedToken> {
    let header;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw AppError.unauthorized("malformed token");
    }

    const unverifiedIssuer = peekIssuer(token);

    try {
      if (unverifiedIssuer === DEV_ISSUER && this.devSecret) {
        const { payload } = await jwtVerify(token, this.devSecret, { issuer: DEV_ISSUER });
        return toVerified(payload, "dev");
      }

      if (this.supabaseIssuer) {
        const options = { issuer: this.supabaseIssuer, audience: SUPABASE_AUDIENCE };
        // HS256 can only be the shared secret; anything else is signed with a published key.
        if (header.alg === "HS256") {
          if (!this.supabaseSecret) {
            throw AppError.unauthorized(
              "this project signs tokens with its legacy JWT secret; set SUPABASE_JWT_SECRET",
            );
          }
          const { payload } = await jwtVerify(token, this.supabaseSecret, options);
          return toVerified(payload, "supabase");
        }
        if (this.jwks) {
          const { payload } = await jwtVerify(token, this.jwks, options);
          return toVerified(payload, "supabase");
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // The caller gets a deliberately vague message — a rejected token should not explain
      // itself to whoever sent it. The operator gets the real reason, because "invalid or
      // expired" is useless when the actual cause is a signing algorithm nobody configured.
      this.logger.warn(
        {
          reason: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string }).code,
          alg: header.alg,
          tokenIssuer: unverifiedIssuer,
          expectedIssuer: this.supabaseIssuer,
          verifying: this.supabaseSecret ? "shared secret (HS256)" : this.jwks ? "JWKS" : "nothing",
        },
        "rejected a bearer token",
      );
      throw AppError.unauthorized("invalid or expired token");
    }

    // Nothing could even attempt it: usually a token signed with an algorithm we are not set
    // up for, which is a configuration problem rather than a bad token.
    this.logger.warn(
      {
        alg: header.alg,
        tokenIssuer: unverifiedIssuer,
        expectedIssuer: this.supabaseIssuer,
        hasSharedSecret: Boolean(this.supabaseSecret),
        hasJwks: Boolean(this.jwks),
      },
      "no verifier configured for this token",
    );
    throw AppError.unauthorized("no verifier configured for this token");
  }

  /** Dev-only helper used by `dev:token` and tests. */
  async signDevToken(input: {
    userId: string;
    email: string;
    fullName?: string;
    ttlSeconds?: number;
  }): Promise<string> {
    if (!this.devSecret) throw new Error("AUTH_DEV_SECRET is not configured");
    return new SignJWT({
      email: input.email,
      role: SUPABASE_AUDIENCE,
      // Shaped like Supabase's, so what the dev issuer mints exercises the same claim path
      // a real token does rather than a simplified one that proves nothing.
      ...(input.fullName ? { user_metadata: { full_name: input.fullName } } : {}),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(DEV_ISSUER)
      .setSubject(input.userId)
      .setIssuedAt()
      .setExpirationTime(`${input.ttlSeconds ?? 60 * 60 * 12}s`)
      .sign(this.devSecret);
  }
}

function toVerified(payload: JWTPayload, issuer: VerifiedToken["issuer"]): VerifiedToken {
  if (!payload.sub) throw AppError.unauthorized("token has no subject");
  const email = typeof payload["email"] === "string" ? payload["email"] : null;
  return { userId: payload.sub, email, fullName: displayName(payload), issuer, claims: payload };
}

/**
 * The name the identity provider knows them by.
 *
 * Supabase puts it in `user_metadata`: Google fills in `name` and `full_name` from the Google
 * profile, and our own sign-up form passes `full_name` through `signUp`. Taking it here is the
 * difference between a portal that greets someone by name and one that shows their email
 * address on every page because nobody ever asked.
 */
function displayName(payload: JWTPayload): string | null {
  const meta = payload["user_metadata"];
  if (!meta || typeof meta !== "object") return null;
  for (const key of ["full_name", "name"] as const) {
    const value = (meta as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  return null;
}

function peekIssuer(token: string): string | undefined {
  try {
    const [, body] = token.split(".");
    if (!body) return undefined;
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { iss?: string };
    return json.iss;
  } catch {
    return undefined;
  }
}
