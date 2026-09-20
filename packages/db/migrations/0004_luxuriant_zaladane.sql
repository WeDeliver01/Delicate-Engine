CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'in_progress', 'completed', 'cancelled', 'rejected_insufficient_funds', 'rejected_slot_unavailable', 'rejected_quote_expired');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('booked', 'assigned', 'collected', 'in_transit', 'delivered', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "booking_status" NOT NULL,
	"service_level_code" text NOT NULL,
	"slot_date" date,
	"slot_window_key" text,
	"collection" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"breakdown" jsonb NOT NULL,
	"total_cents" bigint NOT NULL,
	"hold_id" uuid,
	"idempotency_key" text NOT NULL,
	"rejection_reason" text,
	"created_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" "shipment_status" NOT NULL,
	"note" text,
	"actor_user_id" uuid,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"waybill" text NOT NULL,
	"sequence" integer NOT NULL,
	"status" "shipment_status" DEFAULT 'booked' NOT NULL,
	"service_level_code" text NOT NULL,
	"slot_date" date,
	"slot_window_key" text,
	"recipient" jsonb NOT NULL,
	"delivery_address" jsonb NOT NULL,
	"instructions" text,
	"parcels" jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waybill_counters" (
	"day" text PRIMARY KEY NOT NULL,
	"next" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hold_id_wallet_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."wallet_holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_reference_uq" ON "bookings" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_idem_uq" ON "bookings" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bookings_account_idx" ON "bookings" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_slot_idx" ON "bookings" USING btree ("slot_date","slot_window_key");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_idx" ON "shipment_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_waybill_uq" ON "shipments" USING btree ("waybill");--> statement-breakpoint
CREATE INDEX "shipments_booking_idx" ON "shipments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "shipments_account_idx" ON "shipments" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status","slot_date");