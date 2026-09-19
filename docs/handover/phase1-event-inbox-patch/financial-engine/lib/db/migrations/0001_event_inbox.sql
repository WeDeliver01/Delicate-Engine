-- 0001_event_inbox.sql
-- Phase 1 (Event Foundation): the inbox table that fronts all event ingest.
-- Idempotent: safe to run repeatedly. In dev you can also just run
--   pnpm --filter @workspace/db run push
-- but keep this file as the production-applied, reviewable source of truth.

CREATE TABLE IF NOT EXISTS event_inbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL,
  event_type    text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  source        text NOT NULL DEFAULT 'route-optimizer',
  dedupe_key    text NOT NULL,
  occurred_at   timestamptz NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'received',
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

-- Dedupe layer 1: one row per emission.
CREATE UNIQUE INDEX IF NOT EXISTS event_inbox_event_id_uniq ON event_inbox (event_id);
-- Dedupe layer 2: one row per real-world business fact.
CREATE UNIQUE INDEX IF NOT EXISTS event_inbox_dedupe_key_uniq ON event_inbox (dedupe_key);

CREATE INDEX IF NOT EXISTS event_inbox_status_idx ON event_inbox (status);
CREATE INDEX IF NOT EXISTS event_inbox_type_idx ON event_inbox (event_type);
