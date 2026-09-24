CREATE TYPE "public"."document_kind" AS ENUM('tax_invoice', 'invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"next" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"description" text NOT NULL,
	"waybill" text,
	"shipment_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"vat_bps" integer NOT NULL,
	"vat_cents" bigint NOT NULL,
	"gross_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reference" text NOT NULL,
	"journal_id" uuid,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"account_id" uuid NOT NULL,
	"booking_id" uuid,
	"period" text,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"net_cents" bigint NOT NULL,
	"vat_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"outstanding_cents" bigint DEFAULT 0 NOT NULL,
	"supplier" jsonb NOT NULL,
	"bill_to" jsonb NOT NULL,
	"credits_invoice_id" uuid,
	"credited_by_invoice_id" uuid,
	"note" text,
	"journal_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "billing_email" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "billing_address" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_idem_uq" ON "invoice_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_idem_uq" ON "invoices" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "invoices_account_idx" ON "invoices" USING btree ("account_id","issued_at");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "invoices_period_idx" ON "invoices" USING btree ("period");