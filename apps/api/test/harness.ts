import type { NestExpressApplication } from "@nestjs/platform-express";
import { sql } from "drizzle-orm";
import request from "supertest";
import { runMigrations, seedCatalog } from "@delicate/db";
import { createHttpApp } from "../src/bootstrap.js";
import { TokenVerifier } from "../src/auth/token-verifier.js";
import { DbService } from "../src/infra/db.module.js";
import { SettingsService } from "../src/infra/settings.service.js";
import { OutboxDispatcher } from "../src/worker/outbox-dispatcher.js";

export interface Harness {
  app: NestExpressApplication;
  db: DbService;
  dispatcher: OutboxDispatcher;
  http: () => request.Agent;
  tokenFor: (user: { id: string; email: string }) => Promise<string>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

const TRUNCATE = [
  "trip_stops",
  "trips",
  "window_bands",
  "geocoded_addresses",
  "route_legs",
  "geo_usage_daily",
  "loyalty_awards",
  "saved_addresses",
  "notifications",
  "notification_preferences",
  "notification_templates",
  "invoice_payments",
  "invoice_lines",
  "invoices",
  "invoice_counters",
  "payment_proposals",
  "payment_counters",
  "allocation_transactions",
  "allocation_wallets",
  "journal_lines",
  "journals",
  "settlements",
  "settlement_forecasts",
  "proofs_of_delivery",
  "assignments",
  "fuel_logs",
  "driver_location_history",
  "driver_positions",
  "shifts",
  "drivers",
  "vehicles",
  "files",
  "shipment_events",
  "shipments",
  "bookings",
  "waybill_counters",
  "delivery_slots",
  "blackout_dates",
  "top_ups",
  "wallet_holds",
  "wallet_entries",
  "wallets",
  "quotes",
  "account_rate_cards",
  "rate_cards",
  "service_levels",
  "package_types",
  "settings",
  "account_external_refs",
  "service_client_accounts",
  "service_clients",
  "memberships",
  "accounts",
  "organizations",
  "users",
  "outbox_messages",
  "inbox_messages",
  "audit_log",
  "idempotency_keys",
];

/**
 * Empty every table between tests.
 *
 * `TRUNCATE` takes an AccessExclusiveLock on all of them at once, and the app under test keeps
 * a connection pool: anything still in flight from the test that just finished — a request the
 * assertion did not wait for, a handler finishing after its tick — holds a read lock on one of
 * these tables and may want another, which is a deadlock rather than a wait. Postgres picks a
 * victim and raises 40P01.
 *
 * Retrying is the right answer because truncation is idempotent: there is no half-done state to
 * reason about, and the loser only has to go again once the other side has finished. Growing the
 * table list makes the window wider, so this got easier to hit as the schema grew rather than
 * appearing with any one change.
 */
async function truncateAll(db: DbService, attempts = 5): Promise<void> {
  const statement = sql.raw(`truncate table ${TRUNCATE.join(", ")} restart identity cascade`);
  for (let attempt = 1; ; attempt++) {
    try {
      await db.db.execute(statement);
      return;
    } catch (err) {
      const code =
        (err as { cause?: { code?: string }; code?: string }).cause?.code ??
        (err as { code?: string }).code;
      if (code !== "40P01" || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

/** Boots the real app (guards, filters, middleware) against the test database. */
export async function createHarness(): Promise<Harness> {
  const url = process.env["DATABASE_URL"]!;
  await runMigrations(url);

  const app = await createHttpApp();
  await app.init();

  const db = app.get(DbService);
  await db.transaction((tx) => seedCatalog(tx));
  const verifier = app.get(TokenVerifier);
  const settings = app.get(SettingsService);
  const dispatcher = app.get(OutboxDispatcher);

  return {
    app,
    db,
    dispatcher,
    http: () => request.agent(app.getHttpServer()),
    tokenFor: (user) => verifier.signDevToken({ userId: user.id, email: user.email }),
    reset: async () => {
      await truncateAll(db);
      await db.transaction((tx) => seedCatalog(tx));
      // The settings table was just truncated and re-seeded underneath the read cache.
      settings.invalidate();
    },
    close: () => app.close(),
  };
}

export const USERS = {
  admin: { id: "10000000-0000-4000-8000-000000000001", email: "admin@test.local" },
  alice: { id: "10000000-0000-4000-8000-000000000010", email: "alice@test.local" },
  bob: { id: "10000000-0000-4000-8000-000000000011", email: "bob@test.local" },
  carol: { id: "10000000-0000-4000-8000-000000000012", email: "carol@test.local" },
};
