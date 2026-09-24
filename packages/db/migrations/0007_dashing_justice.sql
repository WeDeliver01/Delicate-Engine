CREATE TYPE "public"."payout_method" AS ENUM('eft', 'paycentral', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."proposal_kind" AS ENUM('driver_earnings_payout', 'driver_fuel_load', 'vendor_payment');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('proposed', 'approved', 'rejected', 'executed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "payment_counters" (
	"period" text PRIMARY KEY NOT NULL,
	"next" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"kind" "proposal_kind" NOT NULL,
	"status" "proposal_status" DEFAULT 'proposed' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" "payout_method" NOT NULL,
	"driver_id" uuid,
	"vendor_name" text,
	"wallet_id" uuid,
	"period" text NOT NULL,
	"basis" jsonb NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"decision_note" text,
	"executed_by_user_id" uuid,
	"executed_at" timestamp with time zone,
	"external_reference" text,
	"journal_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_wallet_id_allocation_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."allocation_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_proposals_reference_uq" ON "payment_proposals" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_proposals_idem_uq" ON "payment_proposals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_proposals_status_idx" ON "payment_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_proposals_driver_idx" ON "payment_proposals" USING btree ("driver_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_proposals_open_driver_uq" ON "payment_proposals" USING btree ("kind","driver_id","period") WHERE "payment_proposals"."status" in ('proposed', 'approved', 'failed') and "payment_proposals"."driver_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_proposals_open_wallet_uq" ON "payment_proposals" USING btree ("kind","wallet_id","period") WHERE "payment_proposals"."status" in ('proposed', 'approved', 'failed') and "payment_proposals"."wallet_id" is not null;