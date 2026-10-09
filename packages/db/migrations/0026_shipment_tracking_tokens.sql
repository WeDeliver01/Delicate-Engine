CREATE TABLE "shipment_tracking_tokens" (
	"shipment_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "shipment_tracking_tokens" ADD CONSTRAINT "shipment_tracking_tokens_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_tracking_tokens_token_uq" ON "shipment_tracking_tokens" USING btree ("token");