-- Tighten the liquipedia_url uniqueness to be case-insensitive.
--
-- Background: liquipedia_url originally stored a lowercased path key, which
-- was used both as a join key and as the user-clickable URL. Liquipedia is
-- case-sensitive, so the lowercased value 404s when followed in a browser
-- (e.g. /fighters/pokk%C3%A9n_tournament_dx/world_championships/2022/masters
-- vs the canonical /fighters/Pokk%C3%A9n_Tournament_DX/World_Championships/2022/Masters).
--
-- The application now stores canonical-case URLs and uses LOWER(...) on both
-- sides for lookups. This index swaps the literal-value uniqueness for a
-- LOWER()-based uniqueness so two rows with different casing cannot exist.
--
-- Idempotent: drops the old index by name (if present) and creates the new
-- one (if absent). The two indexes are mutually exclusive — only one needs
-- to exist at a time.

DROP INDEX IF EXISTS tournaments_liquipedia_url_unique;

CREATE UNIQUE INDEX IF NOT EXISTS tournaments_liquipedia_url_lower_unique
  ON tournaments (LOWER(liquipedia_url))
  WHERE liquipedia_url IS NOT NULL;
