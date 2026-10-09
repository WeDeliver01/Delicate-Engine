-- Let customers book further ahead than a fortnight.
--
-- The schedule only ever offered 14 days, which is fine for a cake on Thursday and useless for
-- a wedding in March. Six months is the new default.
--
-- Only where the value is still the seeded 14: this lives inside the scheduling policy, which
-- an operator edits as a whole in the console, and a horizon somebody has already chosen is
-- their decision.
UPDATE "settings"
SET "value" = jsonb_set("value", '{horizonDays}', '180')
WHERE "key" = 'scheduling.policy'
  AND "value" -> 'horizonDays' = '14';
