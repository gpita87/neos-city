-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Per-tier offline placement stats
--
-- Adds columns to track top8, top4, runner-up, and wins for each offline
-- tournament tier (worlds, majors, regionals, locals/other).
-- Also adds a weighted offline_score for leaderboard ranking.
--
-- Safe to re-run (all columns use IF NOT EXISTS).
-- Run with: node run_migration.js backend/src/db/migrations/add_offline_tier_stats.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Worlds tier ───────────────────────────────────────────────────────────
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_worlds_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_worlds_runner_up INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_worlds_top4 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_worlds_top8 INTEGER NOT NULL DEFAULT 0;

-- ── Majors tier ───────────────────────────────────────────────────────────
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_major_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_major_runner_up INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_major_top4 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_major_top8 INTEGER NOT NULL DEFAULT 0;

-- ── Regionals tier ────────────────────────────────────────────────────────
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_regional_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_regional_runner_up INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_regional_top4 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_regional_top8 INTEGER NOT NULL DEFAULT 0;

-- ── Locals/Other tier ─────────────────────────────────────────────────────
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_other_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_other_runner_up INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_other_top4 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_other_top8 INTEGER NOT NULL DEFAULT 0;

-- ── Weighted offline score for leaderboard ranking ────────────────────────
-- Computed from placement×tier weights (see OFFLINE_WEIGHTS in code).
ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_score INTEGER NOT NULL DEFAULT 0;

-- ── Backfill from existing data ───────────────────────────────────────────
-- This UPDATE computes all per-tier stats and offline_score from the
-- tournament_placements + tournaments tables for every player who has
-- any offline placements.
UPDATE players p SET
  offline_worlds_wins     = COALESCE(s.worlds_wins, 0),
  offline_worlds_runner_up = COALESCE(s.worlds_runner_up, 0),
  offline_worlds_top4     = COALESCE(s.worlds_top4, 0),
  offline_worlds_top8     = COALESCE(s.worlds_top8, 0),
  offline_major_wins      = COALESCE(s.major_wins, 0),
  offline_major_runner_up = COALESCE(s.major_runner_up, 0),
  offline_major_top4      = COALESCE(s.major_top4, 0),
  offline_major_top8      = COALESCE(s.major_top8, 0),
  offline_regional_wins   = COALESCE(s.regional_wins, 0),
  offline_regional_runner_up = COALESCE(s.regional_runner_up, 0),
  offline_regional_top4   = COALESCE(s.regional_top4, 0),
  offline_regional_top8   = COALESCE(s.regional_top8, 0),
  offline_other_wins      = COALESCE(s.other_wins, 0),
  offline_other_runner_up = COALESCE(s.other_runner_up, 0),
  offline_other_top4      = COALESCE(s.other_top4, 0),
  offline_other_top8      = COALESCE(s.other_top8, 0),
  offline_score = COALESCE(
    -- Worlds: 1st=100, 2nd=60, top4=35, top8=20
    s.worlds_wins * 100 + s.worlds_runner_up * 60 + (s.worlds_top4 - s.worlds_runner_up - s.worlds_wins) * 35 + (s.worlds_top8 - s.worlds_top4) * 20
    -- Majors: 1st=50, 2nd=30, top4=18, top8=10
    + s.major_wins * 50 + s.major_runner_up * 30 + (s.major_top4 - s.major_runner_up - s.major_wins) * 18 + (s.major_top8 - s.major_top4) * 10
    -- Regionals: 1st=25, 2nd=15, top4=9, top8=5
    + s.regional_wins * 25 + s.regional_runner_up * 15 + (s.regional_top4 - s.regional_runner_up - s.regional_wins) * 9 + (s.regional_top8 - s.regional_top4) * 5
    -- Locals: 1st=10, 2nd=6, top4=3, top8=2
    + s.other_wins * 10 + s.other_runner_up * 6 + (s.other_top4 - s.other_runner_up - s.other_wins) * 3 + (s.other_top8 - s.other_top4) * 2
  , 0)
FROM (
  SELECT
    tp.player_id,
    -- Worlds
    COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank = 1) AS worlds_wins,
    COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank = 2) AS worlds_runner_up,
    COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank <= 4) AS worlds_top4,
    COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank <= 8) AS worlds_top8,
    -- Majors
    COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank = 1) AS major_wins,
    COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank = 2) AS major_runner_up,
    COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank <= 4) AS major_top4,
    COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank <= 8) AS major_top8,
    -- Regionals
    COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank = 1) AS regional_wins,
    COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank = 2) AS regional_runner_up,
    COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank <= 4) AS regional_top4,
    COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank <= 8) AS regional_top8,
    -- Other/Locals
    COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank = 1) AS other_wins,
    COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank = 2) AS other_runner_up,
    COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank <= 4) AS other_top4,
    COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank <= 8) AS other_top8
  FROM tournament_placements tp
  JOIN tournaments t ON tp.tournament_id = t.id
  WHERE t.is_offline = TRUE
  GROUP BY tp.player_id
) s
WHERE p.id = s.player_id;
