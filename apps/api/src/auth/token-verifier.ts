import { Inject, Injectable } from "@nestjs/common";
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
  issuer: "supabase" | "dev";
  claims: JWTPayload;
}

/**
 * Verifies bearer tokens from two issuers:
 *  - Supabase Auth (production identity): HS256 with the project JWT secret when configured,
 *    otherwise the project's JWKS (newer projects sign with asymmetric keys).
 *  - Dev issuer (never in production): HS256 with AUTH_DEV_SECRET so local development and
 *    integration tests do not need a Supabase project.
 */
@Injectable()
export class TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;
  private readonly supabaseSecret: Uint8Array | null;
  private readonly devSecret: Uint8Array | null;
  private readonly supabaseIssuer: string | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.supabaseIssuer = env.SUPABASE_URL
      ? `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`
      : null;
    this.supabaseSecret = env.SUPABASE_JWT_SECRET
      ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
      : null;
    this.jwks =
      this.supabaseIssuer && !this.supabaseSecret
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
        if (this.supabaseSecret && header.alg === "HS256") {
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
      throw AppError.unauthorized("invalid or expired token");
    }

    throw AppError.unauthorized("no verifier configured for this token");
  }

  /** Dev-only helper used by `dev:token` and tests. */
  async signDevToken(input: {
    userId: string;
    email: string;
    ttlSeconds?: number;
  }): Promise<string> {
    if (!this.devSecret) throw new Error("AUTH_DEV_SECRET is not configured");
    return new SignJWT({ email: input.email, role: SUPABASE_AUDIENCE })
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
  return { userId: payload.sub, email, issuer, claims: payload };
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
