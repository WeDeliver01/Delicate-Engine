import { z } from "zod";

/**
 * Every environment variable the API/worker reads, validated once at boot. A missing or
 * malformed value fails fast with a readable message instead of surfacing as a runtime bug.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    DATABASE_URL: z.string().url(),

    API_PORT: z.coerce.number().int().positive().default(8080),
    API_PUBLIC_URL: z.string().url().default("http://localhost:8080"),
    WEB_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_JWT_SECRET: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    /** Dev-only: lets `dev:token` mint local JWTs without a Supabase project. */
    AUTH_DEV_SECRET: z.string().min(32).optional(),

    /** Google Maps Platform (Places API New + Routes API). Unset = free fallback provider. */
    GOOGLE_MAPS_API_KEY: z.string().min(10).optional(),

    /** Worker tuning */
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(25),
    WORKER_ID: z.string().default(() => `worker-${process.pid}`),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (!env.SUPABASE_URL) {
        ctx.addIssue({ code: "custom", path: ["SUPABASE_URL"], message: "required in production" });
      }
      if (env.AUTH_DEV_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_DEV_SECRET"],
          message: "must not be set in production",
        });
      }
    } else if (!env.SUPABASE_URL && !env.AUTH_DEV_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_DEV_SECRET"],
        message: "set SUPABASE_URL or AUTH_DEV_SECRET so tokens can be verified",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` in a .env file means "not set", not "empty string".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

export const ENV = Symbol("ENV");
