-- Allow player_achievements.unlocked_at to be NULL.
--
-- Background: when recalculate_elo.js can't derive a real date for an
-- achievement (e.g. the underlying tournaments have no completed_at), the
-- previous behaviour was to fall back to NOW(). That caused old achievements
-- to surface in the "Recent Achievements" feed as if they had just been
-- earned today. NULL is the correct sentinel for "we don't know when this
-- was unlocked"; the /recent endpoint and the front-end now filter / display
-- around it.
--
-- Idempotent — safe to re-run.

-- ── 1. Drop the NOT NULL constraint on unlocked_at ─────────────────────────
ALTER TABLE player_achievements
  ALTER COLUMN unlocked_at DROP NOT NULL;

-- ── 2. One-time cleanup: null out unlocks where the date came from the
--      NOW() fallback. We detect those rows by: the player has no
--      tournament_placement on the same calendar date as unlocked_at.
--      Every legitimate derived unlocked_at lines up with at least one
--      tournament the player attended; NOW()-fallback dates do not.
--
--      We only touch rows whose unlocked_at is within the last 7 days,
--      so we don't accidentally rewrite genuinely old hand-crafted dates.

UPDATE player_achievements pa
SET unlocked_at = NULL
WHERE pa.unlocked_at IS NOT NULL
  AND pa.unlocked_at >= NOW() - INTERVAL '7 days'
  AND NOT EXISTS (
    SELECT 1
    FROM tournament_placements tp
    JOIN tournaments t ON t.id = tp.tournament_id
    WHERE tp.player_id = pa.player_id
      AND t.completed_at::date = pa.unlocked_at::date
  );
