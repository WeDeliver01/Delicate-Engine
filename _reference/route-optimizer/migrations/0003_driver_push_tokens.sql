-- Driver push notification tokens (FCM for Android; APNs-via-FCM for iOS).
-- One row per (driver, device-token). Tokens are pruned on send when FCM
-- reports them unregistered/invalid.

CREATE TABLE IF NOT EXISTS driver_push_tokens (
  id                integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  driver_account_id integer NOT NULL,
  token             text    NOT NULL,
  platform          text    NOT NULL,
  app_version       text    DEFAULT '',
  last_seen_at      timestamp DEFAULT now() NOT NULL,
  created_at        timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_push_tokens_driver_token_uniq
  ON driver_push_tokens (driver_account_id, token);
