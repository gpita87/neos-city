-- Google OAuth login — adds Google as a second sign-in provider alongside Discord.
-- Mirrors the discord_id shape in add_users_auth.sql. Idempotent.
-- Run in Supabase SQL editor, or:
--   node run_migration.js backend/src/db/migrations/add_google_auth.sql
--
-- Context: email/password login was removed in favour of OAuth-only (Discord +
-- Google). Both providers return a provider-verified email, so the callback can
-- safely auto-link a Discord and a Google login that share the same verified
-- email into one account (see routes/auth.js resolveOAuthUser).

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;

-- Partial unique index: multiple NULLs allowed, every non-NULL google_id unique.
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique
  ON users (google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id);

-- A Google-only user has neither email-as-sole-identity nor a discord_id, so the
-- identity CHECK must accept google_id as a valid login method.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_has_identity;
ALTER TABLE users ADD CONSTRAINT users_has_identity
  CHECK (email IS NOT NULL OR discord_id IS NOT NULL OR google_id IS NOT NULL);
