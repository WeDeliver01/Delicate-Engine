import { Controller, Delete, Get, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  RateGroupMembersRequest,
  RateRulesRequest,
  SetRateGroupActiveRequest,
  UpsertRateCardRequest,
  UpsertRateGroupRequest,
  Uuid,
} from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Body, Params } from "../../common/zod.js";
import { RatesService } from "./rates.service.js";

const IdParam = z.object({ id: Uuid });
const GroupCardParams = z.object({ id: Uuid, cardId: Uuid });
const AccountParam = z.object({ accountId: Uuid });
const GroupMemberParams = z.object({ id: Uuid, accountId: Uuid });

/**
 * Rates. Super admin only — not finance, not dispatch.
 *
 * What a customer is charged is the one setting here that is also a commercial commitment, so
 * the section that holds it is the narrowest role the platform has. Everything on it is
 * audited; nothing on it moves money by itself.
 */
@ApiTags("rates")
@ApiBearerAuth()
@Controller("v1/admin/rates")
@PlatformRoles("super_admin")
export class AdminRatesController {
  constructor(private readonly rates: RatesService) {}

  // ── the current rate setup ───────────────────────────────────────────────

  @Get("cards")
  cards() {
    return this.rates.listPlatformRateCards();
  }

  @Post("cards")
  createCard(@Body(UpsertRateCardRequest) body: UpsertRateCardRequest) {
    return this.rates.upsertPlatformRateCard(null, body);
  }

  @Put("cards/:id")
  updateCard(
    @Params(IdParam) p: { id: string },
    @Body(UpsertRateCardRequest) body: UpsertRateCardRequest,
  ) {
    return this.rates.upsertPlatformRateCard(p.id, body);
  }

  // ── groups ──────────────────────────────────────────────────────────────

  @Get("groups")
  groups() {
    return this.rates.listGroups();
  }

  @Post("groups")
  createGroup(@Body(UpsertRateGroupRequest) body: UpsertRateGroupRequest) {
    return this.rates.upsertGroup(null, body);
  }

  @Put("groups/:id")
  updateGroup(
    @Params(IdParam) p: { id: string },
    @Body(UpsertRateGroupRequest) body: UpsertRateGroupRequest,
  ) {
    return this.rates.upsertGroup(p.id, body);
  }

  /** The switch. On needs published rates; off puts every member back on the default card. */
  @Put("groups/:id/active")
  setGroupActive(
    @Params(IdParam) p: { id: string },
    @Body(SetRateGroupActiveRequest) body: SetRateGroupActiveRequest,
  ) {
    return this.rates.setGroupActive(p.id, body.active);
  }

  @Post("groups/:id/members")
  addMembers(
    @Params(IdParam) p: { id: string },
    @Body(RateGroupMembersRequest) body: RateGroupMembersRequest,
  ) {
    return this.rates.addMembers(p.id, body.accountIds);
  }

  @Delete("groups/:id/members/:accountId")
  removeMember(@Params(GroupMemberParams) p: { id: string; accountId: string }) {
    return this.rates.removeMember(p.id, p.accountId);
  }

  /** Draft rates for the group. Inactive until published, so this charges nobody. */
  @Post("groups/:id/cards")
  createGroupCard(
    @Params(IdParam) p: { id: string },
    @Body(RateRulesRequest) body: RateRulesRequest,
  ) {
    return this.rates.createGroupRates(p.id, body);
  }

  @Put("groups/:id/cards/:cardId")
  updateGroupCard(
    @Params(GroupCardParams) p: { id: string; cardId: string },
    @Body(RateRulesRequest) body: RateRulesRequest,
  ) {
    return this.rates.updateGroupRates(p.id, p.cardId, body);
  }

  /** Go live. This card becomes the group's rules; the one it replaces is retired. */
  @Post("groups/:id/cards/:cardId/publish")
  publishGroupCard(@Params(GroupCardParams) p: { id: string; cardId: string }) {
    return this.rates.publishGroupRates(p.id, p.cardId);
  }

  // ── a single account's rates ────────────────────────────────────────────

  @Get("accounts")
  accountAssignments() {
    return this.rates.listAccountAssignments();
  }

  /** What this account is charged on today, and which of the three answers it came from. */
  @Get("accounts/:accountId")
  resolution(@Params(AccountParam) p: { accountId: string }) {
    return this.rates.resolutionFor(p.accountId);
  }

  /** A card for this customer alone. Live as soon as it is saved; beats any group. */
  @Post("accounts/:accountId/card")
  createAccountCard(
    @Params(AccountParam) p: { accountId: string },
    @Body(RateRulesRequest) body: RateRulesRequest,
  ) {
    return this.rates.createAccountRates(p.accountId, body);
  }

  /** Put an existing platform card on the account instead of writing a new one. */
  @Put("accounts/:accountId/card")
  async assign(
    @Params(AccountParam) p: { accountId: string },
    @Body(z.object({ rateCardId: Uuid })) body: { rateCardId: string },
  ) {
    await this.rates.assignRateCard(p.accountId, body.rateCardId);
    return this.rates.resolutionFor(p.accountId);
  }

  /** Off the negotiated card and back to its group, or to the default. */
  @Delete("accounts/:accountId/card")
  async clear(@Params(AccountParam) p: { accountId: string }) {
    await this.rates.assignRateCard(p.accountId, null);
    return this.rates.resolutionFor(p.accountId);
  }
}
