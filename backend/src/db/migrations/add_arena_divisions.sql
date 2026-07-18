-- Skill divisions for Live Arena tournaments.
-- Run: node run_migration.js backend/src/db/migrations/add_arena_divisions.sql
--
-- Players self-report a SKILL division per tournament at registration:
-- rookie / intermediate / veteran. Scoreboards split by division and the
-- pairing engine never matches a rookie against a veteran (intermediate
-- pairs with everyone). Scoring/streaks ignore division entirely.
--
-- NOTE: "skill division" is deliberately distinct from the future
-- "connection division" mentioned in the M6 rules text — unrelated features.
--
-- Idempotent — safe to re-run (ADD COLUMN IF NOT EXISTS skips the whole
-- clause, including the CHECK, once the column exists). Existing participant
-- rows land on 'intermediate' via the default.

ALTER TABLE arena_participants
  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'intermediate'
  CHECK (division IN ('rookie', 'intermediate', 'veteran'));
