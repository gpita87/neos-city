-- Live Arena tournaments (on-site, hour-long, lichess-arena-style).
-- Run: node run_migration.js backend/src/db/migrations/add_arena.sql
--
-- Design notes (see AGENT_CONTEXT.md / arena plan):
--   • Arena results are SEPARATE from career records for v1 — nothing here
--     touches tournaments/matches/tournament_placements/ELO/achievements.
--   • Arena identity keys on users(id), NOT players(id): registration requires
--     login, and a logged-in user may have no claimed player yet. Display names
--     resolve at read time (claimed player's display_name, else users.display_name).
--   • Future features are schema'd but not built: group allocator
--     (arena_matches.assigned_group_id + pokken_groups.capacity), verified
--     connections (arena_connection_reports.rated_user_id), connection-gated
--     entry (arena_tournaments.entry_requirements JSONB).
-- Idempotent — safe to re-run.

-- Self-set connection region (distinct from importer-managed players.region).
ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_region_valid;
ALTER TABLE users ADD CONSTRAINT users_region_valid
  CHECK (region IS NULL OR region IN ('NA', 'EU', 'JP'));

-- ── Pokkén in-game Groups (lobbies) ─────────────────────────────────────────
-- The game caps active memberships (~6); players record theirs here so paired
-- opponents can see which groups they share.
CREATE TABLE IF NOT EXISTS pokken_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  is_official BOOLEAN NOT NULL DEFAULT TRUE,     -- curated by Neos City vs community-added
  ruleset     JSONB NOT NULL DEFAULT '{}',       -- e.g. {"arena": "fixed", "skill_points": "off"}
  capacity    INTEGER,                           -- FUTURE: group allocator needs this
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id  INTEGER NOT NULL REFERENCES pokken_groups(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id)
);
-- Max 6 memberships per user is enforced in the route (transaction + count),
-- matching the app-level style used elsewhere in this codebase.

-- ── Tournaments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_tournaments (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  starts_at          TIMESTAMPTZ NOT NULL,
  duration_minutes   INTEGER NOT NULL DEFAULT 60,
  status             TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'live', 'finished', 'finalized', 'cancelled')),
                     -- live:      clock running, new pairings allowed
                     -- finished:  clock expired, trailing matches only
                     -- finalized: all matches terminal, standings frozen
  entry_requirements JSONB NOT NULL DEFAULT '{}',  -- FUTURE: connection-gated entry
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_arena_tournaments_status ON arena_tournaments (status, starts_at);

CREATE TABLE IF NOT EXISTS arena_participants (
  id                    SERIAL PRIMARY KEY,
  tournament_id         INTEGER NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score                 INTEGER NOT NULL DEFAULT 0,
  streak                INTEGER NOT NULL DEFAULT 0,   -- current consecutive wins
  wins                  INTEGER NOT NULL DEFAULT 0,
  losses                INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'withdrawn')),
  last_opponent_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- no-immediate-rematch check
  waiting_since         TIMESTAMPTZ NOT NULL DEFAULT NOW(),              -- pairing priority; reset on match end
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, user_id)                                        -- register is idempotent
);
CREATE INDEX IF NOT EXISTS idx_arena_participants_standings
  ON arena_participants (tournament_id, score DESC);

-- ── Matches ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_matches (
  id                SERIAL PRIMARY KEY,
  tournament_id     INTEGER NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  p1_user_id        INTEGER NOT NULL REFERENCES users(id),
  p2_user_id        INTEGER NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'awaiting_confirm', 'disputed', 'confirmed', 'cancelled')),
  winner_user_id    INTEGER REFERENCES users(id),   -- set on confirm
  winner_games      INTEGER,                        -- always 2 in bo3
  loser_games       INTEGER,                        -- 0 or 1
  winner_points     INTEGER,                        -- 2 or 4 (streak-doubled); audit trail
  confirm_method    TEXT CHECK (confirm_method IN ('agreed', 'auto', 'admin')),
  assigned_group_id INTEGER REFERENCES pokken_groups(id) ON DELETE SET NULL, -- FUTURE allocator; NULL in v1
  first_reported_at TIMESTAMPTZ,                    -- drives the 5-min auto-confirm
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_arena_matches_tournament ON arena_matches (tournament_id, status);
CREATE INDEX IF NOT EXISTS idx_arena_matches_p1 ON arena_matches (p1_user_id);
CREATE INDEX IF NOT EXISTS idx_arena_matches_p2 ON arena_matches (p2_user_id);

-- Dual result reporting: each player files one; re-report = upsert.
CREATE TABLE IF NOT EXISTS arena_match_reports (
  match_id         INTEGER NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  winner_user_id   INTEGER NOT NULL REFERENCES users(id),
  loser_games      INTEGER NOT NULL CHECK (loser_games IN (0, 1)),  -- winner always has 2 in bo3
  reported_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, reporter_user_id)
);

-- Post-match connection quality, per rater. rated_user_id (the opponent) is
-- what future "verified good connection" badges aggregate over.
CREATE TABLE IF NOT EXISTS arena_connection_reports (
  match_id      INTEGER NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  rater_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rated_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, rater_user_id)
);

-- Per-match opponent chat (persisted so reconnects/reloads restore history).
CREATE TABLE IF NOT EXISTS arena_chat_messages (
  id             SERIAL PRIMARY KEY,
  match_id       INTEGER NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           TEXT NOT NULL CHECK (char_length(body) <= 500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_arena_chat_match ON arena_chat_messages (match_id, id);

-- ── Seed placeholder official groups ────────────────────────────────────────
-- PLACEHOLDERS: Gabriel supplies the real group names/rulesets before launch.
INSERT INTO pokken_groups (name, is_official, ruleset) VALUES
  ('Neos City Arena 1', TRUE, '{"arena": "fixed", "skill_points": "off", "note": "standard competitive rules"}'),
  ('Neos City Arena 2', TRUE, '{"arena": "fixed", "skill_points": "off", "note": "standard competitive rules"}'),
  ('Neos City Arena 3', TRUE, '{"arena": "fixed", "skill_points": "off", "note": "standard competitive rules"}')
ON CONFLICT (name) DO NOTHING;

-- Defense-in-depth: RLS on with no policies blocks anon PostgREST access;
-- the backend's postgres role bypasses RLS. Same rationale as
-- enable_rls_all_public_tables.sql.
ALTER TABLE pokken_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_groups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_tournaments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_participants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_matches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_match_reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_connection_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_chat_messages      ENABLE ROW LEVEL SECURITY;
