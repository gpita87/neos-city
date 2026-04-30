-- Achievement Revamp Migration
-- Adds runner_up and top8 tracking columns needed for the new region-tier system.
-- Safe to re-run (IF NOT EXISTS / idempotent).

-- ── Global runner-up count ────────────────────────────────────────────────────
ALTER TABLE players ADD COLUMN IF NOT EXISTS runner_up_finishes INTEGER NOT NULL DEFAULT 0;

-- ── Per-series top8 and runner_up columns ─────────────────────────────────────
-- FFC
ALTER TABLE players ADD COLUMN IF NOT EXISTS ffc_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ffc_runner_up INTEGER NOT NULL DEFAULT 0;

-- RTG NA
ALTER TABLE players ADD COLUMN IF NOT EXISTS rtg_na_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS rtg_na_runner_up INTEGER NOT NULL DEFAULT 0;

-- RTG EU
ALTER TABLE players ADD COLUMN IF NOT EXISTS rtg_eu_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS rtg_eu_runner_up INTEGER NOT NULL DEFAULT 0;

-- DCM
ALTER TABLE players ADD COLUMN IF NOT EXISTS dcm_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS dcm_runner_up INTEGER NOT NULL DEFAULT 0;

-- TCC
ALTER TABLE players ADD COLUMN IF NOT EXISTS tcc_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS tcc_runner_up INTEGER NOT NULL DEFAULT 0;

-- EOTR
ALTER TABLE players ADD COLUMN IF NOT EXISTS eotr_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS eotr_runner_up INTEGER NOT NULL DEFAULT 0;

-- Nezumi (Mouse Cup)
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_runner_up INTEGER NOT NULL DEFAULT 0;

-- Heaven's Arena
ALTER TABLE players ADD COLUMN IF NOT EXISTS ha_top8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ha_runner_up INTEGER NOT NULL DEFAULT 0;

-- ── Clear old achievements and player_achievements for clean re-seed ──────────
-- (The recalculate_elo script will re-award all achievements from scratch.)
DELETE FROM player_achievements;
DELETE FROM achievements;
