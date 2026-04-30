-- Migration: Add series tracking
-- Run this in Supabase SQL Editor if you already ran the original schema.sql
-- (Safe to run multiple times — uses IF NOT EXISTS / DO NOTHING)

-- Add series column to tournaments
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS series TEXT DEFAULT 'other';

-- Add series column to achievements (missing from original schema)
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS series TEXT;

-- Add per-series stats to players
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS ffc_entered        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ffc_top4           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ffc_wins           INTEGER NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS rtg_na_entered     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rtg_na_top4        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rtg_na_wins        INTEGER NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS rtg_eu_entered     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rtg_eu_top4        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rtg_eu_wins        INTEGER NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS dcm_entered        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dcm_top4           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dcm_wins           INTEGER NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS tcc_entered        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcc_top4           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcc_wins           INTEGER NOT NULL DEFAULT 0,

  -- Special achievement trackers
  ADD COLUMN IF NOT EXISTS games_taken_from_champions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top5_upsets                INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comebacks                  INTEGER NOT NULL DEFAULT 0;
