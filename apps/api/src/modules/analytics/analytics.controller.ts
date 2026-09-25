import { Controller, Get, Header, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { IsoDate } from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Query } from "../../common/zod.js";
import { AnalyticsService, type ExportKind } from "./analytics.service.js";
import { ReconciliationService } from "./reconciliation.service.js";

const Range = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });
const ExportQuery = Range.extend({
  kind: z.enum(["settlements", "journals", "invoices", "bookings", "allocations"]),
});

/** Reporting. Derived from the same rows the money is made of, never from a summary table. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/analytics")
@PlatformRoles("super_admin", "finance", "dispatcher")
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /**
   * Prove the invariants against the data rather than against the code that wrote it.
   * Read-only on purpose: a report that quietly repaired what it found would hide the bug.
   */
  @Get("reconciliation")
  reconcile() {
    return this.reconciliation.run();
  }

  @Get("overview")
  overview(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.overview(q.from, q.to);
  }

  @Get("daily")
  daily(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.daily(q.from, q.to);
  }

  @Get("top-accounts")
  topAccounts(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.topAccounts(q.from, q.to);
  }

  @Get("drivers")
  drivers(@Query(Range) q: { from?: string; to?: string }) {
    return this.analytics.driverPerformance(q.from, q.to);
  }

  /** CSV, because a spreadsheet and an accountant both read it without being asked to install anything. */
  @Get("export.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @PlatformRoles("super_admin", "finance")
  async exportCsv(
    @Query(ExportQuery) q: { kind: ExportKind; from?: string; to?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const name = `delicate-${q.kind}-${q.from ?? "start"}-to-${q.to ?? "today"}.csv`;
    res.setHeader("content-disposition", `attachment; filename="${name}"`);
    return this.analytics.exportCsv(q.kind, q.from, q.to);
  }
}
