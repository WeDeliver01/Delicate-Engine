-- Add the account code in three steps rather than one.
--
-- Drizzle's own version of this adds the column NOT NULL in a single statement, which cannot
-- work against a table that already has rows: there is nothing to put in it. So the column
-- arrives nullable, every existing account is given a code, and only then is the constraint
-- applied.
--
-- The backfill mirrors what the application does for a new account: three letters from the
-- name, uppercased, padded with X when the name is shorter than that, then a per-prefix
-- counter in creation order so the oldest "Honey Bee Baker" is HBB001.
ALTER TABLE "accounts" ADD COLUMN "code" text;--> statement-breakpoint

WITH ranked AS (
  SELECT
    id,
    upper(left(regexp_replace(coalesce(name, ''), '[^a-zA-Z]', '', 'g') || 'XXX', 3)) AS prefix,
    row_number() OVER (
      PARTITION BY upper(left(regexp_replace(coalesce(name, ''), '[^a-zA-Z]', '', 'g') || 'XXX', 3))
      ORDER BY created_at, id
    ) AS n
  FROM "accounts"
)
UPDATE "accounts" a
SET "code" = ranked.prefix || lpad(ranked.n::text, 3, '0')
FROM ranked
WHERE ranked.id = a.id;--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_uq" ON "accounts" USING btree ("code");
