CREATE TYPE "public"."sequence_source" AS ENUM('auto', 'dispatcher');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('planned', 'released', 'started', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."trip_stop_kind" AS ENUM('collection', 'drop');--> statement-breakpoint
CREATE TYPE "public"."trip_stop_status" AS ENUM('pending', 'arrived', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."trip_stop_window_source" AS ENUM('slot', 'dispatcher', 'pinned');--> statement-breakpoint
CREATE TABLE "trip_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "trip_stop_kind" NOT NULL,
	"sequence" integer NOT NULL,
	"booking_id" uuid NOT NULL,
	"shipment_id" uuid,
	"status" "trip_stop_status" DEFAULT 'pending' NOT NULL,
	"planned_arrival_minute" integer,
	"planned_service_minutes" integer,
	"leg_km" numeric(8, 2),
	"leg_minutes" integer,
	"window_start_minute" integer,
	"window_end_minute" integer,
	"window_source" "trip_stop_window_source" DEFAULT 'slot' NOT NULL,
	"group_key" text,
	"arrived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"driver_id" uuid NOT NULL,
	"shift_id" uuid,
	"vehicle_id" uuid,
	"date" date NOT NULL,
	"status" "trip_status" DEFAULT 'planned' NOT NULL,
	"sequence_source" "sequence_source" DEFAULT 'auto' NOT NULL,
	"planned_km" numeric(8, 2) DEFAULT '0' NOT NULL,
	"planned_minutes" integer DEFAULT 0 NOT NULL,
	"route_snapshot" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"abandoned_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_stops_sequence_uq" ON "trip_stops" USING btree ("trip_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_stops_drop_uq" ON "trip_stops" USING btree ("trip_id","shipment_id") WHERE "trip_stops"."kind" = 'drop';--> statement-breakpoint
CREATE UNIQUE INDEX "trip_stops_collection_uq" ON "trip_stops" USING btree ("trip_id","booking_id") WHERE "trip_stops"."kind" = 'collection';--> statement-breakpoint
CREATE INDEX "trip_stops_trip_idx" ON "trip_stops" USING btree ("trip_id","sequence");--> statement-breakpoint
CREATE INDEX "trip_stops_shipment_idx" ON "trip_stops" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_reference_uq" ON "trips" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_driver_date_uq" ON "trips" USING btree ("driver_id","date") WHERE "trips"."status" <> 'abandoned';--> statement-breakpoint
CREATE INDEX "trips_date_idx" ON "trips" USING btree ("date","status");