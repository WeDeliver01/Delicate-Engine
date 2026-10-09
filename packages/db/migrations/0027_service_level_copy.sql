-- Say what the two service levels actually are.
--
-- The old wording promised On-demand would reach the destination within 90 minutes. Nothing in
-- the engine measures that and the business does not undertake it, so it was a promise made on
-- a booking form and kept nowhere. Standard said "arrives the same day", which is true of every
-- delivery we do and so distinguishes nothing. Both are the first thing a customer reads.
--
-- Only rows nobody has edited. `updated_at = created_at` is exactly "never changed since it
-- was seeded", so an operator who has reworded these in the console keeps their words.
UPDATE "service_levels"
SET "description" = 'Pre-scheduled. Book at least a day ahead and we collect and deliver on the day you choose, inside the time slot you pick.'
WHERE "code" = 'standard' AND "updated_at" = "created_at";
--> statement-breakpoint
UPDATE "service_levels"
SET "description" = 'Last minute. We collect and deliver today — a driver is dispatched as soon as you book.'
WHERE "code" = 'on_demand' AND "updated_at" = "created_at";
