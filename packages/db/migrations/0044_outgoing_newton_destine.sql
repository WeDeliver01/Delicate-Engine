CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android', 'unknown');--> statement-breakpoint
CREATE TABLE "driver_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" "device_platform" DEFAULT 'unknown' NOT NULL,
	"app_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD COLUMN "photo_file_ids" jsonb;--> statement-breakpoint
ALTER TABLE "driver_devices" ADD CONSTRAINT "driver_devices_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_devices_token_uq" ON "driver_devices" USING btree ("expo_push_token");--> statement-breakpoint
CREATE INDEX "driver_devices_driver_idx" ON "driver_devices" USING btree ("driver_id");