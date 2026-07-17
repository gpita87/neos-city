-- Real Pokkén Group details (replaces the M1 placeholders) + support for
-- community-added groups.
-- Run: node run_migration.js backend/src/db/migrations/add_group_details.sql
--
--   • ingame_id — the in-game Group ID, stored digits-only (display formatting
--     is a UI concern). Unique when present.
--   • password  — the in-game Group password. Community-public by convention
--     (it's how people join), but only admins may SET one through the API so
--     casual users are never prompted to hand over a password.
--   • has_room  — admin-maintained flag: groups cap at 100 members in-game and
--     fill up over time; unticked = full, don't bother trying to join.
--
-- Idempotent — safe to re-run. On re-run, existing rows keep any ingame_id/
-- password already set (COALESCE) and has_room is NOT clobbered (admins toggle
-- it live from the UI).

ALTER TABLE pokken_groups ADD COLUMN IF NOT EXISTS ingame_id TEXT;
ALTER TABLE pokken_groups ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE pokken_groups ADD COLUMN IF NOT EXISTS has_room BOOLEAN NOT NULL DEFAULT TRUE;

-- Groups expire in-game over time. Any signed-in player may mark one
-- expired/do-not-use (and unmark, e.g. after the owner extends it) —
-- community-maintained, with a marked-by audit trail. Expired groups stay
-- visible in the picker (badged) but are never suggested for matches.
ALTER TABLE pokken_groups ADD COLUMN IF NOT EXISTS expired BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pokken_groups ADD COLUMN IF NOT EXISTS expired_marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE pokken_groups ADD COLUMN IF NOT EXISTS expired_marked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS pokken_groups_ingame_id_unique
  ON pokken_groups (ingame_id) WHERE ingame_id IS NOT NULL;

-- Rename the M1 placeholders to the real Neos City groups so any existing
-- memberships carry over (guarded so a re-run after the real rows exist no-ops).
UPDATE pokken_groups SET name = 'Neos City 1'
  WHERE name = 'Neos City Arena 1'
    AND NOT EXISTS (SELECT 1 FROM pokken_groups WHERE name = 'Neos City 1');
UPDATE pokken_groups SET name = 'Neos City 2'
  WHERE name = 'Neos City Arena 2'
    AND NOT EXISTS (SELECT 1 FROM pokken_groups WHERE name = 'Neos City 2');
UPDATE pokken_groups SET name = 'Neos City 3'
  WHERE name = 'Neos City Arena 3'
    AND NOT EXISTS (SELECT 1 FROM pokken_groups WHERE name = 'Neos City 3');

-- Official Neos City groups (Gabriel's; expire 2026-10-15 unless extended).
-- 'Neos City 3' really is 13 digits (join-verified in-game); the rest are 14.
INSERT INTO pokken_groups (name, is_official, ingame_id, password, has_room, ruleset) VALUES
  ('Neos City 1', TRUE, '39157245790558', 'yup909', TRUE, '{"arena": "fixed", "skill_points": "off", "note": "standard competitive rules"}'),
  ('Neos City 2', TRUE, '17553560291691', 'yup909', TRUE, '{"arena": "fixed", "skill_points": "off", "note": "standard competitive rules"}'),
  ('Neos City 3', TRUE, '1395893324178',  'yup909', TRUE, '{"arena": "fixed", "skill_points": "off", "note": "standard competitive rules"}'),
  ('Neos City 4', TRUE, '14718881876377', 'yup909', TRUE, '{"arena": "fixed", "skill_points": "off", "note": "standard competitive rules"}')
ON CONFLICT (name) DO UPDATE SET
  ingame_id = COALESCE(pokken_groups.ingame_id, EXCLUDED.ingame_id),
  password  = COALESCE(pokken_groups.password,  EXCLUDED.password),
  is_official = EXCLUDED.is_official;

-- Community groups with room to join.
INSERT INTO pokken_groups (name, is_official, ingame_id, password, has_room, ruleset) VALUES
  ('braxhouse',        FALSE, '33904496640536', '6531', TRUE, '{}'),
  ('Fix Aqua Jet UwU', FALSE, '31164301431913', 'owo',  TRUE, '{}')
ON CONFLICT (name) DO UPDATE SET
  ingame_id = COALESCE(pokken_groups.ingame_id, EXCLUDED.ingame_id),
  password  = COALESCE(pokken_groups.password,  EXCLUDED.password);

-- Known-full community groups (has_room = FALSE): people may already be in
-- these, so they're pickable for shared-group matching — just not joinable.
INSERT INTO pokken_groups (name, is_official, ingame_id, password, has_room, ruleset) VALUES
  ('Shadowcats group', FALSE, '15247144848611', NULL, FALSE, '{}'),
  ('YaStream',         FALSE, '64119589319850', NULL, FALSE, '{}'),
  ('Cinder Haven',     FALSE, '39835846571505', NULL, FALSE, '{}'),
  ('Jin''s Stream',    FALSE, '63930591703425', NULL, FALSE, '{}')
ON CONFLICT (name) DO UPDATE SET
  ingame_id = COALESCE(pokken_groups.ingame_id, EXCLUDED.ingame_id);

-- Not seeded (no ids yet): Devcord, Dev tea — add via the in-app
-- "add a group" form once the ids are known.
