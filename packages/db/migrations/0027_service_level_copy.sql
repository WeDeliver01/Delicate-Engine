-- Say what the two service levels actually are.
--
-- The old wording described On-demand as reaching the destination within 90 minutes, which is
-- a promise nothing in the engine makes or measures, and Standard as "arrives the same day",
-- which is true of every delivery we do and so distinguishes nothing. Both are the first thing
-- a customer reads, and the choice sets their price.
--
-- Only rows nobody has edited. `updated_at = created_at` is exactly "never changed since it
-- was seeded", so an operator who has reworded these in the console keeps their words.
UPDATE "service_levels"
SET "description" = 'Pre-scheduled. Book at least a day ahead and we collect and deliver on the day you choose, inside the time slot you pick.'
WHERE "code" = 'standard' AND "updated_at" = "created_at";
--> statement-breakpoint
UPDATE "service_levels"
SET "description" = 'Last minute. We collect and deliver today — a driver is dispatched as soon as you book and reaches the destination within 90 minutes.'
WHERE "code" = 'on_demand' AND "updated_at" = "created_at";
