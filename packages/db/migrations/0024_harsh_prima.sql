ALTER TYPE "public"."shipment_status" ADD VALUE 'out_for_delivery' BEFORE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'on_hold' BEFORE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'returned_to_sender' BEFORE 'cancelled';