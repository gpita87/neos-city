-- Migration: Add optional Challonge community subdomain per organizer
-- Run in Supabase SQL Editor
--
-- Enables Method 3 (subdomain API): if an organizer's tournaments live under
-- a Challonge community subdomain (e.g. ffc.challonge.com), set this field
-- to "ffc" and the sync will pull all community tournaments via the v1 API.

ALTER TABLE organizers
  ADD COLUMN IF NOT EXISTS challonge_subdomain TEXT;

COMMENT ON COLUMN organizers.challonge_subdomain IS
  'Optional Challonge community subdomain (e.g. "ffc" for ffc.challonge.com). '
  'When set, sync also queries the v1 API for all tournaments in that community.';
