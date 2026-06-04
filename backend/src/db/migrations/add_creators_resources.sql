-- Community Pillars: YouTube creators + a curated resource library.
-- Run from the neos-city directory:
--   node run_migration.js backend/src/db/migrations/add_creators_resources.sql
-- Idempotent — safe to re-run.

-- ── Creators (the "pillars" spotlight) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS creators (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  channel_url        TEXT NOT NULL,
  -- YouTube channel ID (UC...). Filled in manually or resolved from a handle.
  -- The refresh job keys off this to pull the latest upload.
  channel_id         TEXT,
  avatar_url         TEXT,
  blurb              TEXT,                 -- e.g. "Frame data & Gardevoir tech"
  region             TEXT,                 -- 'NA' | 'EU' | 'JP' (reuses players.region)
  series             TEXT[] DEFAULT '{}',  -- ['ffc','rtg_na'] → rendered as badges
  -- Optional link to a competitor's profile (/players/:id).
  player_id          INTEGER REFERENCES players(id) ON DELETE SET NULL,
  -- Filled by refresh_creators.js (YouTube Data API). "active" is DERIVED from
  -- this at query time (latest_upload_at >= now() - threshold) — never stored,
  -- so there is no staleness to maintain.
  latest_upload_at   TIMESTAMPTZ,
  latest_video_id    TEXT,
  latest_video_title TEXT,
  last_checked_at    TIMESTAMPTZ,
  sort_order         INTEGER NOT NULL DEFAULT 0,  -- manual tiebreak in the grid
  added_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per YouTube channel. Partial index allows many NULLs (a creator can
-- be seeded before their channel_id is resolved) but enforces uniqueness once set.
CREATE UNIQUE INDEX IF NOT EXISTS creators_channel_id_unique
  ON creators (channel_id)
  WHERE channel_id IS NOT NULL;

-- ── Resource library (evergreen learning content) ───────────────────────────
CREATE TABLE IF NOT EXISTS resources (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  -- 'character_guide' | 'fundamental' (extensible later)
  kind         TEXT NOT NULL,
  -- "character" is a reserved word in SQL, so the column is character_name;
  -- the API aliases it back to `character` in responses.
  character_name TEXT,               -- filter facet for character guides
  skill_level  TEXT,                 -- 'beginner' | 'intermediate' | 'advanced'
  series       TEXT,                 -- optional series association
  -- Who made it — lets a creator card show "12 guides" and survives creator deletion.
  creator_id   INTEGER REFERENCES creators(id) ON DELETE SET NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resources_kind_idx      ON resources (kind);
CREATE INDEX IF NOT EXISTS resources_character_idx ON resources (character_name) WHERE character_name IS NOT NULL;
