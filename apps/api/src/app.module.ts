import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { ConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { InfraModule } from "./infra/infra.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { GlobalExceptionFilter } from "./common/errors.js";
import { HealthController } from "./modules/health/health.controller.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { WalletModule } from "./modules/wallet/wallet.module.js";
import { SchedulingModule } from "./modules/scheduling/scheduling.module.js";
import { BookingModule } from "./modules/bookings/booking.module.js";
import { LedgerModule } from "./modules/ledger/ledger.module.js";
import { FleetModule } from "./modules/fleet/fleet.module.js";
import { WorkerModule } from "./worker/worker.module.js";

/**
 * Root module. `forRoot` builds the same graph for the HTTP server, the worker process and
 * the test harness; only the env overrides differ.
 */
@Module({})
export class AppModule {
  static forRoot(overrides: Partial<Env> = {}): DynamicModule {
    const env = { ...process.env, ...overrides } as Record<string, string | undefined>;
    const isProd = env["NODE_ENV"] === "production";
    const isTest = env["NODE_ENV"] === "test";
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(overrides),
        LoggerModule.forRoot({
          pinoHttp: {
            level: isTest ? "silent" : (env["LOG_LEVEL"] ?? "info"),
            genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
            transport: isProd
              ? undefined
              : { target: "pino-pretty", options: { singleLine: true } },
            redact: ["req.headers.authorization", "req.headers.cookie"],
            autoLogging: { ignore: (req) => req.url === "/livez" || req.url === "/healthz" },
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url?.split("?")[0],
              }),
            },
          },
        }),
        InfraModule,
        AuthModule,
        WorkerModule,
        LedgerModule,
        IdentityModule,
        AdminModule,
        CatalogModule,
        WalletModule,
        SchedulingModule,
        BookingModule,
        FleetModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
    };
  }
}
