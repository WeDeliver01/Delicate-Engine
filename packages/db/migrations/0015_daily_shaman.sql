ALTER TABLE "quotes" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "label" text;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_reference_uq" ON "quotes" USING btree ("reference");