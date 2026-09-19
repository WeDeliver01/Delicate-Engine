-- Explicit driver online presence + Ops-initiated "force-online" fallback.
-- onlineSince records when the driver last went online (driver- or ops-initiated
-- or via a live location ping). The ops_online_* fields track a pending
-- dispatcher request that the driver must confirm on their phone before going
-- live, so a driver can be placed online even when their app's location flow is
-- broken.
ALTER TABLE driver_accounts
  ADD COLUMN IF NOT EXISTS online_since timestamp,
  ADD COLUMN IF NOT EXISTS ops_online_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ops_online_requested_at timestamp,
  ADD COLUMN IF NOT EXISTS ops_online_requested_by text;
