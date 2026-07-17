-- Editable Pokkén in-game name (Arena M2).
-- Run: node run_migration.js backend/src/db/migrations/add_ingame_name.sql
--
-- Players change their in-game name over time, and an arena opponent needs it
-- to verify they matched the RIGHT player inside a Pokkén Group. Freely
-- editable via PATCH /api/auth/me; the match panel shows it as
-- "In game, look for: <ingame_name>", falling back to display name if unset.
-- Idempotent — safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS ingame_name TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ingame_name_len;
ALTER TABLE users ADD CONSTRAINT users_ingame_name_len
  CHECK (ingame_name IS NULL OR char_length(ingame_name) BETWEEN 1 AND 40);
