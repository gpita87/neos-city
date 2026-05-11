-- Partial-tournament support.
--
-- A Challonge tournament can be in a "matches played but bracket not yet
-- finalized" state when an organizer holds the top placements back to stream
-- them (RTG NA does this every cycle — top 4 results aren't revealed until
-- the post-match stream). Before this flag existed, importing those produced
-- a stub with NULL completed_at and every placement at rank=null. Now the
-- importer derives placements for eliminated players (weight = bracket-round
-- position), leaves still-alive players with final_rank=NULL, and marks the
-- tournament `is_partial = TRUE`. ELO placement bonuses, per-player stats,
-- and achievements are skipped on partial imports — re-import after finalize
-- fills them in correctly. The UI uses this flag to render a "TOP N UNREVEALED"
-- banner and label null-rank placements as "Top N".

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS is_partial BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_tournaments_is_partial
  ON tournaments (is_partial)
  WHERE is_partial = TRUE;
