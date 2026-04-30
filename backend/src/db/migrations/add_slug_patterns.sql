-- Migration: Add slug_patterns for per-organizer slug enumeration
-- Run in Supabase SQL Editor
--
-- Enables slug pattern enumeration (Method 1): if an organizer's tournaments
-- follow a numbered naming scheme, list the prefix(es) here and the sync will
-- automatically probe ffc1…ffc50, rtgna1…rtgna50, etc. via the v2 API.
--
-- Format: comma-separated lowercase prefixes, e.g. "ffc" or "rtgna,rtg_na"
-- Known patterns:
--   wise_ / rickythe3rd  → ffc
--   shean96 / rigz_      → rtgna
--   __chepestoopid       → rtgeu
--   devlinhartfgc        → dcmp
--   __auradiance         → tcc

ALTER TABLE organizers
  ADD COLUMN IF NOT EXISTS slug_patterns TEXT;

COMMENT ON COLUMN organizers.slug_patterns IS
  'Comma-separated slug prefixes for enumeration (e.g. "ffc" or "rtgna,rtg_na"). '
  'Sync probes prefix+N from maxN down to 1 to find tournaments without scraping.';

-- Seed known patterns for existing organizers
UPDATE organizers SET slug_patterns = 'ffc'   WHERE challonge_username IN ('wise_', 'rickythe3rd');
UPDATE organizers SET slug_patterns = 'rtgna' WHERE challonge_username IN ('shean96', 'rigz_');
UPDATE organizers SET slug_patterns = 'rtgeu' WHERE challonge_username = '__chepestoopid';
UPDATE organizers SET slug_patterns = 'dcmp'  WHERE challonge_username = 'devlinhartfgc';
UPDATE organizers SET slug_patterns = 'tcc'   WHERE challonge_username = '__auradiance';
