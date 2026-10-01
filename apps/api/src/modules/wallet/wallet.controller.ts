import { Controller, Get, HttpCode, Post, Put, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import {
  CreateTopUpRequest,
  CreditTermsRequest,
  Pagination,
  PaymentProviderName,
  Uuid,
  WalletAdjustmentRequest,
} from "@delicate/contracts";
import {
  ActiveAccountId,
  CurrentPrincipal,
  PlatformRoles,
  Public,
  RequireAccount,
} from "../../auth/decorators.js";
import { requireUser, type Principal } from "../../auth/principal.js";
import { Body, Params, Query } from "../../common/zod.js";
import { DbService } from "../../infra/db.module.js";
import { WalletService } from "./wallet.service.js";
import { TopUpService } from "./topup.service.js";

@ApiTags("wallet")
@ApiBearerAuth()
@Controller("v1/account/wallet")
@RequireAccount()
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly topUps: TopUpService,
  ) {}

  @Get()
  summary(@ActiveAccountId() accountId: string) {
    return this.wallet.summary(accountId);
  }

  @Get("entries")
  entries(@ActiveAccountId() accountId: string, @Query(Pagination) q: Pagination) {
    return this.wallet.entries(accountId, q.limit, q.cursor);
  }

  @Get("providers")
  async providers() {
    // Awaited. `availableProviders` asks every provider whether it is configured, so it is
    // async, and a promise handed to the JSON serialiser becomes `{}` — which reaches the
    // browser as a providers field that is not an array and takes the whole page down.
    return { providers: await this.topUps.availableProviders() };
  }

  @Get("top-ups")
  topUpList(@ActiveAccountId() accountId: string, @Query(Pagination) q: Pagination) {
    return this.topUps.listForAccount(accountId, q.limit, q.cursor);
  }

  @Post("top-ups")
  createTopUp(
    @ActiveAccountId() accountId: string,
    @CurrentPrincipal() p: Principal,
    @Body(CreateTopUpRequest) body: CreateTopUpRequest,
  ) {
    return this.topUps.create(accountId, requireUser(p).email, body);
  }
}

/** Provider notifications. Public by design; each provider authenticates its own payload. */
@ApiTags("webhooks")
@Controller("v1/webhooks")
export class PaymentWebhooksController {
  constructor(private readonly topUps: TopUpService) {}

  @Public()
  @Post(":provider")
  @HttpCode(200)
  async notify(
    @Params(z.object({ provider: PaymentProviderName })) p: { provider: PaymentProviderName },
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const params = flatten(req.body);
    const result = await this.topUps.handleNotification(p.provider, {
      rawBody: req.rawBody?.toString("utf8") ?? "",
      params,
      headers: req.headers,
      sourceIp: req.ip,
    });
    return result;
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin")
@PlatformRoles("super_admin", "finance")
export class AdminWalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly topUps: TopUpService,
    private readonly dbs: DbService,
  ) {}

  @Get("top-ups/pending")
  pending(@Query(Pagination) q: Pagination) {
    return this.topUps.listPending(q.limit, q.cursor);
  }

  /** Finance matched the EFT on the bank statement. */
  @Post("top-ups/:id/confirm")
  confirm(
    @Params(z.object({ id: Uuid })) p: { id: string },
    @Body(z.object({ bankReference: z.string().max(80).optional() }))
    body: { bankReference?: string },
  ) {
    return this.dbs.transaction((tx) =>
      this.topUps.confirm(tx, p.id, "finance", body.bankReference ?? null),
    );
  }

  @Post("top-ups/:id/cancel")
  cancel(
    @Params(z.object({ id: Uuid })) p: { id: string },
    @Body(z.object({ reason: z.string().min(3).max(200) })) body: { reason: string },
  ) {
    return this.topUps.cancel(p.id, body.reason);
  }

  @Get("accounts/:id/wallet")
  accountWallet(@Params(z.object({ id: Uuid })) p: { id: string }) {
    return this.wallet.summary(p.id);
  }

  @Get("accounts/:id/wallet/entries")
  accountEntries(
    @Params(z.object({ id: Uuid })) p: { id: string },
    @Query(Pagination) q: Pagination,
  ) {
    return this.wallet.entries(p.id, q.limit, q.cursor);
  }

  @Get("accounts/:id/wallet/verify")
  verify(@Params(z.object({ id: Uuid })) p: { id: string }) {
    return this.wallet.verify(p.id);
  }

  @Post("accounts/:id/wallet/adjust")
  adjust(
    @Params(z.object({ id: Uuid })) p: { id: string },
    @Body(WalletAdjustmentRequest) body: WalletAdjustmentRequest,
  ) {
    return this.wallet.adjust(p.id, body.amountCents, body.reason);
  }

  @Put("accounts/:id/credit-terms")
  creditTerms(
    @Params(z.object({ id: Uuid })) p: { id: string },
    @Body(CreditTermsRequest) body: CreditTermsRequest,
  ) {
    return this.wallet.setCreditTerms(p.id, body);
  }
}

function flatten(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) => [
      k,
      Array.isArray(v) ? String(v[0]) : String(v),
    ]),
  );
}
