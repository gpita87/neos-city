-- Backfill achievement_defeated_opponents.match_id for meta achievement
-- contributor rows that landed with NULL match_id.
--
-- Why: the recalc went additive (`INSERT ... ON CONFLICT DO NOTHING`) on
-- Apr 30 2026. Rows written before match_id was tracked reliably therefore
-- stayed NULL on every subsequent recalc, so the modal couldn't link the
-- qualifying match for those opponents (Elite Trainer was a clear
-- offender — every opponent showed "Match context unavailable").
--
-- Strategy: for each NULL-match_id row, decode the meta type from the
-- achievement_id, then pick the earliest completed match between
-- (player_id, opponent_id) that satisfies that meta type's win condition:
--
--   match-mode (eight_badges, elite_trainer, smell_ya_later, dark_horse)
--     → m.winner_id = player_id
--   game-mode  (rival_battle, foreshadowing)
--     → player_id took at least one game in the match
--
-- The PRIMARY KEY on (player_id, achievement_id, opponent_id) means the
-- UPDATE doesn't conflict with the existing row — match_id just goes from
-- NULL to a real ID. Idempotent: re-running matches no rows once filled.
--
-- Rows without ANY qualifying match between the pair are left as-is
-- (match_id stays NULL); those typically come from offline tournament
-- imports where individual matches weren't recorded.

WITH meta_modes(meta_prefix, mode_kind) AS (
  VALUES
    ('eight_badges'::text,   'match'::text),
    ('elite_trainer',        'match'),
    ('rival_battle',         'game'),
    ('smell_ya_later',       'match'),
    ('foreshadowing',        'game'),
    ('dark_horse',           'match')
),
candidates AS (
  SELECT
    ado.player_id,
    ado.achievement_id,
    ado.opponent_id,
    mm.mode_kind
  FROM achievement_defeated_opponents ado
  JOIN meta_modes mm
    ON regexp_replace(ado.achievement_id, '_[^_]+$', '') = mm.meta_prefix
  WHERE ado.match_id IS NULL
),
chosen_matches AS (
  SELECT
    c.player_id,
    c.achievement_id,
    c.opponent_id,
    mch.id AS match_id
  FROM candidates c
  JOIN LATERAL (
    SELECT m.id
    FROM matches m
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE m.winner_id IS NOT NULL
      AND (
        (m.player1_id = c.player_id AND m.player2_id = c.opponent_id)
        OR
        (m.player2_id = c.player_id AND m.player1_id = c.opponent_id)
      )
      AND CASE
        WHEN c.mode_kind = 'match'
          THEN m.winner_id = c.player_id
        ELSE
          (m.player1_id = c.player_id AND m.player1_score >= 1)
          OR
          (m.player2_id = c.player_id AND m.player2_score >= 1)
      END
    ORDER BY t.completed_at ASC NULLS LAST, m.id ASC
    LIMIT 1
  ) mch ON TRUE
)
UPDATE achievement_defeated_opponents ado
SET match_id = cm.match_id
FROM chosen_matches cm
WHERE ado.player_id      = cm.player_id
  AND ado.achievement_id = cm.achievement_id
  AND ado.opponent_id    = cm.opponent_id
  AND ado.match_id IS NULL;

-- Diagnostic: how many contributor rows still lack a match_id after the
-- backfill (these are the offline-import remnants — no per-match data).
DO $$
DECLARE
  remaining INTEGER;
  total     INTEGER;
BEGIN
  SELECT COUNT(*) INTO total FROM achievement_defeated_opponents;
  SELECT COUNT(*) INTO remaining
    FROM achievement_defeated_opponents
    WHERE match_id IS NULL;
  RAISE NOTICE
    'achievement_defeated_opponents: % total rows, % still NULL match_id',
    total, remaining;
END $$;
