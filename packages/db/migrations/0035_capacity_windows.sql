-- Monday to Saturday, 07:00 to 17:00, sold as two different widths of promise: Standard a
-- 4-hour window, Express a 2-hour one. A customer suggestion from a trusted bakery partner --
-- a narrower promise is what lets a batched run actually hold together.
--
-- Express is a new service level: add it. Standard's wording changes to say what the window
-- actually is now, guarded by the usual rule -- only a row nobody has touched since it was
-- seeded. On_demand's sort order moves to third, unconditionally: nothing in the console
-- lets an operator set sort order on its own, so there is no edit to respect here, only a
-- display order to fix -- Standard, Express, On-demand, cheapest and most notice required
-- to least.
INSERT INTO "service_levels"
  ("code", "name", "description", "multiplier_bps", "surcharge_cents", "requires_slot", "same_day_cutoff_minutes", "sort_order")
VALUES
  ('express', 'Express',
   'Pre-scheduled, on a tighter promise. Book at least a day ahead and we collect and deliver inside a 2-hour window you choose.',
   12500, 2000, true, 600, 2)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
UPDATE "service_levels"
SET "description" = 'Pre-scheduled. Book at least a day ahead and we collect and deliver inside a 4-hour window you choose.'
WHERE "code" = 'standard' AND "updated_at" = "created_at";
--> statement-breakpoint
UPDATE "service_levels"
SET "sort_order" = 3
WHERE "code" = 'on_demand' AND "sort_order" = 2;
--> statement-breakpoint
-- The slot policy itself: only where nobody has saved a change in Admin -> Capacity. A
-- database whose policy is already customised keeps exactly what its operator set -- this
-- is data-shaped the same way the policy already is, which is the one thing the console
-- lets an operator edit freely, so there is no "merge" to attempt here, only "replace or
-- leave alone".
UPDATE "settings"
SET "value" = '{
  "operatingDays": [1, 2, 3, 4, 5, 6],
  "windows": [
    { "key": "std_morning", "label": "Morning · 07:00 – 11:00", "startMinutes": 420, "endMinutes": 660, "capacity": 6, "serviceLevels": ["standard"] },
    { "key": "std_late_morning", "label": "Late morning · 09:00 – 13:00", "startMinutes": 540, "endMinutes": 780, "capacity": 6, "serviceLevels": ["standard"] },
    { "key": "std_midday", "label": "Midday · 11:00 – 15:00", "startMinutes": 660, "endMinutes": 900, "capacity": 6, "serviceLevels": ["standard"] },
    { "key": "std_afternoon", "label": "Afternoon · 13:00 – 17:00", "startMinutes": 780, "endMinutes": 1020, "capacity": 6, "serviceLevels": ["standard"] },
    { "key": "exp_super_early", "label": "Super early · 07:00 – 09:00", "startMinutes": 420, "endMinutes": 540, "capacity": 3, "serviceLevels": ["express", "on_demand"] },
    { "key": "exp_morning", "label": "Morning · 09:00 – 11:00", "startMinutes": 540, "endMinutes": 660, "capacity": 3, "serviceLevels": ["express", "on_demand"] },
    { "key": "exp_brunch", "label": "Brunch · 11:00 – 13:00", "startMinutes": 660, "endMinutes": 780, "capacity": 3, "serviceLevels": ["express", "on_demand"] },
    { "key": "exp_lunch", "label": "Lunch · 13:00 – 15:00", "startMinutes": 780, "endMinutes": 900, "capacity": 3, "serviceLevels": ["express", "on_demand"] },
    { "key": "exp_late_afternoon", "label": "Late afternoon · 15:00 – 17:00", "startMinutes": 900, "endMinutes": 1020, "capacity": 3, "serviceLevels": ["express", "on_demand"] }
  ],
  "defaultCapacity": 4,
  "minLeadDays": 1,
  "cutoffMinutesBefore": 120,
  "horizonDays": 180,
  "healthLimitedBelowBps": 3000,
  "timedWindow": { "enabled": false, "bandMinutes": 60, "minMinutes": 60, "maxMinutes": 120, "capacityPerBand": 0 }
}'::jsonb
WHERE "key" = 'scheduling.policy' AND "updated_at" = "created_at";
