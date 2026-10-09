import { Body as RawBody, Controller, Delete, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  ChangeRequestStatus,
  CreateChangeRequest,
  CreateSavedFilter,
  DecideChangeRequest,
  ShipmentFilterQuery,
  TrackingToken,
  Uuid,
} from "@delicate/contracts";
import {
  ActiveAccountId,
  CurrentPrincipal,
  PlatformRoles,
  Public,
  RequireAccount,
} from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { requireUser, type Principal } from "../../auth/principal.js";
import { AppError } from "../../common/errors.js";
import { ShipmentQueryService } from "./shipment-query.service.js";
import { ChangeRequestService } from "./change-request.service.js";
import { SavedFilterService } from "./saved-filter.service.js";
import { LiveTrackingService } from "./live-tracking.service.js";
import { WaybillService } from "./waybill.service.js";
import { TrackingTokenService } from "./tracking-token.service.js";

const IdParam = z.object({ id: Uuid });
const SavedFilterScope = z.object({ scope: z.enum(["portal", "admin"]).default("portal") });
const ChangeQueueQuery = z.object({
  status: z
    .union([ChangeRequestStatus, z.array(ChangeRequestStatus)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
});

/** The customer's own shipments: searching them, and asking for changes to them. */
@ApiTags("shipments")
@ApiBearerAuth()
@Controller("v1/account")
@RequireAccount()
export class AccountShipmentsController {
  constructor(
    private readonly query: ShipmentQueryService,
    private readonly changes: ChangeRequestService,
    private readonly filters: SavedFilterService,
    private readonly tracking: LiveTrackingService,
    private readonly waybills: WaybillService,
  ) {}

  @Get("shipment-search")
  search(@ActiveAccountId() accountId: string, @Query(ShipmentFilterQuery) q: ShipmentFilterQuery) {
    return this.query.list(accountId, q);
  }

  @Get("shipments/:id/waybill")
  waybill(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.waybills.forShipment(p.id, accountId);
  }

  @Get("shipments/:id/tracking")
  liveTracking(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.tracking.forShipment(p.id, accountId);
  }

  @Get("shipments/:id/timeline")
  timeline(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.tracking.timeline(p.id, accountId);
  }

  @Get("shipment-counts")
  counts(@ActiveAccountId() accountId: string, @Query(ShipmentFilterQuery) q: ShipmentFilterQuery) {
    return this.query.statusCounts(accountId, q);
  }

  @Get("shipments/:id/changes")
  changesFor(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.changes.list({ accountId, shipmentId: p.id });
  }

  @Post("shipments/:id/changes")
  requestChange(
    @ActiveAccountId() accountId: string,
    @Params(IdParam) p: { id: string },
    @Body(CreateChangeRequest) body: CreateChangeRequest,
  ) {
    return this.changes.create(p.id, accountId, body);
  }

  @Post("changes/:id/withdraw")
  withdraw(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.changes.withdraw(p.id, accountId);
  }

  @Get("saved-filters")
  listFilters(
    @CurrentPrincipal() principal: Principal,
    @Query(SavedFilterScope) q: { scope: "portal" | "admin" },
  ) {
    return this.filters.list(requireUser(principal).id, q.scope);
  }

  @Post("saved-filters")
  saveFilter(
    @CurrentPrincipal() principal: Principal,
    @ActiveAccountId() accountId: string,
    @Body(CreateSavedFilter) body: CreateSavedFilter,
  ) {
    return this.filters.create(requireUser(principal).id, accountId, body);
  }

  @Delete("saved-filters/:id")
  deleteFilter(@CurrentPrincipal() principal: Principal, @Params(IdParam) p: { id: string }) {
    return this.filters.remove(p.id, requireUser(principal).id);
  }
}

/** The console's view: every account's shipments, and the queue of changes awaiting a ruling. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin")
@PlatformRoles("super_admin", "finance", "dispatcher")
export class AdminShipmentsController {
  constructor(
    private readonly query: ShipmentQueryService,
    private readonly changes: ChangeRequestService,
    private readonly filters: SavedFilterService,
    private readonly tracking: LiveTrackingService,
    private readonly waybills: WaybillService,
  ) {}

  @Get("shipment-search")
  search(@Query(ShipmentFilterQuery) q: ShipmentFilterQuery) {
    return this.query.list(null, q);
  }

  @Get("shipments/:id/waybill")
  waybill(@Params(IdParam) p: { id: string }) {
    return this.waybills.forShipment(p.id, null);
  }

  @Get("shipments/:id/tracking")
  liveTracking(@Params(IdParam) p: { id: string }) {
    return this.tracking.forShipment(p.id, null);
  }

  @Get("shipment-counts")
  counts(@Query(ShipmentFilterQuery) q: ShipmentFilterQuery) {
    return this.query.statusCounts(null, q);
  }

  @Get("changes")
  queue(@Query(ChangeQueueQuery) q: { status?: ChangeRequestStatus[] }) {
    return this.changes.list({ status: q.status ?? ["pending"] });
  }

  @Get("changes/pending-count")
  pendingCount() {
    return this.changes.pendingCount().then((count) => ({ count }));
  }

  @Get("saved-filters")
  listFilters(@CurrentPrincipal() principal: Principal) {
    return this.filters.list(requireUser(principal).id, "admin");
  }

  @Post("saved-filters")
  saveFilter(
    @CurrentPrincipal() principal: Principal,
    @Body(CreateSavedFilter) body: CreateSavedFilter,
  ) {
    return this.filters.create(requireUser(principal).id, null, body);
  }

  @Delete("saved-filters/:id")
  deleteFilter(@CurrentPrincipal() principal: Principal, @Params(IdParam) p: { id: string }) {
    return this.filters.remove(p.id, requireUser(principal).id);
  }
}

/**
 * Ruling on a change is a narrower permission than seeing the queue. Finance can see what a
 * customer asked for; actually moving a van or a price is an ops decision.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/changes")
@PlatformRoles("super_admin", "dispatcher")
export class AdminChangeDecisionController {
  constructor(private readonly changes: ChangeRequestService) {}

  @Post(":id/decide")
  decide(@Params(IdParam) p: { id: string }, @Body(DecideChangeRequest) body: DecideChangeRequest) {
    return this.changes.decide(p.id, body);
  }
}

/**
 * The recipient's own view of their parcel, reached by the token in their SMS or email.
 *
 * Public because the person waiting for a delivery has no account with us and should not need
 * one. The token is the authorisation: 256 bits, issued per shipment, and useless for finding
 * any other. See `packages/contracts/src/dto/live-tracking.ts` for why it is not the waybill.
 */
@ApiTags("tracking")
@Controller("v1/public/live")
export class PublicLiveTrackingController {
  constructor(
    private readonly tokens: TrackingTokenService,
    private readonly tracking: LiveTrackingService,
  ) {}

  @Public()
  @Get(":token")
  async live(@Params(z.object({ token: TrackingToken })) p: { token: string }) {
    return this.tracking.publicView(await this.shipmentFor(p.token));
  }

  @Public()
  @Get(":token/timeline")
  async timeline(@Params(z.object({ token: TrackingToken })) p: { token: string }) {
    return this.tracking.publicTimeline(await this.shipmentFor(p.token));
  }

  /**
   * An unknown token is a missing page, not a forbidden one: saying "that token exists but you
   * may not use it" would confirm a guess, and there is nothing else to tell apart here.
   */
  private async shipmentFor(token: string): Promise<string> {
    const shipmentId = await this.tokens.resolve(token);
    if (!shipmentId) throw AppError.notFound("tracking_link", {});
    return shipmentId;
  }
}
