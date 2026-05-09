-- Retroactively tag offline tournaments with tier-based series values.
-- Tiers: worlds, major, regional, other (local).
-- Mirrors the detectOfflineTier() patterns in backend/src/services/achievements.js.
--
-- 2026-05-08 update: promoted full series (NEC, Final Round, NorCal Regionals,
-- Defend the North) and a handful of specific events (Winter Brawl 12, Winter
-- Brawl 3D 2019, SoCal Regionals 2017, Summer Jam XI, Toryuken 8, Eye of the
-- Storm 2018, The Fall Classic 2017, Smash Conference LXIX) from regional to
-- major, on the basis of world-champion finals or stacked top-tier draws.
-- Texas Showdown 2016 demoted regional → other (no notable Pokkén draw).
--
-- The migration first resets all offline tags so re-runs always converge to
-- the current rules — running it twice is a no-op.

-- ── Reset ──────────────────────────────────────────────────────────────────
UPDATE tournaments SET series = NULL WHERE is_offline = TRUE;

-- ── Worlds ─────────────────────────────────────────────────────────────────
UPDATE tournaments SET series = 'worlds'
WHERE is_offline = TRUE AND series IS NULL
  AND (UPPER(name) LIKE '%WORLD CHAMPIONSHIPS%'
    OR UPPER(name) LIKE '%INTERNATIONAL CHAMPIONSHIPS%');

-- ── Majors ─────────────────────────────────────────────────────────────────
UPDATE tournaments SET series = 'major'
WHERE is_offline = TRUE AND series IS NULL
  AND (UPPER(name) LIKE 'EVO %'
    OR UPPER(name) = 'EVO'
    OR UPPER(name) LIKE 'CEO %'
    OR UPPER(name) LIKE '%DREAMHACK%'
    OR UPPER(name) LIKE '%FROSTY FAUSTINGS%'
    OR UPPER(name) LIKE '%VORTEX GALLERY%'
    OR UPPER(name) LIKE '%GENESIS%'
    OR UPPER(name) LIKE '%CURTAIN CALL%'
    OR UPPER(name) LIKE '%FINAL BOSS%'
    OR UPPER(name) LIKE '%DESTINY%'
    OR UPPER(name) LIKE '%FROSTFIRE%'
    -- Promoted 2026-05-08: full series
    OR UPPER(name) LIKE '%NORTHEAST CHAMPIONSHIP%'
    OR UPPER(name) LIKE '%FINAL ROUND%'
    OR UPPER(name) LIKE '%NORCAL REGIONALS%'
    OR UPPER(name) LIKE '%DEFEND THE NORTH%'
    -- Promoted 2026-05-08: specific events (must be matched before the
    -- generic regional patterns below catch them)
    OR UPPER(name) = 'WINTER BRAWL 12'
    OR UPPER(name) = 'WINTER BRAWL 3D 2019'
    OR UPPER(name) = 'SOCAL REGIONALS 2017'
    OR UPPER(name) = 'SUMMER JAM XI'
    OR UPPER(name) = 'TORYUKEN 8'
    OR UPPER(name) = 'EYE OF THE STORM 2018'
    OR UPPER(name) = 'THE FALL CLASSIC 2017'
    OR UPPER(name) = 'SMASH CONFERENCE LXIX');

-- ── Regionals ──────────────────────────────────────────────────────────────
-- (Texas Showdown removed 2026-05-08 — falls through to 'other'.)
UPDATE tournaments SET series = 'regional'
WHERE is_offline = TRUE AND series IS NULL
  AND (UPPER(name) LIKE '%WINTER BRAWL%'
    OR UPPER(name) LIKE '%SOCAL REGIONALS%'
    OR UPPER(name) LIKE '%SUMMER JAM%'
    OR UPPER(name) LIKE '%BATTLE ARENA MELBOURNE%'
    OR UPPER(name) LIKE '%OZHADOU%'
    OR UPPER(name) LIKE '%REVOLUTION%'
    OR UPPER(name) LIKE '%TORYUKEN%'
    OR UPPER(name) LIKE '%KUMITE IN TENNESSEE%'
    OR UPPER(name) LIKE '%EYE OF THE STORM%'
    OR UPPER(name) LIKE '%THE FALL CLASSIC%'
    OR UPPER(name) LIKE '%CANADA CUP%'
    OR UPPER(name) LIKE '%ALL IN TOGETHER%'
    OR UPPER(name) LIKE '%FIGHTCLUB CHAMPIONSHIP%');

-- ── Everything else → other ────────────────────────────────────────────────
UPDATE tournaments SET series = 'other'
WHERE is_offline = TRUE AND series IS NULL;
