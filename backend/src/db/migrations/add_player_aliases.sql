-- Player aliases table for handling name changes / deduplication
-- An alias maps an old username to a canonical (current) username.
-- During import, the system checks this table before creating/matching players.

CREATE TABLE IF NOT EXISTS player_aliases (
  id              SERIAL PRIMARY KEY,
  alias_username  TEXT UNIQUE NOT NULL,   -- the old / alternate name (lowercase)
  canonical_username TEXT NOT NULL,        -- the current name to map to (lowercase)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups during import
CREATE INDEX IF NOT EXISTS idx_player_aliases_alias ON player_aliases (alias_username);

-- Seed: ThankSwalot → Jukem
INSERT INTO player_aliases (alias_username, canonical_username)
VALUES ('thankswalot', 'jukem')
ON CONFLICT (alias_username) DO NOTHING;
