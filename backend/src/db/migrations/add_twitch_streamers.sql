-- Twitch streamers page (feature-flagged) — cached "last streamed Pokkén" data.
--
-- The frontend reads these cached rows; the Twitch Helix API is only hit by the
-- background poller (services/refreshTwitch.js), never on the request path.
-- `last_pokken_stream_at` is persisted forever, so even after a VOD expires off
-- Twitch (14–60 day retention) the most recent known Pokkén stream date survives.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS twitch_streamers (
  id                    SERIAL PRIMARY KEY,
  login                 TEXT NOT NULL UNIQUE,   -- twitch.tv/<login>, lowercase
  display_name          TEXT,                   -- filled from Helix /users
  avatar_url            TEXT,                   -- filled from Helix /users
  is_live               BOOLEAN NOT NULL DEFAULT FALSE,
  live_game_name        TEXT,                   -- category they're live in (any game)
  live_title            TEXT,
  last_pokken_stream_at TIMESTAMPTZ,            -- best-known most recent Pokkén stream
  last_pokken_title     TEXT,
  last_pokken_vod_url   TEXT,                   -- link to the VOD while it still exists
  last_checked_at       TIMESTAMPTZ,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backend connects as the postgres role (bypasses RLS); PostgREST callers are
-- blocked — same defense-in-depth as enable_rls_all_public_tables.sql.
ALTER TABLE twitch_streamers ENABLE ROW LEVEL SECURITY;

-- Seed the supported channels (order matches the curated list).
INSERT INTO twitch_streamers (login, sort_order) VALUES
  ('jinthehypelive',    10),
  ('yoshean96',         20),
  ('super_epicguy',     30),
  ('99dash',            40),
  ('tresnoms',          50),
  ('tec_xx',            60),
  ('festiveexplosion1', 70),
  ('rpgfrog',           80),
  ('thedevteam_',       90),
  ('pitaguy',          100),
  ('shadowcat8088',    110),
  ('jda7',             120),
  ('theclassyfenn',    130),
  ('nannerpus_pokken', 140)
ON CONFLICT (login) DO NOTHING;
