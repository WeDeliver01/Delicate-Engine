import { Controller, Get, Inject, Patch, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  EstimateRequest,
  GeocodeRequest,
  QuoteRequest,
  RenameQuoteRequest,
  UpsertPackageCategoryRequest,
  UpsertPackageTypeRequest,
  UpsertRateCardRequest,
  UpsertServiceLevelRequest,
  Uuid,
} from "@delicate/contracts";
import { ActiveAccountId, PlatformRoles, Public, RequireAccount } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { GEO_PROVIDER, type GeoProvider } from "../../infra/geo/geo.provider.js";
import { SettingsService } from "../../infra/settings.service.js";
import { CatalogService } from "./catalog.service.js";
import { QuoteService } from "./quote.service.js";

/** Public: what the marketing site and the booking form need before sign-in. */
@ApiTags("catalog")
@Controller("v1/public")
export class PublicCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly quotesSvc: QuoteService,
    private readonly settings: SettingsService,
    @Inject(GEO_PROVIDER) private readonly geo: GeoProvider,
  ) {}

  /**
   * Who the carrier is, for the letterheads on quotes and waybills. Public because it is the
   * same information already printed on every document we hand out, and the bank details are
   * stripped: those belong on an invoice we issue, not on an open endpoint.
   */
  @Public()
  @Get("company")
  async company() {
    const { bank: _bank, ...profile } = await this.settings.get("company.tax_profile");
    return profile;
  }

  @Public()
  @Get("catalog")
  catalogList() {
    return this.catalog.publicCatalog();
  }

  @Public()
  @Get("geocode")
  geocode(@Query(GeocodeRequest) q: z.infer<typeof GeocodeRequest>) {
    return this.geo.geocode(q.query, 5);
  }

  /** Unsaved estimate on the default rate card (the website's quick quote). */
  @Public()
  @Post("estimate")
  estimate(@Body(EstimateRequest) body: EstimateRequest) {
    return this.quotesSvc.estimate(body);
  }
}

/** Account-scoped quotes: priced on the account's rate card, persisted, bookable. */
@ApiTags("quotes")
@ApiBearerAuth()
@Controller("v1/account/quotes")
@RequireAccount()
export class QuotesController {
  constructor(private readonly quotesSvc: QuoteService) {}

  @Post()
  create(@ActiveAccountId() accountId: string, @Body(QuoteRequest) body: QuoteRequest) {
    return this.quotesSvc.create(accountId, body);
  }

  @Get()
  list(@ActiveAccountId() accountId: string) {
    return this.quotesSvc.list(accountId);
  }

  @Get(":id")
  get(@ActiveAccountId() accountId: string, @Params(z.object({ id: Uuid })) p: { id: string }) {
    return this.quotesSvc.get(p.id, accountId);
  }

  @Patch(":id")
  rename(
    @ActiveAccountId() accountId: string,
    @Params(z.object({ id: Uuid })) p: { id: string },
    @Body(RenameQuoteRequest) body: RenameQuoteRequest,
  ) {
    return this.quotesSvc.rename(p.id, accountId, body.label);
  }

  @Post(":id/reprice")
  reprice(@ActiveAccountId() accountId: string, @Params(z.object({ id: Uuid })) p: { id: string }) {
    return this.quotesSvc.reprice(p.id, accountId);
  }
}

const IdParam = z.object({ id: Uuid });

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/catalog")
@PlatformRoles("super_admin", "finance")
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("rate-cards")
  rateCards() {
    return this.catalog.listRateCards();
  }
  @Post("rate-cards")
  createRateCard(@Body(UpsertRateCardRequest) body: UpsertRateCardRequest) {
    return this.catalog.upsertRateCard(null, body);
  }
  @Put("rate-cards/:id")
  updateRateCard(
    @Params(IdParam) p: { id: string },
    @Body(UpsertRateCardRequest) body: UpsertRateCardRequest,
  ) {
    return this.catalog.upsertRateCard(p.id, body);
  }

  @Put("accounts/:id/rate-card")
  async assign(
    @Params(IdParam) p: { id: string },
    @Body(z.object({ rateCardId: Uuid.nullable() })) body: { rateCardId: string | null },
  ) {
    await this.catalog.assignRateCard(p.id, body.rateCardId);
    return { accountId: p.id, rateCardId: body.rateCardId };
  }

  @Get("service-levels")
  serviceLevels() {
    return this.catalog.listServiceLevels();
  }
  @Post("service-levels")
  createServiceLevel(@Body(UpsertServiceLevelRequest) body: UpsertServiceLevelRequest) {
    return this.catalog.upsertServiceLevel(null, body);
  }
  @Put("service-levels/:id")
  updateServiceLevel(
    @Params(IdParam) p: { id: string },
    @Body(UpsertServiceLevelRequest) body: UpsertServiceLevelRequest,
  ) {
    return this.catalog.upsertServiceLevel(p.id, body);
  }

  @Get("package-categories")
  packageCategories() {
    return this.catalog.listPackageCategories();
  }
  @Post("package-categories")
  createPackageCategory(@Body(UpsertPackageCategoryRequest) body: UpsertPackageCategoryRequest) {
    return this.catalog.upsertPackageCategory(null, body);
  }
  @Put("package-categories/:id")
  updatePackageCategory(
    @Params(IdParam) p: { id: string },
    @Body(UpsertPackageCategoryRequest) body: UpsertPackageCategoryRequest,
  ) {
    return this.catalog.upsertPackageCategory(p.id, body);
  }

  @Get("package-types")
  packageTypes() {
    return this.catalog.listPackageTypes();
  }
  @Post("package-types")
  createPackageType(@Body(UpsertPackageTypeRequest) body: UpsertPackageTypeRequest) {
    return this.catalog.upsertPackageType(null, body);
  }
  @Put("package-types/:id")
  updatePackageType(
    @Params(IdParam) p: { id: string },
    @Body(UpsertPackageTypeRequest) body: UpsertPackageTypeRequest,
  ) {
    return this.catalog.upsertPackageType(p.id, body);
  }
}
