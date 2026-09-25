CREATE TABLE "loyalty_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"booking_id" uuid,
	"reference" text NOT NULL,
	"tier_code" text NOT NULL,
	"cashback_bps" integer NOT NULL,
	"eligible_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"wallet_entry_id" uuid,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_awards" ADD CONSTRAINT "loyalty_awards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_awards" ADD CONSTRAINT "loyalty_awards_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_awards_booking_uq" ON "loyalty_awards" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "loyalty_awards_account_idx" ON "loyalty_awards" USING btree ("account_id","created_at");