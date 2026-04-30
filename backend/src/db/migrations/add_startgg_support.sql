-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_startgg_support
-- Adds start.gg as a second tournament source alongside Challonge.
--
-- Run this in the Supabase SQL editor:
--   supabase.com/dashboard/project/xbeynvfupondrpepmmsi/sql/new
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Make challonge_id nullable so start.gg-only tournaments can be inserted.
--    PostgreSQL UNIQUE already allows multiple NULLs, so no constraint change needed.
ALTER TABLE tournaments ALTER COLUMN challonge_id DROP NOT NULL;

-- 2. Track where each tournament was sourced from.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'challonge';

-- 3. start.gg identifiers pulled from the bracket URL:
--    https://www.start.gg/tournament/{slug}/events/{event}/brackets/{phaseId}/{phaseGroupId}
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS startgg_slug           TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS startgg_phase_group_id TEXT;

-- 4. Unique index on phase_group_id (NULLs are excluded so Challonge rows are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_startgg_phase_group
  ON tournaments(startgg_phase_group_id)
  WHERE startgg_phase_group_id IS NOT NULL;

-- 5. Index on source for filtering.
CREATE INDEX IF NOT EXISTS idx_tournaments_source ON tournaments(source);
