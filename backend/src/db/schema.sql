-- Neos City Database Schema (v2 — includes series tracking)
-- Run this in your Supabase SQL editor to set up the database

-- Players
CREATE TABLE IF NOT EXISTS players (
  id                          SERIAL PRIMARY KEY,
  challonge_username          TEXT UNIQUE NOT NULL,
  display_name                TEXT NOT NULL,
  elo_rating                  INTEGER NOT NULL DEFAULT 1200,
  peak_elo                    INTEGER NOT NULL DEFAULT 1200,
  career_points               INTEGER NOT NULL DEFAULT 0,
  games_played                INTEGER NOT NULL DEFAULT 0,
  total_match_wins            INTEGER NOT NULL DEFAULT 0,
  total_match_losses          INTEGER NOT NULL DEFAULT 0,
  tournaments_entered         INTEGER NOT NULL DEFAULT 0,
  tournament_wins             INTEGER NOT NULL DEFAULT 0,
  top4_finishes               INTEGER NOT NULL DEFAULT 0,
  top8_finishes               INTEGER NOT NULL DEFAULT 0,
  longest_win_streak          INTEGER NOT NULL DEFAULT 0,
  current_win_streak          INTEGER NOT NULL DEFAULT 0,

  -- Per-series stats
  ffc_entered                 INTEGER NOT NULL DEFAULT 0,
  ffc_top4                    INTEGER NOT NULL DEFAULT 0,
  ffc_wins                    INTEGER NOT NULL DEFAULT 0,

  rtg_na_entered              INTEGER NOT NULL DEFAULT 0,
  rtg_na_top4                 INTEGER NOT NULL DEFAULT 0,
  rtg_na_wins                 INTEGER NOT NULL DEFAULT 0,

  rtg_eu_entered              INTEGER NOT NULL DEFAULT 0,
  rtg_eu_top4                 INTEGER NOT NULL DEFAULT 0,
  rtg_eu_wins                 INTEGER NOT NULL DEFAULT 0,

  dcm_entered                 INTEGER NOT NULL DEFAULT 0,
  dcm_top4                    INTEGER NOT NULL DEFAULT 0,
  dcm_wins                    INTEGER NOT NULL DEFAULT 0,

  tcc_entered                 INTEGER NOT NULL DEFAULT 0,
  tcc_top4                    INTEGER NOT NULL DEFAULT 0,
  tcc_wins                    INTEGER NOT NULL DEFAULT 0,

  ha_entered                  INTEGER NOT NULL DEFAULT 0,
  ha_top4                     INTEGER NOT NULL DEFAULT 0,
  ha_wins                     INTEGER NOT NULL DEFAULT 0,

  -- Special trackers
  games_taken_from_champions  INTEGER NOT NULL DEFAULT 0,
  top5_upsets                 INTEGER NOT NULL DEFAULT 0,
  comebacks                   INTEGER NOT NULL DEFAULT 0,

  avatar_url                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id                    SERIAL PRIMARY KEY,
  challonge_id          TEXT UNIQUE NOT NULL,
  challonge_url         TEXT,
  name                  TEXT NOT NULL,
  game_name             TEXT DEFAULT 'Pokkén Tournament',
  series                TEXT NOT NULL DEFAULT 'other',
  tournament_type       TEXT,
  participants_count    INTEGER,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tournament placements (1 row per player per tournament)
CREATE TABLE IF NOT EXISTS tournament_placements (
  id              SERIAL PRIMARY KEY,
  tournament_id   INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id       INTEGER REFERENCES players(id) ON DELETE CASCADE,
  final_rank      INTEGER,
  career_points   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tournament_id, player_id)
);

-- Matches (imported from Challonge)
CREATE TABLE IF NOT EXISTS matches (
  id                        SERIAL PRIMARY KEY,
  tournament_id             INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  challonge_match_id        TEXT NOT NULL,
  player1_id                INTEGER REFERENCES players(id),
  player2_id                INTEGER REFERENCES players(id),
  winner_id                 INTEGER REFERENCES players(id),
  player1_score             INTEGER,
  player2_score             INTEGER,
  round                     INTEGER,
  bracket_section           TEXT,
  state                     TEXT,
  played_at                 TIMESTAMPTZ,
  UNIQUE(tournament_id, challonge_match_id)
);

-- ELO history
CREATE TABLE IF NOT EXISTS elo_history (
  id            SERIAL PRIMARY KEY,
  player_id     INTEGER REFERENCES players(id) ON DELETE CASCADE,
  match_id      INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  old_elo       INTEGER NOT NULL,
  new_elo       INTEGER NOT NULL,
  delta         INTEGER NOT NULL,
  reason        TEXT,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Achievements catalog
CREATE TABLE IF NOT EXISTS achievements (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  icon          TEXT NOT NULL,
  category      TEXT NOT NULL,
  series        TEXT
);

-- Player achievements
CREATE TABLE IF NOT EXISTS player_achievements (
  player_id       INTEGER REFERENCES players(id) ON DELETE CASCADE,
  achievement_id  TEXT REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, achievement_id)
);

-- Live match rooms (Bo3/Bo5)
CREATE TABLE IF NOT EXISTS live_matches (
  id              SERIAL PRIMARY KEY,
  room_code       TEXT UNIQUE NOT NULL,
  player1_id      INTEGER REFERENCES players(id),
  player2_id      INTEGER REFERENCES players(id),
  format          TEXT NOT NULL DEFAULT 'bo3',
  player1_games   INTEGER NOT NULL DEFAULT 0,
  player2_games   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'waiting',
  winner_id       INTEGER REFERENCES players(id),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_matches_player1       ON matches(player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2       ON matches(player2_id);
CREATE INDEX IF NOT EXISTS idx_elo_history_player    ON elo_history(player_id);
CREATE INDEX IF NOT EXISTS idx_player_achievements   ON player_achievements(player_id);
CREATE INDEX IF NOT EXISTS idx_players_career_pts    ON players(career_points DESC);
CREATE INDEX IF NOT EXISTS idx_players_elo           ON players(elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_placements_player     ON tournament_placements(player_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_series    ON tournaments(series);
