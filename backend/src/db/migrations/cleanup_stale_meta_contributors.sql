-- Cleanup stale rows in achievement_defeated_opponents.
--
-- Background: meta achievements (8 Badges, Elite Trainer, Rival Battle,
-- Smell Ya Later, Foreshadowing, Dark Horse) record the unique opponents
-- whose qualifying tier+region "contributed" to the unlock. When the recalc
-- moved from DELETE-then-INSERT to additive `INSERT ... ON CONFLICT DO
-- NOTHING` (Apr 30 2026), historical rows from earlier qualifier logic
-- stopped being cleaned up — leaving e.g. Kanto-only Champions sitting in
-- the contributor list for a `dark_horse_kalos` achievement, which the
-- frontend modal then surfaces as "qualifying opponents". They aren't.
--
-- This migration deletes any contributor row whose opponent does NOT
-- currently hold a qualifying achievement at-or-above the achievement's
-- region tier. Applies only to meta achievements; placement / participation
-- achievements don't use this table.
--
-- Idempotent — safe to re-run. After the first run, "stale" simply means
-- "logic shifted again and the opponent stopped qualifying"; rare.

WITH region_order(region, idx) AS (
  VALUES
    ('kanto'::text,  1),
    ('johto',        2),
    ('hoenn',        3),
    ('sinnoh',       4),
    ('unova',        5),
    ('kalos',        6),
    ('alola',        7),
    ('galar',        8),
    ('paldea',       9)
),
target_tier_lookup(meta_prefix, target_tier) AS (
  VALUES
    ('eight_badges'::text,   'gym_leader'::text),
    ('elite_trainer',        'elite_four'),
    ('rival_battle',         'rival'),
    ('smell_ya_later',       'rival'),
    ('foreshadowing',        'champion'),
    ('dark_horse',           'champion')
),
-- Decompose each contributor's achievement_id into its meta_prefix +
-- achievement region. The region is the last `_`-separated segment; the
-- prefix is everything before it. We use regexp_replace + split_part so
-- LIKE-vs-underscore wildcard issues never come up.
parsed AS (
  SELECT
    ado.player_id,
    ado.achievement_id,
    ado.opponent_id,
    ado.match_id,
    -- last segment, e.g. 'kalos'
    split_part(
      ado.achievement_id,
      '_',
      array_length(string_to_array(ado.achievement_id, '_'), 1)
    ) AS achievement_region,
    -- everything before the last underscore, e.g. 'dark_horse'
    regexp_replace(ado.achievement_id, '_[^_]+$', '') AS meta_prefix
  FROM achievement_defeated_opponents ado
),
-- Map each row to its target placement tier; rows whose meta_prefix isn't
-- in our lookup list are silently ignored (no DELETE).
classified AS (
  SELECT p.*, ttl.target_tier
  FROM parsed p
  JOIN target_tier_lookup ttl ON ttl.meta_prefix = p.meta_prefix
),
-- For each contributor row, check whether the opponent currently holds a
-- `global_<target_tier>_<region>` achievement at or above the achievement's
-- own region tier. We use the region_order indices to compare.
qualifying_check AS (
  SELECT
    c.player_id,
    c.achievement_id,
    c.opponent_id,
    c.match_id,
    EXISTS (
      SELECT 1
      FROM player_achievements pa_opp
      JOIN region_order ach_order ON ach_order.region = c.achievement_region
      JOIN region_order opp_order ON
        ('global_' || c.target_tier || '_' || opp_order.region) = pa_opp.achievement_id
      WHERE pa_opp.player_id = c.opponent_id
        AND opp_order.idx >= ach_order.idx
    ) AS still_qualifies
  FROM classified c
)
DELETE FROM achievement_defeated_opponents ado
USING qualifying_check qc
WHERE ado.player_id     = qc.player_id
  AND ado.achievement_id = qc.achievement_id
  AND ado.opponent_id    = qc.opponent_id
  AND COALESCE(ado.match_id, -1) = COALESCE(qc.match_id, -1)
  AND qc.still_qualifies = FALSE;

-- Diagnostic: how many rows remain after cleanup.
DO $$
DECLARE
  total INTEGER;
BEGIN
  SELECT COUNT(*) INTO total FROM achievement_defeated_opponents;
  RAISE NOTICE 'achievement_defeated_opponents now holds % rows', total;
END $$;
