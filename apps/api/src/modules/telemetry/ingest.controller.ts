import { Controller, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { TelemetryIngestRequest } from "@delicate/contracts";
import { Public } from "../../auth/decorators.js";
import { Body } from "../../common/zod.js";
import { TelemetryIngestService } from "./ingest.service.js";

/** Where the beacon lands. No auth — it fires before and after sign-in, from a browser tab. */
@ApiTags("telemetry")
@Controller("v1/telemetry")
export class TelemetryIngestController {
  constructor(private readonly ingest: TelemetryIngestService) {}

  @Public()
  @Post("events")
  async events(@Body(TelemetryIngestRequest) body: TelemetryIngestRequest, @Req() req: Request) {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip;
    await this.ingest.ingest(body, ip, req.headers["user-agent"]);
    return { status: "ok" as const };
  }
}
