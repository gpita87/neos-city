-- Corrective migration for the Recent Achievements feed.
--
-- The previous backfill (`add_first_seen_at.sql`) set
--   first_seen_at = COALESCE(unlocked_at, TIMESTAMPTZ '2000-01-01')
--
-- That broke for any row whose unlocked_at was within the last 30 days
-- (e.g. TEC_XX's Kanto Trainer dated Apr 26): the row's first_seen_at
-- ended up recent too, so it kept appearing in /recent.
--
-- The intent of the column is "when was this row first INSERTED into the
-- DB", not "when did the player earn it". For all rows currently in the
-- table, we treat them as "old" and force their first_seen_at to a
-- fixed past date. Genuinely new unlocks added by future imports / recalcs
-- will get first_seen_at = NOW() via the column default, and the /recent
-- query (`first_seen_at >= NOW() - INTERVAL '30 days'`) will surface them.
--
-- Idempotent — safe to re-run. If a row's first_seen_at is already
-- '2000-01-01' or older, this is a no-op for it.

UPDATE player_achievements
SET first_seen_at = TIMESTAMPTZ '2000-01-01'
WHERE first_seen_at > TIMESTAMPTZ '2000-01-01'
  AND first_seen_at < NOW() - INTERVAL '30 minutes';
-- ^ The second condition guards against accidentally rewriting rows that
--   were just inserted by a fresh import / recalc (those will be NOW()-ish).
--   Anything older than 30 minutes is treated as pre-existing and reset.
