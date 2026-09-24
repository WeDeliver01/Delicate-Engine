import { Controller, Get, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { TreasuryPolicy, UpsertWalletRequest, Uuid } from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { TreasuryService } from "./treasury.service.js";

const SlugParam = z.object({ slug: z.string().min(2).max(60) });
const Period = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
const TxQuery = Period.extend({
  walletId: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Treasury console. Read-only for dispatchers; only finance and super admins change the policy or
 * the wallets, because those numbers decide where every rand of margin is earmarked.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/treasury")
@PlatformRoles("super_admin", "finance")
export class AdminTreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get("dashboard")
  dashboard(@Query(Period) q: { period?: string }) {
    return this.treasury.dashboard(q.period);
  }

  @Get("wallets")
  wallets() {
    return this.treasury.listWallets();
  }

  @Put("wallets/:slug")
  upsertWallet(
    @Params(SlugParam) p: { slug: string },
    @Body(UpsertWalletRequest) body: UpsertWalletRequest,
  ) {
    return this.treasury.upsertWallet(p.slug, body);
  }

  @Get("transactions")
  transactions(@Query(TxQuery) q: { walletId?: string; period?: string; limit?: number }) {
    return this.treasury.transactions(q);
  }

  @Get("policy")
  policy() {
    return this.treasury.policy();
  }

  @Post("policy")
  setPolicy(@Body(TreasuryPolicy) body: TreasuryPolicy) {
    return this.treasury.setPolicy(body);
  }
}
