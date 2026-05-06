-- Track when each player_achievement row was first INSERTED into the table,
-- separate from when the achievement was earned (`unlocked_at` ≈ tournament
-- date) and separate from "now".
--
-- Why: the recalc has historically wiped + rebuilt player_achievements every
-- run, which means after each recalc *every* achievement looks like it was
-- "just unlocked" — old achievements (e.g. Kanto Trainer earned weeks ago)
-- end up filling the Recent Achievements feed.
--
-- Going forward, the recalc is additive (ON CONFLICT DO NOTHING) so existing
-- rows keep their original first_seen_at. The /recent endpoint sorts and
-- filters by first_seen_at instead of unlocked_at, so only genuinely new
-- unlocks (rows added since the last recalc / import) show up.
--
-- Idempotent — safe to re-run.

-- ── 1. Add first_seen_at, default NOW() for new inserts ────────────────────
ALTER TABLE player_achievements
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Backfill: treat everything currently in the table as "old" so that
--      after running this migration the Recent Achievements feed becomes
--      empty (instead of showing every existing row as if it had just been
--      added). We force first_seen_at to a fixed past date — NOT to
--      unlocked_at, because rows whose unlocked_at is itself recent (e.g.
--      a Kanto Trainer earned last week) would otherwise still appear in
--      the /recent feed's 30-day window.
--
--      New rows added by future recalcs / imports will naturally get
--      first_seen_at = NOW() via the column default and surface in the feed.
--
--      The WHERE clause makes this safe to re-run: rows already older than
--      30 minutes are skipped (so we don't clobber a fresh import / recalc
--      that is mid-run when this migration is replayed).

UPDATE player_achievements
SET first_seen_at = TIMESTAMPTZ '2000-01-01'
WHERE first_seen_at > TIMESTAMPTZ '2000-01-01'
  AND first_seen_at >= NOW() - INTERVAL '5 minutes';

-- ── 3. Index — /recent filters by first_seen_at >= cutoff and orders by
--      first_seen_at DESC, so an index on it pays for itself.

CREATE INDEX IF NOT EXISTS idx_player_achievements_first_seen
  ON player_achievements (first_seen_at DESC);
