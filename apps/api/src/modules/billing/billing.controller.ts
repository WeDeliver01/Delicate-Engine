import { Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CreditNoteRequest,
  InvoiceStatus,
  IsoDate,
  IssueMonthlyRequest,
  RecordInvoicePaymentRequest,
  Uuid,
} from "@delicate/contracts";
import { AccountRoles, PlatformRoles, RequireAccount } from "../../auth/decorators.js";
import { ActiveAccountId } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { Clock } from "../../infra/clock.js";
import { InvoiceService } from "./invoice.service.js";

const IdParam = z.object({ id: Uuid });
const ListQuery = z.object({
  status: InvoiceStatus.optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const StatementQuery = z.object({ from: IsoDate, to: IsoDate });

/** What a customer can see of their own billing: their invoices and their statement. */
@ApiTags("account")
@ApiBearerAuth()
@Controller("v1/account/billing")
@RequireAccount()
@AccountRoles("customer_owner", "customer_staff")
export class AccountBillingController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get("invoices")
  list(
    @ActiveAccountId() accountId: string,
    @Query(ListQuery) q: { status?: InvoiceStatus; period?: string; limit?: number },
  ) {
    return this.invoices.list({ ...q, accountId });
  }

  @Get("invoices/:id")
  get(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.invoices.get(p.id, accountId);
  }

  @Get("statement")
  statement(
    @ActiveAccountId() accountId: string,
    @Query(StatementQuery) q: { from: string; to: string },
  ) {
    return this.invoices.statement(accountId, q.from, q.to);
  }
}

/** Finance: run the monthly billing, credit mistakes, record payments, watch the ageing. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/billing")
@PlatformRoles("super_admin", "finance")
export class AdminBillingController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly clock: Clock,
  ) {}

  @Get("invoices")
  list(
    @Query(ListQuery.extend({ accountId: Uuid.optional() }))
    q: {
      status?: InvoiceStatus;
      period?: string;
      limit?: number;
      accountId?: string;
    },
  ) {
    return this.invoices.list(q);
  }

  @Get("invoices/:id")
  get(@Params(IdParam) p: { id: string }) {
    return this.invoices.get(p.id);
  }

  /** Consolidate a month of deliveries into one invoice per postpaid account. */
  @Post("monthly-runs")
  monthly(@Body(IssueMonthlyRequest) body: IssueMonthlyRequest) {
    return this.invoices.issueMonthly(body.period ?? lastMonth(this.clock.now()), body.accountId);
  }

  @Post("invoices/:id/credit-notes")
  credit(@Params(IdParam) p: { id: string }, @Body(CreditNoteRequest) body: CreditNoteRequest) {
    return this.invoices.creditNote(p.id, body);
  }

  @Post("invoices/:id/payments")
  pay(
    @Params(IdParam) p: { id: string },
    @Body(RecordInvoicePaymentRequest) body: RecordInvoicePaymentRequest,
  ) {
    return this.invoices.recordPayment(p.id, body);
  }

  @Get("ageing")
  ageing() {
    return this.invoices.ageing();
  }

  @Get("statement")
  statement(
    @Query(StatementQuery.extend({ accountId: Uuid }))
    q: {
      accountId: string;
      from: string;
      to: string;
    },
  ) {
    return this.invoices.statement(q.accountId, q.from, q.to);
  }
}

function lastMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
