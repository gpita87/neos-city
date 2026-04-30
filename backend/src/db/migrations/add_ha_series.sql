-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_ha_series
-- Adds per-series stat columns for Heaven's Arena on the players table.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE players ADD COLUMN IF NOT EXISTS ha_entered  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ha_top4     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ha_wins     INTEGER NOT NULL DEFAULT 0;
