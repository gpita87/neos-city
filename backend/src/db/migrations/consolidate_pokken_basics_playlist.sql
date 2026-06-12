-- Consolidation: the "Pokkén Basics" playlist moved from the resources list into
-- the dedicated playlists table/section, so remove the old resource row to avoid
-- showing it in two places.
-- Run from the neos-city directory:
--   node run_migration.js backend/src/db/migrations/consolidate_pokken_basics_playlist.sql
-- Idempotent — safe to re-run.

DELETE FROM resources
WHERE url = 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAK4GxBRrz1f2Nix6IqAzzoc';
