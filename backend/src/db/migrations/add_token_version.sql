-- Session revocation support: a per-user version counter baked into every
-- session JWT (the `tv` claim). requireAuth rejects any token whose `tv` no
-- longer matches the user's current token_version, so bumping this column
-- invalidates every outstanding session for that user at once.
--
-- Used by:
--   • reset-password  — bumps token_version so old 30-day JWTs die when the
--     password changes (the resetting client is re-issued a fresh token).
--   • logout-all      — bumps token_version to sign the user out everywhere.
--
-- Idempotent. Run in Supabase SQL editor, or:
--   node run_migration.js backend/src/db/migrations/add_token_version.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
