-- Retroactively tag offline tournaments with tier-based series values.
-- Tiers: worlds, major, regional, other (local).
-- Mirrors the detectOfflineTier() patterns in achievements.js.

-- ── Worlds ─────────────────────────────────────────────────────────────────
UPDATE tournaments SET series = 'worlds'
WHERE is_offline = TRUE
  AND (UPPER(name) LIKE '%WORLD CHAMPIONSHIPS%'
    OR UPPER(name) LIKE '%INTERNATIONAL CHAMPIONSHIPS%');

-- ── Majors ─────────────────────────────────────────────────────────────────
UPDATE tournaments SET series = 'major'
WHERE is_offline = TRUE AND series IS DISTINCT FROM 'worlds'
  AND (UPPER(name) LIKE 'EVO %'
    OR UPPER(name) = 'EVO'
    OR UPPER(name) LIKE 'CEO %'
    OR UPPER(name) LIKE '%DREAMHACK%'
    OR UPPER(name) LIKE '%FROSTY FAUSTINGS%'
    OR UPPER(name) LIKE '%VORTEX GALLERY%'
    OR UPPER(name) LIKE '%GENESIS%'
    OR UPPER(name) LIKE '%CURTAIN CALL%'
    OR UPPER(name) LIKE '%FINAL BOSS%'
    OR UPPER(name) LIKE '%DESTINY%');

-- ── Regionals ──────────────────────────────────────────────────────────────
UPDATE tournaments SET series = 'regional'
WHERE is_offline = TRUE AND series NOT IN ('worlds', 'major')
  AND (UPPER(name) LIKE '%NORTHEAST CHAMPIONSHIP%'
    OR UPPER(name) LIKE '%WINTER BRAWL%'
    OR UPPER(name) LIKE '%FINAL ROUND%'
    OR UPPER(name) LIKE '%NORCAL REGIONALS%'
    OR UPPER(name) LIKE '%SOCAL REGIONALS%'
    OR UPPER(name) LIKE '%DEFEND THE NORTH%'
    OR UPPER(name) LIKE '%SUMMER JAM%'
    OR UPPER(name) LIKE '%FROSTFIRE%'
    OR UPPER(name) LIKE '%BATTLE ARENA MELBOURNE%'
    OR UPPER(name) LIKE '%OZHADOU%'
    OR UPPER(name) LIKE '%REVOLUTION%'
    OR UPPER(name) LIKE '%TEXAS SHOWDOWN%'
    OR UPPER(name) LIKE '%TORYUKEN%'
    OR UPPER(name) LIKE '%KUMITE IN TENNESSEE%'
    OR UPPER(name) LIKE '%EYE OF THE STORM%'
    OR UPPER(name) LIKE '%THE FALL CLASSIC%'
    OR UPPER(name) LIKE '%CANADA CUP%'
    OR UPPER(name) LIKE '%ALL IN TOGETHER%'
    OR UPPER(name) LIKE '%FIGHTCLUB CHAMPIONSHIP%');

-- ── Everything else stays as 'other' ───────────────────────────────────────
UPDATE tournaments SET series = 'other'
WHERE is_offline = TRUE AND (series IS NULL OR series = 'other');
