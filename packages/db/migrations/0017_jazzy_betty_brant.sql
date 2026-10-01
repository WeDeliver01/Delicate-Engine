CREATE TABLE "geo_usage_daily" (
	"day" text NOT NULL,
	"provider" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocoded_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"normalized" text NOT NULL,
	"formatted" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"suburb" text,
	"city" text,
	"postal_code" text,
	"provider" text NOT NULL,
	"provider_place_id" text,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"from_lat" double precision NOT NULL,
	"from_lng" double precision NOT NULL,
	"to_lat" double precision NOT NULL,
	"to_lng" double precision NOT NULL,
	"metres" bigint NOT NULL,
	"provider" text NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "geo_usage_daily_uq" ON "geo_usage_daily" USING btree ("day","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "geocoded_addresses_fingerprint_uq" ON "geocoded_addresses" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "geocoded_addresses_used_idx" ON "geocoded_addresses" USING btree ("last_used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "route_legs_fingerprint_uq" ON "route_legs" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "route_legs_measured_idx" ON "route_legs" USING btree ("measured_at");