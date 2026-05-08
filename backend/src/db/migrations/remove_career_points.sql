-- Drop the career points system. Wins/losses already convey the same idea,
-- and the point values were arbitrary. Idempotent.

DROP INDEX IF EXISTS idx_players_career_pts;

ALTER TABLE players              DROP COLUMN IF EXISTS career_points;
ALTER TABLE tournament_placements DROP COLUMN IF EXISTS career_points;
