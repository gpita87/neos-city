-- Fix missing nezumi_rookies top8/runner_up columns
-- The achievement_revamp migration missed these two columns.
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_rookies_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_rookies_runner_up INTEGER NOT NULL DEFAULT 0;
