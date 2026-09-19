-- In-app inbox of recent push notifications shown to drivers on their
-- dashboard so they can catch up on assignment / route-change / reorder /
-- stop-cancelled / dispatcher-message alerts they may have missed (phone off,
-- DND, OS dropped the banner). Each row mirrors a push fired via
-- sendToDriver / sendToDriverByName, regardless of FCM delivery outcome.
-- Rows older than ~14 days are pruned by a daily background job.

CREATE TABLE IF NOT EXISTS driver_notifications (
  id                integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  driver_account_id integer NOT NULL,
  kind              text    NOT NULL,
  title             text    NOT NULL DEFAULT '',
  body              text    NOT NULL DEFAULT '',
  data              jsonb   NOT NULL DEFAULT '{}'::jsonb,
  read_at           timestamp,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_notifications_driver_created_idx
  ON driver_notifications (driver_account_id, created_at);
