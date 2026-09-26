import { Controller, Get, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  AdminCopySettings,
  CompanyTaxProfile,
  OperationsSettings,
  SettlementRules,
  SlotPolicy,
  VatSettings,
  type SettingsBundle,
  type SettingsReadiness,
} from "@delicate/contracts";
import { CATALOG_SEED, allocationWallets } from "@delicate/db";
import { PlatformRoles } from "../../auth/decorators.js";
import { Body } from "../../common/zod.js";
import { DbService } from "../../infra/db.module.js";
import { SettingsService } from "../../infra/settings.service.js";

/**
 * The numbers the operator owns: who the company is on a tax invoice, whether it charges VAT,
 * where the depot is, and what a driver earns.
 *
 * Reads are open to finance; writes are super-admin only, because changing the VAT number or the
 * driver earning rule silently changes what every future document and settlement says. Every
 * write goes through `SettingsService.set`, which audits the before and after.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/settings")
@PlatformRoles("super_admin", "finance")
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly dbs: DbService,
  ) {}

  @Get()
  async all(): Promise<SettingsBundle> {
    const [
      company,
      registered,
      bps,
      depotAddress,
      timezone,
      sameDayCutoffMinutes,
      settlement,
      slots,
      waybillTerms,
      adminCopy,
    ] = await Promise.all([
      this.settings.get("company.tax_profile"),
      this.settings.get("company.vat_registered"),
      this.settings.get("company.vat_bps"),
      this.settings.get("company.depot_address"),
      this.settings.get("company.timezone"),
      this.settings.get("booking.same_day_cutoff_minutes"),
      this.settings.get("settlement.rules"),
      this.settings.get("scheduling.policy"),
      this.settings.get("company.waybill_terms"),
      this.settings.get("notifications.admin_copy"),
    ]);
    return {
      company,
      waybillTerms,
      adminCopy,
      vat: { registered, bps },
      operations: { depotAddress, timezone, sameDayCutoffMinutes },
      settlement,
      slots,
      readiness: await this.readiness(company, registered),
    };
  }

  @Put("company-profile")
  @PlatformRoles("super_admin")
  async company(@Body(CompanyTaxProfile) body: CompanyTaxProfile) {
    await this.settings.set("company.tax_profile", body);
    return body;
  }

  @Put("waybill-terms")
  @PlatformRoles("super_admin")
  async waybillTerms(@Body(z.object({ terms: z.string().max(4000) })) body: { terms: string }) {
    await this.settings.set("company.waybill_terms", body.terms);
    return body;
  }

  /**
   * Who inside the business is copied on outbound mail. Super-admin only: it decides where
   * copies of every customer's messages land, which is a privacy decision as much as an
   * operational one.
   */
  @Put("admin-copy")
  @PlatformRoles("super_admin")
  async adminCopy(@Body(AdminCopySettings) body: AdminCopySettings) {
    await this.settings.set("notifications.admin_copy", body);
    return body;
  }

  @Put("vat")
  @PlatformRoles("super_admin")
  async vat(@Body(VatSettings) body: VatSettings) {
    await this.settings.set("company.vat_registered", body.registered);
    await this.settings.set("company.vat_bps", body.bps);
    return body;
  }

  @Put("operations")
  @PlatformRoles("super_admin")
  async operations(@Body(OperationsSettings) body: OperationsSettings) {
    await this.settings.set("company.depot_address", body.depotAddress);
    await this.settings.set("company.timezone", body.timezone);
    await this.settings.set("booking.same_day_cutoff_minutes", body.sameDayCutoffMinutes);
    return body;
  }

  @Put("settlement-rules")
  @PlatformRoles("super_admin")
  async settlementRules(@Body(SettlementRules) body: SettlementRules) {
    await this.settings.set("settlement.rules", body);
    return body;
  }

  @Put("slot-policy")
  @PlatformRoles("super_admin")
  async slotPolicy(@Body(SlotPolicy) body: SlotPolicy) {
    await this.settings.set("scheduling.policy", body);
    return body;
  }

  /** What is still seeded or missing, and what it will cost the operator if left alone. */
  private async readiness(
    company: CompanyTaxProfile,
    vatRegistered: boolean,
  ): Promise<SettingsReadiness> {
    const missing: SettingsReadiness["missing"] = [];
    if (vatRegistered && !company.vatNumber) {
      missing.push({
        field: "company.vatNumber",
        why: 'VAT is switched on but there is no VAT number, so documents issue as a plain "INVOICE" and your customers cannot claim the VAT.',
        severity: "blocking",
      });
    }
    if (!company.registrationNumber) {
      missing.push({
        field: "company.registrationNumber",
        why: "Company registration number is not printed on invoices.",
        severity: "advisory",
      });
    }
    if (!company.bank.accountNumber) {
      missing.push({
        field: "company.bank",
        why: "Invoices go out with no banking details, so a postpaid customer has nowhere to pay.",
        severity: "advisory",
      });
    }

    const obligations = await this.dbs.db
      .select()
      .from(allocationWallets)
      .where(
        and(
          eq(allocationWallets.active, true),
          eq(allocationWallets.category, "operating_expense"),
          isNotNull(allocationWallets.obligationAmountCents),
        ),
      );
    // Anything still sitting on its seeded amount has not been looked at yet, and every
    // allocation decision follows from these numbers.
    const seeded = new Map<string, number>(
      CATALOG_SEED.allocationWallets
        .filter(
          (w): w is typeof w & { obligationAmountCents: number } => "obligationAmountCents" in w,
        )
        .map((w) => [w.slug as string, w.obligationAmountCents]),
    );
    const placeholders = obligations.filter((w) => seeded.get(w.slug) === w.obligationAmountCents);
    if (placeholders.length > 0) {
      missing.push({
        field: "treasury.obligations",
        why: `${placeholders.length} monthly bill(s) still carry the seeded placeholder amount (${placeholders
          .map((w) => w.slug)
          .join(", ")}). Every allocation decision follows from these numbers.`,
        severity: "advisory",
      });
    }

    return {
      issuesTaxInvoices: vatRegistered && Boolean(company.vatNumber),
      missing,
      obligationCount: obligations.length,
      placeholderObligationCount: placeholders.length,
    };
  }
}
