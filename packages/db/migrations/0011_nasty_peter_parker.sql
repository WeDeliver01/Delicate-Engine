CREATE TABLE "saved_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address" jsonb NOT NULL,
	"contact" jsonb NOT NULL,
	"instructions" text,
	"is_collection_point" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_addresses_label_uq" ON "saved_addresses" USING btree ("account_id","label") WHERE "saved_addresses"."archived" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_addresses_default_uq" ON "saved_addresses" USING btree ("account_id") WHERE "saved_addresses"."is_default" = true and "saved_addresses"."archived" = false;--> statement-breakpoint
CREATE INDEX "saved_addresses_account_idx" ON "saved_addresses" USING btree ("account_id","archived","use_count");