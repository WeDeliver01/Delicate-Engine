CREATE TYPE "public"."service_client_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "account_external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"system" text NOT NULL,
	"external_id" text NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_client_accounts" (
	"service_client_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_client_accounts_service_client_id_account_id_pk" PRIMARY KEY("service_client_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "service_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"key_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_hint" text NOT NULL,
	"status" "service_client_status" DEFAULT 'active' NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_service_client_id" uuid;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "weekend_surcharge_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "weekend_surcharge_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "public_holiday_surcharge_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "public_holiday_surcharge_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "created_by_service_client_id" uuid;--> statement-breakpoint
ALTER TABLE "account_external_refs" ADD CONSTRAINT "account_external_refs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_external_refs" ADD CONSTRAINT "account_external_refs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_client_accounts" ADD CONSTRAINT "service_client_accounts_service_client_id_service_clients_id_fk" FOREIGN KEY ("service_client_id") REFERENCES "public"."service_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_client_accounts" ADD CONSTRAINT "service_client_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_clients" ADD CONSTRAINT "service_clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_external_refs_lookup_uq" ON "account_external_refs" USING btree ("system","external_id");--> statement-breakpoint
CREATE INDEX "account_external_refs_account_idx" ON "account_external_refs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "service_client_accounts_account_idx" ON "service_client_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_clients_key_id_uq" ON "service_clients" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_clients_slug_uq" ON "service_clients" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_service_client_id_service_clients_id_fk" FOREIGN KEY ("created_by_service_client_id") REFERENCES "public"."service_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_service_actor_idx" ON "audit_log" USING btree ("actor_service_client_id","created_at");