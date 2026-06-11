-- Recent uploads per creator + a curated featured-video spotlight.
-- Run from the neos-city directory:
--   node run_migration.js backend/src/db/migrations/add_creator_videos_featured.sql
-- Idempotent — safe to re-run.

-- ── Recent uploads per creator ──────────────────────────────────────────────
-- The poller keeps the latest N uploads per creator here. Rows are replaced on
-- each refresh, so the table always reflects the current most-recent uploads.
CREATE TABLE IF NOT EXISTS creator_videos (
  id           SERIAL PRIMARY KEY,
  creator_id   INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  video_id     TEXT NOT NULL,
  title        TEXT,
  published_at TIMESTAMPTZ,
  UNIQUE (creator_id, video_id)
);
CREATE INDEX IF NOT EXISTS creator_videos_creator_pub_idx
  ON creator_videos (creator_id, published_at DESC);

-- ── Featured-video spotlight ────────────────────────────────────────────────
-- Hand-picked one-off videos (e.g. a Pokkén clip from a creator who doesn't
-- normally cover the game). title/channel_name/thumbnail_url are filled in by
-- the refresh job from the YouTube API; seed only needs video_id + note.
CREATE TABLE IF NOT EXISTS featured_videos (
  id            SERIAL PRIMARY KEY,
  video_id      TEXT NOT NULL UNIQUE,
  title         TEXT,
  channel_name  TEXT,
  channel_url   TEXT,
  note          TEXT,
  thumbnail_url TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
