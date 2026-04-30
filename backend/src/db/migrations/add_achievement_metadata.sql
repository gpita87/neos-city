-- Add achievement metadata: tournament context + defeated opponent tracking
--
-- 1. player_achievements.tournament_id — which tournament triggered the unlock
-- 2. achievement_defeated_opponents    — per-opponent evidence for meta & match-based achievements
--
-- Idempotent — safe to re-run.

-- ── 1. Add tournament_id to player_achievements ─────────────────────────────

ALTER TABLE player_achievements
  ADD COLUMN IF NOT EXISTS tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL;

-- ── 2. Defeated-opponent evidence table ─────────────────────────────────────
--
-- For meta achievements (8 Badges, Elite Trainer): stores each unique qualifying
-- opponent that the player defeated.  "opponent_id" is the Gym Leader / Elite Four
-- member whose defeat counted toward the achievement.
--
-- For match-based achievements (Rival Battle, Smell Ya Later, Foreshadowing,
-- Dark Horse): stores the opponent + specific match where the qualifying
-- interaction occurred.
--
-- match_id is nullable because meta achievements track unique opponents across
-- all matches, not a single specific match.

CREATE TABLE IF NOT EXISTS achievement_defeated_opponents (
  player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id  TEXT    NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  opponent_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id        INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, achievement_id, opponent_id)
);

-- Index for looking up all contributors to a specific player's achievement
CREATE INDEX IF NOT EXISTS idx_ado_player_achievement
  ON achievement_defeated_opponents (player_id, achievement_id);

-- Index for "which achievements did this opponent contribute to?" queries
CREATE INDEX IF NOT EXISTS idx_ado_opponent
  ON achievement_defeated_opponents (opponent_id);
