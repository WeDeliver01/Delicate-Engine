-- Adds projects.stop_groupings used by dispatcher group/ungroup (Task #74).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS stop_groupings jsonb NOT NULL DEFAULT '{}'::jsonb;
