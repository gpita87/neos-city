-- Enable Row-Level Security on every table in the public schema.
--
-- Why: Supabase auto-exposes the public schema via PostgREST
-- (https://xbeynvfupondrpepmmsi.supabase.co/rest/v1/*) using the public
-- `anon` key. With RLS disabled, anyone who discovers the anon key can
-- read/write/delete rows via that endpoint.
--
-- Neos City never uses Supabase's PostgREST or the supabase-js client —
-- the backend talks to Postgres directly via `pg` + the Session pooler
-- DATABASE_URL as the `postgres` role, which BYPASSES RLS. So enabling
-- RLS with no policies has the desired effect:
--   • PostgREST callers (anon, authenticated) → blocked from everything
--   • The backend (postgres role) → unaffected, keeps working as before
--
-- This is the standard defense-in-depth pattern for Supabase projects
-- that don't use Supabase's auto-generated API. Idempotent — re-running
-- is a no-op.
--
-- Resolves the "rls_disabled_in_public" security advisory (2026-05-11).

-- ── Known tables (explicit list — fails loudly if a table was renamed) ────
ALTER TABLE players                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_placements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE elo_history                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_achievements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_defeated_opponents ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_matches                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizers                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_aliases                 ENABLE ROW LEVEL SECURITY;

-- ── Catch-all for any future tables added without RLS ────────────────────
-- Picks up anything in `public` that doesn't already have RLS enabled.
-- Skips views, foreign tables, partitions, and Postgres-internal tables.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM   pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
      AND  c.relkind = 'r'           -- ordinary tables only
      AND  c.relrowsecurity = FALSE  -- not already enabled
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    RAISE NOTICE 'Enabled RLS on public.% (was missing from explicit list)', t.relname;
  END LOOP;
END $$;
