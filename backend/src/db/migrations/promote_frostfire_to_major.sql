-- Promote the Frostfire offline series from 'regional' to 'major'.
-- detectOfflineTier() in achievements.js and add_offline_tiers.sql have been
-- updated to match; this migration retroactively reclassifies existing rows.
-- Idempotent.

UPDATE tournaments SET series = 'major'
WHERE is_offline = TRUE
  AND UPPER(name) LIKE '%FROSTFIRE%'
  AND series IS DISTINCT FROM 'major';
