ALTER TABLE "accounts" ADD COLUMN "requires_vehicle_class" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "constraints" jsonb;