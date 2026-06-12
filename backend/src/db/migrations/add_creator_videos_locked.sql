-- Per-creator "don't auto-update recent videos" flag.
-- For channels whose recent uploads aren't relevant (e.g. a legacy Pokkén
-- creator who now posts other content), set videos_locked = TRUE and curate
-- their creator_videos rows by hand — the poller / refresh job skips them.
-- Run from the neos-city directory:
--   node run_migration.js backend/src/db/migrations/add_creator_videos_locked.sql
-- Idempotent — safe to re-run.

ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS videos_locked BOOLEAN NOT NULL DEFAULT FALSE;
