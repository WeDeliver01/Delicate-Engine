import "reflect-metadata";

/**
 * Integration tests run against a real Postgres (TEST_DATABASE_URL, provided by
 * `docker compose up postgres`). They never touch the dev database.
 */
process.env["NODE_ENV"] = "test";
process.env["AUTH_DEV_SECRET"] ??= "test-secret-test-secret-test-secret-12345";
process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ?? "postgres://delicate:delicate@localhost:5433/delicate_test";
delete process.env["SUPABASE_URL"];
delete process.env["SUPABASE_JWT_SECRET"];
