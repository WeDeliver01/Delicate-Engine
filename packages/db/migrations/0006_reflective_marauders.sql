CREATE TYPE "public"."allocation_kind" AS ENUM('allocation', 'overflow', 'reversal', 'payment', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."wallet_category" AS ENUM('operating_expense', 'reserve', 'capital');--> statement-breakpoint
CREATE TABLE "allocation_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"kind" "allocation_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"reference" text,
	"period" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" "wallet_category" NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"vendor" text,
	"obligation_amount_cents" bigint,
	"due_day" integer,
	"monthly_target_cents" bigint,
	"is_retained_earnings" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocation_transactions" ADD CONSTRAINT "allocation_transactions_wallet_id_allocation_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."allocation_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_tx_idem_uq" ON "allocation_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "allocation_tx_wallet_idx" ON "allocation_transactions" USING btree ("wallet_id","period");--> statement-breakpoint
CREATE INDEX "allocation_tx_reference_idx" ON "allocation_transactions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "allocation_tx_period_idx" ON "allocation_transactions" USING btree ("period","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_wallets_slug_uq" ON "allocation_wallets" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_wallets_sink_uq" ON "allocation_wallets" USING btree ("is_retained_earnings") WHERE "allocation_wallets"."is_retained_earnings" = true;--> statement-breakpoint
CREATE INDEX "allocation_wallets_category_idx" ON "allocation_wallets" USING btree ("category","priority");