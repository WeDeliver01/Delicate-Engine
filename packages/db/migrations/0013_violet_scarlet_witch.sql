CREATE TYPE "public"."change_request_kind" AS ENUM('recipient_contact', 'delivery_address', 'instructions', 'reschedule');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('pending', 'approved', 'rejected', 'auto_applied', 'withdrawn');--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"query" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "change_request_kind" NOT NULL,
	"status" "change_request_status" DEFAULT 'pending' NOT NULL,
	"requested" jsonb NOT NULL,
	"previous" jsonb NOT NULL,
	"reason" text,
	"held_because" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_change_requests" ADD CONSTRAINT "shipment_change_requests_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_change_requests" ADD CONSTRAINT "shipment_change_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_change_requests" ADD CONSTRAINT "shipment_change_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_change_requests" ADD CONSTRAINT "shipment_change_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_filters_owner_idx" ON "saved_filters" USING btree ("user_id","scope");--> statement-breakpoint
CREATE INDEX "change_requests_shipment_idx" ON "shipment_change_requests" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "change_requests_account_idx" ON "shipment_change_requests" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "change_requests_queue_idx" ON "shipment_change_requests" USING btree ("status","created_at");