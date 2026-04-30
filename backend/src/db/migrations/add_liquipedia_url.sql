-- Add canonical Liquipedia URL to tournaments for bracket import deduplication
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/xbeynvfupondrpepmmsi/sql/new

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS liquipedia_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tournaments_liquipedia_url_unique
  ON tournaments (liquipedia_url)
  WHERE liquipedia_url IS NOT NULL;
