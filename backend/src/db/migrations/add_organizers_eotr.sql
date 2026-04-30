-- Migration: Add organizers pool + End of the Road series stats
-- Run this in Supabase SQL Editor after previous migrations

-- Organizers pool — Challonge usernames/subdomains to sync from
CREATE TABLE IF NOT EXISTS organizers (
  id                  SERIAL PRIMARY KEY,
  challonge_username  TEXT UNIQUE NOT NULL,
  display_name        TEXT,
  notes               TEXT,          -- e.g. "FFC organizer", "RTG EU host"
  last_synced_at      TIMESTAMPTZ,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- End of the Road per-player stats
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS eotr_entered  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eotr_top4     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eotr_wins     INTEGER NOT NULL DEFAULT 0;

-- Index for syncing
CREATE INDEX IF NOT EXISTS idx_organizers_username ON organizers(challonge_username);
