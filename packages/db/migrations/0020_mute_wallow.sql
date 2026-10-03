CREATE TABLE "window_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"capacity" integer NOT NULL,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "timed_window_surcharge_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "timed_window_surcharge_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "collection_window_start_minute" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "collection_window_end_minute" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivery_window_start_minute" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivery_window_end_minute" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "window_bands_date_start_uq" ON "window_bands" USING btree ("date","start_minute");