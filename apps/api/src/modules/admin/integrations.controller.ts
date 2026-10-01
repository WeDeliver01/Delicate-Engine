import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Inject } from "@nestjs/common";
import { PlatformRoles } from "../../auth/decorators.js";
import { ENV, type Env } from "../../config/env.js";
import { SettingsService } from "../../infra/settings.service.js";
import { GEO_PROVIDER, type GeoProvider } from "../../infra/geo/geo.provider.js";
import { LocationCacheService } from "../../infra/geo/location-cache.service.js";
import { GEO_DAILY_BUDGET } from "../../infra/geo/geo.module.js";
import { TopUpService } from "../../modules/wallet/topup.service.js";
import { NotificationService } from "../../modules/notifications/notification.service.js";

export interface IntegrationStatus {
  key: string;
  name: string;
  /** What this does for the business, not what it does technically. */
  purpose: string;
  configured: boolean;
  /** What it is running on right now. */
  using: string;
  /** Where the operator changes it: the console, or an environment variable. */
  changeIn: "console" | "environment";
  /** Exactly what to do when it is not configured. */
  action: string | null;
}

/**
 * Every outside dependency, in one list, with the same question answered for each: is it on, what
 * is it doing instead when it is off, and where do I change it.
 *
 * Secrets stay in the environment — an API key pasted into a web form ends up in a database
 * backup and a browser history. Everything that is a *business* detail rather than a credential
 * is editable in the console, and this page says which is which.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/integrations")
@PlatformRoles("super_admin", "finance")
export class AdminIntegrationsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(GEO_PROVIDER) private readonly geo: GeoProvider,
    private readonly settings: SettingsService,
    private readonly topups: TopUpService,
    private readonly notifications: NotificationService,
    private readonly locations: LocationCacheService,
  ) {}

  /**
   * What is measuring distances right now, what today has cost of the allowance, and how much
   * the cache saved.
   *
   * Worth showing next to the integration rather than buried in a log: it is the number that
   * says whether the free plan is still the right plan, and the only warning before a day
   * starts pricing on estimates.
   */
  private async geoUsing(): Promise<string> {
    if (this.geo.name === "haversine") {
      return "Straight-line distance with a road factor — good enough to quote, but not real road distance";
    }
    if (!this.env.GEOAPIFY_API_KEY) return this.geo.name;

    const [usage, saved] = await Promise.all([
      this.locations.usageToday("geoapify"),
      this.locations.savedCallsToday(),
    ]);
    const standby = this.env.LOCATIONIQ_API_KEY ? " (LocationIQ standing by)" : "";
    const reused = saved > 0 ? `, ${saved} answered from our own records` : "";
    const refused = usage.skipped > 0 ? ` — ${usage.skipped} skipped, the budget is spent` : "";
    return `${this.geo.name}${standby} · ${usage.calls} of ${GEO_DAILY_BUDGET} lookups used today${reused}${refused}`;
  }

  @Get()
  async all(): Promise<IntegrationStatus[]> {
    const profile = await this.settings.get("company.tax_profile");
    const providers = await this.topups.availableProviders();
    const channels = await this.notifications.channels();
    const out: IntegrationStatus[] = [];

    out.push({
      key: "maps",
      name: "Maps & routing",
      purpose:
        "Turns an address into coordinates and a route into kilometres, which is what every quote is priced on.",
      // `name` is whichever provider last answered, so this reports what is actually pricing
      // quotes rather than what is configured -- the two differ the moment Geoapify is down.
      configured: this.env.GEOAPIFY_API_KEY != null || this.env.LOCATIONIQ_API_KEY != null,
      using: await this.geoUsing(),
      changeIn: "environment",
      action: !this.env.GEOAPIFY_API_KEY
        ? "Set GEOAPIFY_API_KEY to price on real road distance, and LOCATIONIQ_API_KEY as the fallback."
        : !this.env.LOCATIONIQ_API_KEY
          ? "Set LOCATIONIQ_API_KEY so addresses and pricing survive a Geoapify outage."
          : null,
    });

    out.push({
      key: "eft",
      name: "Bank transfer (EFT)",
      purpose: "The account customers pay into when they top up by EFT.",
      configured: providers.includes("manual_eft"),
      using: profile.bank.accountNumber
        ? `${profile.bank.bankName} · ${profile.bank.accountNumber}`
        : "Nothing — customers cannot be given anywhere to pay",
      changeIn: "console",
      action: providers.includes("manual_eft")
        ? null
        : "Fill in the banking details under Company identity on this page.",
    });

    out.push({
      key: "payfast",
      name: "PayFast",
      purpose: "Card and instant-EFT top-ups that credit the wallet automatically once verified.",
      configured: providers.includes("payfast"),
      using: providers.includes("payfast")
        ? this.env.PAYFAST_SANDBOX
          ? "Sandbox — test payments only, no real money moves"
          : "Live"
        : "Off",
      changeIn: "environment",
      action: providers.includes("payfast")
        ? null
        : "Set PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY and PAYFAST_PASSPHRASE.",
    });

    out.push({
      key: "yoco",
      name: "Yoco",
      purpose: "Card top-ups that credit the wallet automatically once the webhook is verified.",
      configured: providers.includes("yoco"),
      using: providers.includes("yoco") ? "Live" : "Off",
      changeIn: "environment",
      action: providers.includes("yoco")
        ? null
        : "Set YOCO_SECRET_KEY and YOCO_WEBHOOK_SECRET, then make one sandbox payment to confirm the webhook signature before taking real money.",
    });

    out.push({
      key: "bobpay",
      name: "Bob Pay",
      purpose: "Card and instant EFT top-ups, credited once the notification is verified.",
      configured: providers.includes("bobpay"),
      using: providers.includes("bobpay") ? (this.env.BOBPAY_SANDBOX ? "Sandbox" : "Live") : "Off",
      changeIn: "environment",
      action: providers.includes("bobpay")
        ? this.env.BOBPAY_SANDBOX
          ? "Sandbox. Clear BOBPAY_SANDBOX to take real money."
          : null
        : "Set BOBPAY_API_TOKEN, BOBPAY_ACCOUNT_CODE and BOBPAY_PASSPHRASE from your Bob Pay account settings, then make one sandbox payment end to end before taking real money.",
    });

    for (const c of channels) {
      out.push({
        key: `notify.${c.channel}`,
        name: c.channel === "email" ? "Email" : c.channel === "sms" ? "SMS" : "WhatsApp",
        purpose:
          c.channel === "email"
            ? "Booking confirmations, delivery updates and invoices."
            : "Telling the person receiving a parcel that the driver is on the way.",
        configured: c.configured,
        using: c.configured
          ? c.provider
          : `Off — ${c.suppressed24h} message(s) recorded and held in the last day`,
        changeIn: "environment",
        action: c.configured ? null : c.detail,
      });
    }

    out.push({
      key: "paycentral",
      name: "PayCentral fuel cards",
      purpose: "Loading a driver's fuel card for fuel already used.",
      configured: false,
      using: "Instructions for a person, who loads the card in the PayCentral portal",
      changeIn: "environment",
      action:
        "Intentionally manual: the engine proposes a fuel load and a human executes it. An API integration would still require approval first.",
    });

    out.push({
      key: "auth",
      name: "Sign-in",
      purpose: "How customers and staff log in.",
      configured: Boolean(this.env.SUPABASE_URL),
      using: this.env.SUPABASE_URL
        ? "Supabase Auth"
        : "Development tokens — not safe for real users",
      changeIn: "environment",
      action: this.env.SUPABASE_URL
        ? null
        : "Set SUPABASE_URL and SUPABASE_JWT_SECRET before letting real customers in.",
    });

    return out;
  }
}
