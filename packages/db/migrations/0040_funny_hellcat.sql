CREATE TYPE "public"."site_app" AS ENUM('marketing', 'portal', 'admin');--> statement-breakpoint
CREATE TYPE "public"."site_event_type" AS ENUM('pageview', 'custom');--> statement-breakpoint
CREATE TABLE "site_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"app" "site_app" NOT NULL,
	"type" "site_event_type" NOT NULL,
	"name" text NOT NULL,
	"path" text,
	"referrer" text,
	"props" jsonb,
	"account_id" uuid,
	"user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"app" "site_app" NOT NULL,
	"entry_path" text NOT NULL,
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"device_type" text,
	"browser" text,
	"os" text,
	"ip_hash" text,
	"account_id" uuid,
	"user_id" uuid,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "site_events_session_id_site_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."site_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "site_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "site_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_sessions" ADD CONSTRAINT "site_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_sessions" ADD CONSTRAINT "site_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_events_session_idx" ON "site_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "site_events_occurred_idx" ON "site_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "site_events_type_name_idx" ON "site_events" USING btree ("type","name","occurred_at");--> statement-breakpoint
CREATE INDEX "site_events_account_idx" ON "site_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "site_sessions_visitor_idx" ON "site_sessions" USING btree ("visitor_id","started_at");--> statement-breakpoint
CREATE INDEX "site_sessions_started_idx" ON "site_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "site_sessions_account_idx" ON "site_sessions" USING btree ("account_id");