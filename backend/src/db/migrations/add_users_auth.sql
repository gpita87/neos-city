-- User accounts + account-linking (groundwork for the future ranked ladder).
-- Run in Supabase SQL editor, or: node run_migration.js backend/src/db/migrations/add_users_auth.sql
--
-- Supports three kinds of user:
--   • email-only    (password_hash set, discord_id NULL)
--   • discord-only  (discord_id set, password_hash NULL)
--   • hybrid is NOT auto-created — we never silently merge a Discord login onto
--     an existing email account (see routes/auth.js). Explicit method-linking is
--     a future, authenticated flow.
--
-- Linking model: a user claims at most one player (single player_id column);
-- a player is claimed by at most one user (users_player_id_unique). First-come.

CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  email            TEXT,                                    -- nullable: discord-only users may lack one
  password_hash    TEXT,                                    -- nullable: discord-only users have no password
  email_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  discord_id       TEXT,                                    -- nullable: email-only users have no Discord
  discord_username TEXT,
  display_name     TEXT,
  avatar_url       TEXT,
  player_id        INTEGER REFERENCES players(id) ON DELETE SET NULL,  -- the claimed player
  is_admin         BOOLEAN NOT NULL DEFAULT FALSE,          -- seeded for future admin unification
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique indexes: multiple NULLs allowed, every non-NULL value unique.
-- Email match is case-insensitive (LOWER) — the login + reset lookups rely on it.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON users (LOWER(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id_unique
  ON users (discord_id) WHERE discord_id IS NOT NULL;
-- One-player-per-account: at most one user row may point at a given player.
CREATE UNIQUE INDEX IF NOT EXISTS users_player_id_unique
  ON users (player_id) WHERE player_id IS NOT NULL;

-- Lookup helpers
CREATE INDEX IF NOT EXISTS idx_users_email      ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users (discord_id);

-- Every user must be reachable by at least one login method.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_has_identity;
ALTER TABLE users ADD CONSTRAINT users_has_identity
  CHECK (email IS NOT NULL OR discord_id IS NOT NULL);

-- Defense-in-depth: this table holds password hashes. Supabase auto-exposes the
-- public schema via PostgREST using the anon key; enabling RLS with no policies
-- blocks anon/authenticated PostgREST callers while the backend (postgres role)
-- bypasses RLS and is unaffected. Same rationale as enable_rls_all_public_tables.sql.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
