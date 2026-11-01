CREATE TYPE "public"."membership_collection" AS ENUM('wallet', 'invoice', 'manual');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "account_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"collection" "membership_collection" DEFAULT 'wallet' NOT NULL,
	"price_cents" integer NOT NULL,
	"discount_bps" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"free_shipments_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"collection" "membership_collection" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"wallet_entry_id" uuid,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"suited_from_deliveries" integer DEFAULT 0 NOT NULL,
	"free_shipments_per_period" integer DEFAULT 0 NOT NULL,
	"waives_holiday_surcharge" boolean DEFAULT false NOT NULL,
	"waives_all_surcharges" boolean DEFAULT false NOT NULL,
	"includes_api_access" boolean DEFAULT false NOT NULL,
	"priority_support" boolean DEFAULT false NOT NULL,
	"dedicated_manager" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_memberships" ADD CONSTRAINT "account_memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_memberships" ADD CONSTRAINT "account_memberships_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_charges" ADD CONSTRAINT "membership_charges_membership_id_account_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."account_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_charges" ADD CONSTRAINT "membership_charges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_memberships_live_uq" ON "account_memberships" USING btree ("account_id") WHERE "account_memberships"."status" in ('active', 'past_due');--> statement-breakpoint
CREATE INDEX "account_memberships_renewal_idx" ON "account_memberships" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_charges_period_uq" ON "membership_charges" USING btree ("membership_id","period_start");--> statement-breakpoint
CREATE INDEX "membership_charges_account_idx" ON "membership_charges" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_plans_code_uq" ON "membership_plans" USING btree ("code");--> statement-breakpoint

-- The three tiers from the marketing page, so the plans exist the moment this ships rather
-- than needing someone to retype them. Prices and benefits are editable in the console
-- afterwards; this is a starting point, not a hard-coded truth.
INSERT INTO "membership_plans"
  ("code", "name", "price_cents", "discount_bps", "suited_from_deliveries",
   "free_shipments_per_period", "waives_holiday_surcharge", "waives_all_surcharges",
   "includes_api_access", "priority_support", "dedicated_manager", "sort_order")
VALUES
  ('starter',    'Starter',     99900, 1500, 20, 0, false, false, true, true,  false, 1),
  ('growth',     'Growth',     199900, 2500, 35, 1, true,  false, true, true,  false, 2),
  ('enterprise', 'Enterprise', 349900, 4000, 55, 1, true,  true,  true, true,  true,  3)
ON CONFLICT ("code") DO NOTHING;
