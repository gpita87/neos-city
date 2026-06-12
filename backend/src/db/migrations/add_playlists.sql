-- Curated YouTube playlists shown in a "Playlists" section on the Creators page.
-- title / channel_name / thumbnail_url / video_count are filled in from the
-- YouTube API by refresh_creators.js / the backend poller; seed only needs the
-- playlist_id (+ optional creator + note + sort_order).
-- Run from the neos-city directory:
--   node run_migration.js backend/src/db/migrations/add_playlists.sql
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS playlists (
  id            SERIAL PRIMARY KEY,
  playlist_id   TEXT NOT NULL UNIQUE,       -- the YouTube "list=" id
  title         TEXT,
  channel_name  TEXT,
  thumbnail_url TEXT,
  video_count   INTEGER,
  note          TEXT,
  creator_id    INTEGER REFERENCES creators(id) ON DELETE SET NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playlists_creator_idx ON playlists (creator_id) WHERE creator_id IS NOT NULL;
