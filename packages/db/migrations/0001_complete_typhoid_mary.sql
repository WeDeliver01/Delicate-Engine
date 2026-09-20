CREATE TYPE "public"."quote_status" AS ENUM('priced', 'booked', 'expired');--> statement-breakpoint
CREATE TABLE "account_rate_cards" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"max_weight_kg" numeric(8, 2),
	"surcharge_cents" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"service_level_code" text NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'priced' NOT NULL,
	"request" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"breakdown" jsonb NOT NULL,
	"distance_provider" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cost_per_km_cents" integer NOT NULL,
	"margin_bps" integer NOT NULL,
	"fuel_surcharge_bps" integer DEFAULT 0 NOT NULL,
	"min_fee_cents" integer DEFAULT 0 NOT NULL,
	"extra_drop_fee_cents" integer DEFAULT 0 NOT NULL,
	"liability_cover_bps" integer DEFAULT 0 NOT NULL,
	"liability_cover_min_cents" integer DEFAULT 0 NOT NULL,
	"early_collection_fee_cents" integer DEFAULT 0 NOT NULL,
	"signature_fee_cents" integer DEFAULT 0 NOT NULL,
	"wedding_venue_fee_cents" integer DEFAULT 0 NOT NULL,
	"road_factor_bps" integer DEFAULT 13000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"multiplier_bps" integer DEFAULT 10000 NOT NULL,
	"surcharge_cents" integer DEFAULT 0 NOT NULL,
	"requires_slot" boolean DEFAULT true NOT NULL,
	"same_day_cutoff_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_rate_cards" ADD CONSTRAINT "account_rate_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_rate_cards" ADD CONSTRAINT "account_rate_cards_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "package_types_code_uq" ON "package_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "quotes_account_idx" ON "quotes" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_name_uq" ON "rate_cards" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_default_uq" ON "rate_cards" USING btree ("is_default") WHERE "rate_cards"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "service_levels_code_uq" ON "service_levels" USING btree ("code");