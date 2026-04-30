-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_tonamel_support
-- Adds Tonamel (ポッ拳ねずみ杯) as a third tournament source.
-- Also adds region tracking to players for NA/EU/JP leaderboard separation.
--
-- Run this in the Supabase SQL editor:
--   supabase.com/dashboard/project/xbeynvfupondrpepmmsi/sql/new
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Player region (NULL = unset, 'NA', 'EU', 'JP')
ALTER TABLE players ADD COLUMN IF NOT EXISTS region TEXT;

-- 2. Nezumi Cup (ねずみ杯) per-series stats
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS nezumi_entered         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nezumi_top4            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nezumi_wins            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nezumi_rookies_entered INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nezumi_rookies_top4    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nezumi_rookies_wins    INTEGER NOT NULL DEFAULT 0;

-- 3. Tonamel competition ID on the tournaments table
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tonamel_id TEXT;

-- 4. Unique index on tonamel_id (NULLs excluded so other-source rows are unaffected)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_tonamel_id
  ON tournaments(tonamel_id)
  WHERE tonamel_id IS NOT NULL;

-- 5. Index on region for leaderboard filtering
CREATE INDEX IF NOT EXISTS idx_players_region ON players(region);
