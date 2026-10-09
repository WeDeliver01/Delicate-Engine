-- The house account walk-in work is booked under.
--
-- Ops take a delivery over the phone or at the door from somebody who has no account. The
-- parcel is real and has to move now; making them an account first is a form to fill in that
-- nobody will come back to. But a booking charges a wallet and a wallet hangs off an account,
-- so the work needs one to belong to -- and this is it, with a fixed id so every environment
-- has the same account rather than one per database that nothing can refer to.
--
-- Postpaid with a credit limit, because the gate on a booking is
-- balance + credit - holds, and a house account holds no float: without the limit every
-- walk-in would need the overdraw override. The cash or card goes on as a top-up afterwards
-- and the balance returns to zero. Ops can change the limit in the console.
INSERT INTO "accounts" ("id", "organization_id", "name", "type", "billing_mode", "billing_email", "status")
VALUES (
  '00000000-0000-4000-8000-000000000001',
  NULL,
  'Walk-in (ad hoc)',
  'individual',
  'postpaid',
  -- No customer to write to, so the waybill email goes to us. Change it in the console if
  -- ops would rather it landed somewhere else; leaving it null means nothing is sent at all.
  'admin@delicatecourier.co.za',
  'active'
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "wallets" ("account_id", "credit_limit_cents", "payment_terms_days")
VALUES ('00000000-0000-4000-8000-000000000001', 5000000, 0)
ON CONFLICT ("account_id") DO NOTHING;
