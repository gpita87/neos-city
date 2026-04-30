-- Offline tournament support (Liquipedia data)
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/xbeynvfupondrpepmmsi/sql/new

-- Add offline columns to tournaments
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS is_offline  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location    TEXT,
  ADD COLUMN IF NOT EXISTS prize_pool  TEXT,
  ADD COLUMN IF NOT EXISTS liquipedia_slug TEXT;

-- Partial unique index so multiple NULLs are allowed but non-NULL slugs must be unique
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_liquipedia_slug_unique
  ON tournaments (liquipedia_slug)
  WHERE liquipedia_slug IS NOT NULL;

-- Add offline stats to players
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS offline_wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offline_top2 INTEGER NOT NULL DEFAULT 0;
