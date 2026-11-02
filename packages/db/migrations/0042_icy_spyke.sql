CREATE TYPE "public"."rate_card_scope" AS ENUM('platform', 'group', 'account');--> statement-breakpoint
CREATE TABLE "rate_group_members" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "scope" "rate_card_scope" DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "rate_group_members" ADD CONSTRAINT "rate_group_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_group_members" ADD CONSTRAINT "rate_group_members_group_id_rate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."rate_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_group_members_group_idx" ON "rate_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_groups_name_uq" ON "rate_groups" USING btree ("name");--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_group_id_rate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."rate_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_group_live_uq" ON "rate_cards" USING btree ("group_id") WHERE "rate_cards"."group_id" is not null and "rate_cards"."active" = true;--> statement-breakpoint
CREATE INDEX "rate_cards_group_idx" ON "rate_cards" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "rate_cards_account_idx" ON "rate_cards" USING btree ("account_id");