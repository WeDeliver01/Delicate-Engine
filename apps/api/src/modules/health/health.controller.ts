import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { HealthResponse } from "@delicate/contracts";
import { Public } from "../../auth/decorators.js";
import { DbService } from "../../infra/db.module.js";
import { APP_VERSION } from "../../version.js";

@ApiTags("platform")
@Controller()
export class HealthController {
  constructor(private readonly dbs: DbService) {}

  /** Liveness: process is up. */
  @Public()
  @Get("livez")
  livez() {
    return { status: "ok" as const };
  }

  /** Readiness: dependencies reachable. Used by compose/caddy health checks. */
  @Public()
  @Get("healthz")
  async healthz(): Promise<HealthResponse> {
    const checks: HealthResponse["checks"] = {};
    try {
      const latencyMs = await this.dbs.ping();
      checks["database"] = { status: "ok", latencyMs };
    } catch {
      checks["database"] = { status: "fail" };
    }
    const degraded = Object.values(checks).some((c) => c.status === "fail");
    return {
      status: degraded ? "degraded" : "ok",
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }
}
