ALTER TABLE "bookings" ADD COLUMN "customer_reference" text;--> statement-breakpoint
CREATE INDEX "bookings_customer_ref_idx" ON "bookings" USING btree ("account_id","customer_reference");