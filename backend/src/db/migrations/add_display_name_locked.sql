-- add_display_name_locked.sql
--
-- Adds a per-player flag that prevents tournament importers from
-- overwriting display_name on ON CONFLICT DO UPDATE.
--
-- Background: the Challonge / start.gg / Tonamel importers in
-- backend/src/routes/tournaments.js previously did
--   ON CONFLICT (challonge_username) DO UPDATE SET display_name = EXCLUDED.display_name
-- unconditionally, so any time a participant entered a bracket under a
-- different visible name than they'd used before — even if they kept the
-- same Challonge handle — our row's display_name got clobbered.
-- (Smoking-gun example: row id=4824 @allisterfgc whose display_name
-- ended up reading "BadIntent" because a participant on that account
-- used that bracket name in one tournament.)
--
-- After this column exists, the importers honor it via:
--   display_name = CASE WHEN players.display_name_locked
--                       THEN players.display_name
--                       ELSE EXCLUDED.display_name END
-- and set_display_name.js sets the flag to TRUE whenever you rename
-- a row manually, so future imports leave the rename alone.
--
-- Idempotent — safe to re-run.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS display_name_locked BOOLEAN NOT NULL DEFAULT FALSE;
