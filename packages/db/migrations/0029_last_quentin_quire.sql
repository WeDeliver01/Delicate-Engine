CREATE TABLE "package_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "package_types" ADD COLUMN "length_cm" integer;--> statement-breakpoint
ALTER TABLE "package_types" ADD COLUMN "width_cm" integer;--> statement-breakpoint
ALTER TABLE "package_types" ADD COLUMN "height_cm" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "package_categories_name_uq" ON "package_categories" USING btree ("name");