import "reflect-metadata";
import { SignJWT } from "jose";
import { loadEnv } from "../config/env.js";
import { DEV_ISSUER } from "../auth/token-verifier.js";

/**
 * Mint a dev bearer token for local development / manual API calls.
 *
 *   pnpm --filter @delicate/api run dev:token                # super admin (seed user)
 *   pnpm --filter @delicate/api run dev:token owner          # seed customer owner
 *   pnpm --filter @delicate/api run dev:token <uuid> <email> # any identity
 */
const SEED_USERS: Record<string, { id: string; email: string }> = {
  admin: { id: "00000000-0000-4000-8000-000000000001", email: "admin@delicatecourier.local" },
  dispatch: { id: "00000000-0000-4000-8000-000000000002", email: "dispatch@delicatecourier.local" },
  finance: { id: "00000000-0000-4000-8000-000000000003", email: "finance@delicatecourier.local" },
  owner: { id: "00000000-0000-4000-8000-000000000010", email: "owner@honeybee.local" },
  staff: { id: "00000000-0000-4000-8000-000000000011", email: "staff@honeybee.local" },
};

async function main() {
  const env = loadEnv();
  if (env.NODE_ENV === "production" || !env.AUTH_DEV_SECRET) {
    throw new Error("dev tokens require AUTH_DEV_SECRET and a non-production NODE_ENV");
  }
  const [who = "admin", emailArg] = process.argv.slice(2);
  const identity = SEED_USERS[who] ?? { id: who, email: emailArg ?? `${who}@dev.local` };

  const token = await new SignJWT({ email: identity.email, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(DEV_ISSUER)
    .setSubject(identity.id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(env.AUTH_DEV_SECRET));

  console.log(token);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
