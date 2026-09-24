import { Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  BankSweepRequest,
  DecideProposalRequest,
  ExecuteProposalRequest,
  FailProposalRequest,
  PrepareRunRequest,
  ProposalKind,
  ProposalStatus,
  Uuid,
} from "@delicate/contracts";
import { drivers } from "@delicate/db";
import { PlatformRoles } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { DbService } from "../../infra/db.module.js";
import { AppError } from "../../common/errors.js";
import { PaymentsService } from "./payments.service.js";
import { PayCentralAdapter } from "./paycentral.adapter.js";

const IdParam = z.object({ id: Uuid });
const ListQuery = z.object({
  status: ProposalStatus.optional(),
  kind: ProposalKind.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Finance console for money leaving the business. Every route here is a human in the loop:
 * `prepare` only writes proposals, and nothing is paid until someone records that they paid it.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/payments")
@PlatformRoles("super_admin", "finance")
export class AdminPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly paycentral: PayCentralAdapter,
    private readonly dbs: DbService,
  ) {}

  @Get("payables")
  payables() {
    return this.payments.payables();
  }

  @Get("proposals")
  list(@Query(ListQuery) q: { status?: ProposalStatus; kind?: ProposalKind; limit?: number }) {
    return this.payments.list(q);
  }

  @Get("proposals/:id")
  get(@Params(IdParam) p: { id: string }) {
    return this.payments.get(p.id);
  }

  /** Compute what is owed and write proposals. Writes nothing to any bank. */
  @Post("runs")
  prepare(@Body(PrepareRunRequest) body: PrepareRunRequest) {
    return this.payments.prepare(body);
  }

  @Post("proposals/:id/approve")
  approve(
    @Params(IdParam) p: { id: string },
    @Body(DecideProposalRequest) body: DecideProposalRequest,
  ) {
    return this.payments.approve(p.id, body.note);
  }

  @Post("proposals/:id/reject")
  reject(
    @Params(IdParam) p: { id: string },
    @Body(DecideProposalRequest) body: DecideProposalRequest,
  ) {
    return this.payments.reject(p.id, body.note);
  }

  @Post("proposals/:id/cancel")
  cancel(
    @Params(IdParam) p: { id: string },
    @Body(DecideProposalRequest) body: DecideProposalRequest,
  ) {
    return this.payments.cancel(p.id, body.note);
  }

  /** "I paid this, here is the proof." Posts the journal. */
  @Post("proposals/:id/execute")
  execute(
    @Params(IdParam) p: { id: string },
    @Body(ExecuteProposalRequest) body: ExecuteProposalRequest,
  ) {
    return this.payments.execute(p.id, body);
  }

  @Post("proposals/:id/fail")
  fail(@Params(IdParam) p: { id: string }, @Body(FailProposalRequest) body: FailProposalRequest) {
    return this.payments.fail(p.id, body.reason);
  }

  /** How to actually make an approved fuel load. Instructions for a person, not an API call. */
  @Get("proposals/:id/fuel-load-instructions")
  async fuelInstructions(@Params(IdParam) p: { id: string }) {
    const proposal = await this.payments.get(p.id);
    if (proposal.kind !== "driver_fuel_load") {
      throw new AppError("not_a_fuel_load", "this proposal is not a fuel card load", 422);
    }
    const driver = proposal.driverId
      ? await this.dbs.db.query.drivers.findFirst({ where: eq(drivers.id, proposal.driverId) })
      : null;
    return {
      proposal,
      instruction: this.paycentral.instructionsFor(proposal, driver?.fuelCardRef ?? null),
    };
  }

  @Post("bank-sweeps")
  sweep(@Body(BankSweepRequest) body: BankSweepRequest) {
    return this.payments.bankSweep(body);
  }
}
