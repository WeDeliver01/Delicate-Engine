CREATE TYPE "public"."system_event_level" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" "system_event_level" NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"request_id" text,
	"account_id" uuid,
	"dedupe_key" text,
	"count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "system_events_recent_idx" ON "system_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "system_events_level_idx" ON "system_events" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX "system_events_category_idx" ON "system_events" USING btree ("category","created_at");--> statement-breakpoint
CREATE INDEX "system_events_account_idx" ON "system_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_events_dedupe_uq" ON "system_events" USING btree ("dedupe_key") WHERE "system_events"."dedupe_key" is not null;