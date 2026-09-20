CREATE TYPE "public"."hold_status" AS ENUM('active', 'captured', 'released');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('manual_eft', 'payfast', 'yoco', 'bobpay');--> statement-breakpoint
CREATE TYPE "public"."topup_status" AS ENUM('pending', 'confirmed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."wallet_entry_kind" AS ENUM('topup', 'charge', 'refund', 'adjustment', 'cashback', 'statement_payment');--> statement-breakpoint
CREATE TABLE "top_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "topup_status" DEFAULT 'pending' NOT NULL,
	"reference" text NOT NULL,
	"provider_ref" text,
	"metadata" jsonb,
	"initiated_by_user_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "wallet_entry_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"reference" text,
	"description" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "hold_status" DEFAULT 'active' NOT NULL,
	"reference" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"credit_limit_cents" bigint DEFAULT 0 NOT NULL,
	"statement_day" integer DEFAULT 1 NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "top_ups_reference_uq" ON "top_ups" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "top_ups_account_idx" ON "top_ups" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "top_ups_status_idx" ON "top_ups" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_entries_idem_uq" ON "wallet_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "wallet_entries_account_idx" ON "wallet_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_holds_idem_uq" ON "wallet_holds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "wallet_holds_active_idx" ON "wallet_holds" USING btree ("account_id") WHERE "wallet_holds"."status" = 'active';