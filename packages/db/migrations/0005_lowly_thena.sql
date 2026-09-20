CREATE TYPE "public"."driver_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('petrol', 'diesel', 'electric');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('scheduled', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."assignment_source" AS ENUM('auto', 'dispatcher');--> statement-breakpoint
CREATE TYPE "public"."journal_kind" AS ENUM('topup', 'settlement', 'reversal', 'adjustment', 'cashback', 'payout', 'fuel_load');--> statement-breakpoint
CREATE TYPE "public"."owner_type" AS ENUM('company', 'account', 'driver');--> statement-breakpoint
CREATE TABLE "driver_location_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"shift_id" uuid,
	"location" jsonb NOT NULL,
	"accuracy_m" numeric(8, 1),
	"speed_kmh" numeric(6, 1),
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_positions" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"location" jsonb NOT NULL,
	"accuracy_m" numeric(8, 1),
	"speed_kmh" numeric(6, 1),
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"status" "driver_status" DEFAULT 'active' NOT NULL,
	"vehicle_id" uuid,
	"fuel_card_ref" text,
	"daily_stop_capacity" integer DEFAULT 25 NOT NULL,
	"home_base" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"shift_id" uuid,
	"litres" numeric(7, 2) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"odometer_km" numeric(10, 1),
	"station" text,
	"receipt_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "shift_status" DEFAULT 'scheduled' NOT NULL,
	"vehicle_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"start_odometer_km" numeric(10, 1),
	"end_odometer_km" numeric(10, 1),
	"start_fuel_pct" integer,
	"end_fuel_pct" integer,
	"start_location" jsonb,
	"end_location" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration" text NOT NULL,
	"make" text,
	"model" text,
	"fuel_type" "fuel_type" DEFAULT 'petrol' NOT NULL,
	"litres_per_100km" numeric(5, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"source" "assignment_source" NOT NULL,
	"planned_km" numeric(8, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"ended_reason" text,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account" text NOT NULL,
	"owner_type" "owner_type" NOT NULL,
	"owner_id" uuid,
	"amount_cents" bigint NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "journal_kind" NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"description" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proofs_of_delivery" (
	"shipment_id" uuid PRIMARY KEY NOT NULL,
	"driver_id" uuid NOT NULL,
	"received_by" text NOT NULL,
	"signature_file_id" uuid,
	"photo_file_id" uuid,
	"location" jsonb,
	"note" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"planned_km" numeric(8, 2) NOT NULL,
	"revenue_cents" bigint NOT NULL,
	"fuel_cost_cents" bigint NOT NULL,
	"driver_earning_cents" bigint NOT NULL,
	"margin_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"shipment_id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"driver_id" uuid,
	"shift_id" uuid,
	"revenue_cents" bigint NOT NULL,
	"vat_cents" bigint NOT NULL,
	"fuel_cost_cents" bigint NOT NULL,
	"driver_earning_cents" bigint NOT NULL,
	"margin_cents" bigint NOT NULL,
	"planned_km" numeric(8, 2) NOT NULL,
	"actual_km" numeric(8, 2) NOT NULL,
	"journal_id" uuid NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_location_history" ADD CONSTRAINT "driver_location_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_location_history" ADD CONSTRAINT "driver_location_history_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_positions" ADD CONSTRAINT "driver_positions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_signature_file_id_files_id_fk" FOREIGN KEY ("signature_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_forecasts" ADD CONSTRAINT "settlement_forecasts_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_forecasts" ADD CONSTRAINT "settlement_forecasts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_location_history_idx" ON "driver_location_history" USING btree ("driver_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_email_uq" ON "drivers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_user_uq" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fuel_logs_driver_idx" ON "fuel_logs" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_driver_date_uq" ON "shifts" USING btree ("driver_id","date");--> statement-breakpoint
CREATE INDEX "shifts_date_idx" ON "shifts" USING btree ("date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_registration_uq" ON "vehicles" USING btree ("registration");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_active_uq" ON "assignments" USING btree ("shipment_id") WHERE "assignments"."active" = true;--> statement-breakpoint
CREATE INDEX "assignments_driver_idx" ON "assignments" USING btree ("driver_id","active");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "journal_lines_journal_idx" ON "journal_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_idem_uq" ON "journals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "journals_ref_idx" ON "journals" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "settlement_forecasts_shipment_idx" ON "settlement_forecasts" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "settlements_driver_idx" ON "settlements" USING btree ("driver_id","settled_at");--> statement-breakpoint
CREATE INDEX "settlements_account_idx" ON "settlements" USING btree ("account_id","settled_at");