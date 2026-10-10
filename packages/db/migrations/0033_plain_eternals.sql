CREATE TYPE "public"."webhook_subscription_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_client_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"event_types" text[] DEFAULT '{}' NOT NULL,
	"status" "webhook_subscription_status" DEFAULT 'active' NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_failure_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_service_client_id_service_clients_id_fk" FOREIGN KEY ("service_client_id") REFERENCES "public"."service_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_client_idx" ON "webhook_subscriptions" USING btree ("service_client_id","status");