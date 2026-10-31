ALTER TABLE "settlements" ALTER COLUMN "actual_km" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ALTER COLUMN "settled_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "settlements" ALTER COLUMN "settled_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "true_up_journal_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "reversal_journal_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "presettled_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "settlements_presettled_idx" ON "settlements" USING btree ("presettled_at");