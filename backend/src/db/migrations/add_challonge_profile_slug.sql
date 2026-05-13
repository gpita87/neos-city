-- Capture the real Challonge profile-page slug separately from challonge_username.
-- challonge_username falls back to a slugified display_name when a participant
-- entered a tournament as a guest (no linked Challonge account), so it is not
-- a reliable URL slug. challonge_profile_slug is populated only when the v1
-- API returns a non-empty challonge_username on the participant row, so a
-- non-NULL value here means "this user has a challonge.com/users/<slug> page".

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS challonge_profile_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_players_challonge_profile_slug
  ON players (challonge_profile_slug)
  WHERE challonge_profile_slug IS NOT NULL;
