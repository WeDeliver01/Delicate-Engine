-- Give every existing account an address to be written to.
--
-- Nothing has ever written `accounts.billing_email`: it is read when a notification is
-- addressed and when an invoice is drawn, and set by nobody. A message with no address is
-- recorded as `suppressed` rather than failed, so the whole thing has been silently doing
-- nothing rather than visibly breaking.
--
-- New accounts now take the address of whoever created them. These are the ones already here.
UPDATE "accounts" a
SET "billing_email" = u."email"
FROM "memberships" m
JOIN "users" u ON u."id" = m."user_id"
WHERE m."account_id" = a."id"
  AND m."role" = 'customer_owner'
  AND a."billing_email" IS NULL
  -- The oldest owner, so an account with two of them is deterministic rather than whichever
  -- row the planner reached first.
  AND m."created_at" = (
    SELECT MIN(m2."created_at")
    FROM "memberships" m2
    WHERE m2."account_id" = a."id" AND m2."role" = 'customer_owner'
  );
