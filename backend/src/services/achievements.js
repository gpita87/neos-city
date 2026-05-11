/**
 * Neos City Achievement Engine v3 — Pokémon Region Progression
 *
 * Placement tiers:  Gym Leader (top 8) · Elite Four (top 4) · Rival (2nd) · Champion (1st)
 * Region tiers:     Kanto (1×) → Johto (3×) → Hoenn (5×) → Sinnoh (10×) → Unova (20×) → Kalos (40×) → Alola (80×) → Galar (150×) → Paldea (250×)
 * Scopes:           Global + 8 online series
 *
 * Pass 1 — stat-based:  placement, participation, multi-series
 * Pass 2 — query-based:  meta (8 Badges, Elite Trainer, Rival Battle, Smell Ya Later,
 *                        Foreshadowing, Dark Horse) — every Pass-2 achievement now
 *                        scales by OPPONENT REGION TIER, not by raw match count.
 *                        MATCH_TYPES is retained as an empty array for export
 *                        compatibility; future count-scaled achievements would
 *                        slot in there.
 */

// ─── Series IDs ──────────────────────────────────────────────────────────────
const SERIES = {
  FFC:            'ffc',
  RTG_NA:         'rtg_na',
  RTG_EU:         'rtg_eu',
  DCM:            'dcm',
  TCC:            'tcc',
  EOTR:           'eotr',
  NEZUMI:         'nezumi',
  NEZUMI_ROOKIES: 'nezumi_rookies',
  HA:             'ha',
  OTHER:          'other',

  // Offline tiers (unchanged)
  WORLDS:         'worlds',
  MAJOR:          'major',
  REGIONAL:       'regional',
};

const SERIES_NAMES = {
  ffc:            'Ferrum Fist Challenge',
  rtg_na:         'Road to Greatness NA',
  rtg_eu:         'Road to Greatness EU',
  dcm:            'DCM Monthly',
  tcc:            'The Croissant Cup',
  eotr:           'End of the Road',
  nezumi:         'ねずみ杯 (Mouse Cup)',
  nezumi_rookies: 'ねずみ杯 Rookies',
  ha:             "Heaven's Arena",
  other:          'Other',
  worlds:         'World Championships',
  major:          'Major',
  regional:       'Regional',
};

// ─── Series / tier detection (unchanged) ─────────────────────────────────────

function detectSeries(slug = '', name = '') {
  const s = slug.toUpperCase();
  const n = name.toUpperCase();
  if (/^FFC\d+$/.test(s))                                                    return SERIES.FFC;
  if (/^RTGNA\d+$/.test(s) || (n.includes('ROAD TO GREATNESS') && n.includes('NA'))) return SERIES.RTG_NA;
  if (/^RTGEU\d+$/.test(s) || (n.includes('ROAD TO GREATNESS') && n.includes('EU'))) return SERIES.RTG_EU;
  if (/^DCMP\d+$/.test(s)  || n.includes('DCM'))                             return SERIES.DCM;
  if (/^TCC[_-]?\d+$/.test(s) || n.includes('CROISSANT CUP'))               return SERIES.TCC;
  if (n.includes('END OF THE ROAD') || n.includes('END OF ROAD'))            return SERIES.EOTR;
  if (n.includes('ねずみ杯ROOKIES') || n.includes('NEZUMI_ROOKIES'))          return SERIES.NEZUMI_ROOKIES;
  if (n.includes('ねずみ杯') || n.includes('NEZUMI'))                          return SERIES.NEZUMI;
  if (/HEAVEN.*ARENA/.test(n) || /HEAVEN-S-ARENA/.test(s))                   return SERIES.HA;
  return SERIES.OTHER;
}

function detectOfflineTier(name = '') {
  const n = name.toUpperCase();
  if (n.includes('WORLD CHAMPIONSHIPS'))                               return SERIES.WORLDS;
  if (n.includes('INTERNATIONAL CHAMPIONSHIPS'))                       return SERIES.WORLDS;

  // Specific events promoted to major — must be checked before the generic
  // regional patterns below catch them via substring match.
  // Word-boundary regex so e.g. "SUMMER JAM XI" doesn't match "SUMMER JAM XII"
  // and suffixes like " - PokkenDX" are tolerated.
  if (/^WINTER BRAWL 12( |-|$)/.test(n))                               return SERIES.MAJOR;
  if (/^WINTER BRAWL 3D 2019( |-|$)/.test(n))                          return SERIES.MAJOR;
  if (/^SOCAL REGIONALS 2017( |-|$)/.test(n))                          return SERIES.MAJOR;
  if (/^SUMMER JAM XI( |-|$)/.test(n))                                 return SERIES.MAJOR;
  if (/^TORYUKEN 8( |-|$)/.test(n))                                    return SERIES.MAJOR;
  if (/^EYE OF THE STORM 2018( |-|$)/.test(n))                         return SERIES.MAJOR;
  if (/^THE FALL CLASSIC 2017( |-|$)/.test(n))                         return SERIES.MAJOR;
  if (/^SMASH CONFERENCE LXIX( |-|$)/.test(n))                         return SERIES.MAJOR;

  if (n.includes('EVO ') || n === 'EVO')                               return SERIES.MAJOR;
  if (n.includes('CEO '))                                              return SERIES.MAJOR;
  if (n.includes('DREAMHACK'))                                         return SERIES.MAJOR;
  if (n.includes('FROSTY FAUSTINGS') || n.includes('VORTEX GALLERY'))  return SERIES.MAJOR;
  if (n.includes('GENESIS'))                                           return SERIES.MAJOR;
  if (n.includes('CURTAIN CALL'))                                      return SERIES.MAJOR;
  if (n.includes('FINAL BOSS'))                                        return SERIES.MAJOR;
  if (n.includes('DESTINY'))                                           return SERIES.MAJOR;
  if (n.includes('FROSTFIRE'))                                         return SERIES.MAJOR;
  // Promoted 2026-05-08: full series.
  if (n.includes('NORTHEAST CHAMPIONSHIP') || n.includes('NEC '))      return SERIES.MAJOR;
  if (n.includes('FINAL ROUND'))                                       return SERIES.MAJOR;
  if (n.includes('NORCAL REGIONALS'))                                  return SERIES.MAJOR;
  if (n.includes('DEFEND THE NORTH'))                                  return SERIES.MAJOR;

  if (n.includes('WINTER BRAWL'))                                      return SERIES.REGIONAL;
  if (n.includes('SOCAL REGIONALS'))                                   return SERIES.REGIONAL;
  if (n.includes('SUMMER JAM'))                                        return SERIES.REGIONAL;
  if (n.includes('BATTLE ARENA MELBOURNE') || n.includes('BAM '))      return SERIES.REGIONAL;
  if (n.includes('OZHADOU'))                                           return SERIES.REGIONAL;
  if (n.includes('REVOLUTION'))                                        return SERIES.REGIONAL;
  if (n.includes('TORYUKEN'))                                          return SERIES.REGIONAL;
  if (n.includes('KUMITE IN TENNESSEE'))                               return SERIES.REGIONAL;
  if (n.includes('EYE OF THE STORM'))                                  return SERIES.REGIONAL;
  if (n.includes('THE FALL CLASSIC'))                                  return SERIES.REGIONAL;
  if (n.includes('CANADA CUP'))                                        return SERIES.REGIONAL;
  if (n.includes('ALL IN TOGETHER'))                                   return SERIES.REGIONAL;
  if (n.includes('FIGHTCLUB CHAMPIONSHIP'))                            return SERIES.REGIONAL;
  // Texas Showdown removed 2026-05-08 — falls through to 'other'.
  return SERIES.OTHER;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Achievement generation
// ═══════════════════════════════════════════════════════════════════════════════

const REGIONS = [
  { id: 'kanto',  name: 'Kanto',  threshold: 1,   numeral: 'I' },
  { id: 'johto',  name: 'Johto',  threshold: 3,   numeral: 'II' },
  { id: 'hoenn',  name: 'Hoenn',  threshold: 5,   numeral: 'III' },
  { id: 'sinnoh', name: 'Sinnoh', threshold: 10,  numeral: 'IV' },
  { id: 'unova',  name: 'Unova',  threshold: 20,  numeral: 'V' },
  { id: 'kalos',  name: 'Kalos',  threshold: 40,  numeral: 'VI' },
  { id: 'alola',  name: 'Alola',  threshold: 80,  numeral: 'VII' },
  { id: 'galar',  name: 'Galar',  threshold: 150, numeral: 'VIII' },
  { id: 'paldea', name: 'Paldea', threshold: 250, numeral: 'IX' },
];

const REGION_INDEX = {};
REGIONS.forEach((r, i) => { REGION_INDEX[r.id] = i; });

/** Return region IDs at or above the given tier (inclusive). */
function regionsAtOrAbove(regionId) {
  const idx = REGION_INDEX[regionId];
  return REGIONS.slice(idx).map(r => r.id);
}

const PLACEMENT_TIERS = [
  { id: 'gym_leader', name: 'Gym Leader', icon: '🏟️', statSuffix: 'top8',      globalStat: 'top8_finishes',      desc: 'top 8' },
  { id: 'elite_four', name: 'Elite Four', icon: '4️⃣',  statSuffix: 'top4',      globalStat: 'top4_finishes',      desc: 'top 4' },
  { id: 'rival',      name: 'Rival',      icon: '🔥',  statSuffix: 'runner_up', globalStat: 'runner_up_finishes', desc: 'runner-up' },
  { id: 'champion',   name: 'Champion',   icon: '👑',  statSuffix: 'wins',      globalStat: 'tournament_wins',    desc: 'champion' },
];

const ONLINE_SERIES = [
  { id: 'ffc',    name: 'FFC',              statPrefix: 'ffc' },
  { id: 'rtg_na', name: 'RTG NA',           statPrefix: 'rtg_na' },
  { id: 'rtg_eu', name: 'RTG EU',           statPrefix: 'rtg_eu' },
  { id: 'dcm',    name: 'DCM',              statPrefix: 'dcm' },
  { id: 'tcc',    name: 'TCC',              statPrefix: 'tcc' },
  { id: 'eotr',   name: 'EOTR',             statPrefix: 'eotr' },
  { id: 'nezumi', name: 'ねずみ杯',          statPrefix: 'nezumi' },
  { id: 'ha',     name: "Heaven's Arena",    statPrefix: 'ha' },
];

// Offline-tier scopes that participate in placement + meta achievements.
// `other` is intentionally excluded — small one-off locals would inflate the
// catalog with achievements that are too easy to earn (a 2-player local
// would mint Rivals and Champions from a coin-flip). nezumi_rookies is also
// excluded by being absent from ONLINE_SERIES.
const OFFLINE_TIER_SCOPES = [
  { id: 'worlds',   name: 'Worlds',   statPrefix: 'offline_worlds',   kind: 'offline' },
  { id: 'major',    name: 'Major',    statPrefix: 'offline_major',    kind: 'offline' },
  { id: 'regional', name: 'Regional', statPrefix: 'offline_regional', kind: 'offline' },
];

const SCOPES = [
  { id: 'global', name: '',  statPrefix: null },
  ...ONLINE_SERIES,
];

// All scopes that host placement + meta achievements (global + online + offline tier).
// Participation is restricted to SCOPES (no offline-tier participation achievements —
// "entered N offline majors" doesn't have a clean per-tier stat).
const ALL_SCOPES = [
  { id: 'global', name: '',  statPrefix: null, kind: 'global' },
  ...ONLINE_SERIES.map(s => ({ ...s, kind: 'online' })),
  ...OFFLINE_TIER_SCOPES,
];

// Reserved for future count-scaled achievements. Currently empty: the rival
// pair (Rival Battle / Smell Ya Later) used to live here but moved to
// META_TYPES so the entire Pass-2 catalog scales the same way (by opponent
// region tier, not by match count).
const MATCH_TYPES = [];

// Meta achievements scale by OPPONENT REGION TIER. Region threshold determines
// the minimum opponent region required to count. `required` is the number of
// distinct qualifying opponents needed to unlock the achievement.
//
//   • 8 Badges / Elite Trainer            — N unique Gym Leaders / Elite Four defeated.
//   • Rival Battle / Smell Ya Later       — one qualifying Rival at region tier+.
//   • Foreshadowing / Dark Horse          — one qualifying Champion at region tier+.
//
// `mode` distinguishes "took at least one game" (game) from "won the match"
// (match). 8 Badges / Elite Trainer use match-mode by historical convention.
const META_TYPES = [
  { id: 'eight_badges',   name: '8 Badges!',      icon: '🎖️', targetTier: 'gym_leader', required: 8, mode: 'match', desc: 'Defeat 8 unique Gym Leaders' },
  { id: 'elite_trainer',  name: 'Elite Trainer',   icon: '🏆', targetTier: 'elite_four', required: 4, mode: 'match', desc: 'Defeat 4 unique Elite Four members' },
  { id: 'rival_battle',   name: 'Rival Battle!',   icon: '⚔️', targetTier: 'rival',      required: 1, mode: 'game',  desc: 'Take a game from a Rival' },
  { id: 'smell_ya_later', name: 'Smell Ya Later!', icon: '👋', targetTier: 'rival',      required: 1, mode: 'match', desc: 'Win a match against a Rival' },
  { id: 'foreshadowing',  name: 'Foreshadowing',   icon: '🔮', targetTier: 'champion',   required: 1, mode: 'game',  desc: 'Take a game from a Champion' },
  { id: 'dark_horse',     name: 'Dark Horse',      icon: '🐴', targetTier: 'champion',   required: 1, mode: 'match', desc: 'Win a match against a Champion' },
];

// ─── Build the full catalog ──────────────────────────────────────────────────

const ACHIEVEMENTS = [];
const ACHIEVEMENT_MAP = {};

function _add(a) { ACHIEVEMENTS.push(a); ACHIEVEMENT_MAP[a.id] = a; }

function _times(n) { return n === 1 ? '' : ` ${n} times`; }
function _events(n) { return n === 1 ? 'an event' : `${n} events`; }

// ── 1. Placement ─────────────────────────────────────────────────────────────
// Generated for every scope in ALL_SCOPES: global + 8 online series + 3 offline
// tiers (worlds/major/regional). Offline-tier placement achievements exist so
// that meta achievements at those scopes have something to check opponents
// against (e.g. "Worlds Elite Trainer" needs opponents who hold the
// `worlds_elite_four_*` placement achievement).
for (const scope of ALL_SCOPES) {
  for (const tier of PLACEMENT_TIERS) {
    for (const region of REGIONS) {
      const isGlobal = scope.id === 'global';
      const id = `${scope.id}_${tier.id}_${region.id}`;
      const scopeLabel = isGlobal ? '' : `${scope.name} `;
      const name = `${region.name} ${scopeLabel}${tier.name}`;
      const whereLabel = isGlobal
        ? 'in any tournament'
        : scope.kind === 'offline'
          ? `at offline ${scope.name}s`
          : `in ${scope.name}`;
      const description = `Finish ${tier.desc}${_times(region.threshold)} ${whereLabel}.`;

      const statKey = isGlobal ? tier.globalStat : `${scope.statPrefix}_${tier.statSuffix}`;

      _add({
        id, name, description,
        icon: tier.icon,
        category: isGlobal ? 'placement' : `series_${scope.id}`,
        scope: scope.id, tier: tier.id, region: region.id,
        pass: 1,
        check: (s) => (parseInt(s[statKey]) || 0) >= region.threshold,
      });
    }
  }
}

// ── 2. Participation ─────────────────────────────────────────────────────────
for (const scope of SCOPES) {
  for (const region of REGIONS) {
    const isGlobal = scope.id === 'global';
    const id = `${scope.id}_participation_${region.id}`;
    const scopeLabel = isGlobal ? '' : `${scope.name} `;
    const name = `${region.name} ${scopeLabel}Trainer`;
    const where = isGlobal ? '' : ` in ${scope.name}`;
    const description = `Enter ${_events(region.threshold)}${where}.`;

    const statKey = isGlobal ? 'tournaments_entered' : `${scope.statPrefix}_entered`;

    _add({
      id, name, description,
      icon: '🎮',
      category: isGlobal ? 'participation' : `series_${scope.id}`,
      scope: scope.id, tier: 'participation', region: region.id,
      pass: 1,
      check: (s) => (parseInt(s[statKey]) || 0) >= region.threshold,
    });
  }
}

// ── 3. Multi-series ──────────────────────────────────────────────────────────
_add({
  id: 'multi_series',
  name: 'World Traveler',
  description: 'Participate in 2 or more distinct tournament series.',
  icon: '🌐',
  category: 'special',
  scope: 'global', tier: 'special', region: null,
  pass: 1,
  check: (s) => {
    let count = 0;
    for (const series of ONLINE_SERIES) {
      if ((parseInt(s[`${series.statPrefix}_entered`]) || 0) >= 1) count++;
    }
    return count >= 2;
  },
});

// ── 4. Match-based (Pass 2) ─────────────────────────────────────────────────
for (const mt of MATCH_TYPES) {
  for (const region of REGIONS) {
    const id = `${mt.id}_${region.id}`;
    const timesLabel = region.threshold === 1 ? '' : ` ${region.threshold} times`;
    _add({
      id,
      name: `${region.name} ${mt.name}`,
      description: `${mt.desc}${timesLabel}.`,
      icon: mt.icon,
      category: 'match',
      scope: 'global', tier: mt.id, region: region.id,
      pass: 2,
      matchType: mt,
    });
  }
}

// ── 5. Meta (Pass 2) ────────────────────────────────────────────────────────
// Meta achievements are now generated per scope. Each meta scope requires:
//   • Opponents who hold the qualifying placement achievement IN THAT SCOPE
//     (e.g. FFC eight_badges requires opponents with `ffc_gym_leader_*`).
//   • Matches played at tournaments IN THAT SCOPE (e.g. FFC eight_badges only
//     counts wins at FFC events).
//
// Global meta keeps the bare `<meta>_<region>` ID for backward compatibility
// with existing rows in `player_achievements` and `achievement_defeated_opponents`.
// Series/offline-tier meta uses `<scope>_<meta>_<region>`.
for (const scope of ALL_SCOPES) {
  const isGlobal = scope.id === 'global';
  for (const meta of META_TYPES) {
    for (const region of REGIONS) {
      const id = isGlobal
        ? `${meta.id}_${region.id}`
        : `${scope.id}_${meta.id}_${region.id}`;
      const scopeLabel = isGlobal ? '' : `${scope.name} `;
      const regionLabel = region.id === 'kanto' ? '' : ` (${region.name}+)`;
      const whereLabel = isGlobal
        ? ''
        : scope.kind === 'offline'
          ? ` at offline ${scope.name}s`
          : ` in ${scope.name}`;
      _add({
        id,
        name: `${region.name} ${scopeLabel}${meta.name}`,
        description: `${meta.desc}${whereLabel}${regionLabel}.`,
        icon: meta.icon,
        category: isGlobal ? 'meta' : `series_${scope.id}`,
        scope: scope.id, tier: meta.id, region: region.id,
        pass: 2,
        metaType: meta,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Pass 1 — stat-based checks (placement, participation, multi-series)
// ═══════════════════════════════════════════════════════════════════════════════

function checkAchievementsPass1(stats, alreadyUnlocked = []) {
  const already = new Set(alreadyUnlocked);
  return ACHIEVEMENTS
    .filter(a => a.pass === 1 && !already.has(a.id) && a.check(stats))
    .map(a => a.id);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Pass 2 — query-based checks (match-based + meta)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} AchievementContributor
 * @property {number}  opponent_id — the opponent whose tier/defeat contributed
 * @property {number}  [match_id]  — specific match ID (for match-based achievements)
 */

/**
 * @typedef {Object} AchievementResult
 * @property {string}                  id           — achievement ID
 * @property {AchievementContributor[]} [contributors] — opponents/matches that qualified
 */

/**
 * Run Pass 2 achievement checks for a single player.
 * Must be called AFTER Pass 1 achievements are committed for ALL players,
 * so that opponent achievement lookups reflect the current state.
 *
 * @param {number}  playerId
 * @param {object}  db  — the pg pool / query interface
 * @param {string[]} alreadyUnlocked — achievement IDs the player already has
 * @returns {Promise<AchievementResult[]>} newly earned achievements with contributor metadata
 */
/**
 * Pure (no-DB) version of Pass 2 achievement checks.
 * Takes pre-fetched data instead of a db connection.
 *
 * Meta achievements are now scope-aware:
 *   • Match filter: only matches at tournaments matching the scope count.
 *     - global  → every match counts.
 *     - online series (ffc, rtg_na, …)   → matches where tournaments.series === scope.id.
 *     - offline tier (worlds, major, …) → matches where tournaments.series === scope.id
 *       (which by construction are offline events).
 *   • Opponent filter: opponent must hold `<scope>_<targetTier>_<region>+`.
 *     For global scope that's `global_<targetTier>_<region>+`. For series
 *     scope it's that series's placement achievement specifically.
 *
 * @param {number}  playerId
 * @param {object[]} playerMatches — matches involving this player
 * @param {Object<number, Set<string>>} globalOppAchMap — playerId → Set of achievement IDs
 * @param {string[]} alreadyUnlocked — achievement IDs the player already has
 * @param {Object<number, string>} [matchSeriesById] — match.id → tournament.series.
 *   Omit (or pass empty) only for legacy callers that want global-only behavior.
 * @returns {AchievementResult[]} newly earned achievements with contributor metadata
 */
function checkAchievementsPass2Pure(playerId, playerMatches, globalOppAchMap, alreadyUnlocked = [], matchSeriesById = {}) {
  const already = new Set(alreadyUnlocked);
  const newAch = [];
  const matches = playerMatches;

  if (!matches || matches.length === 0) return newAch;

  const oppAchMap = globalOppAchMap;

  /**
   * Does opponent hold a qualifying placement achievement at this scope and
   * region (or higher)?
   *
   *   • Global scope → opponent holds ANY `<scope>_<tier>_<region>+`. In real
   *     data this is equivalent to requiring `global_<tier>_<region>+`
   *     specifically (anyone with `ffc_top8 >= 1` also has `top8_finishes >= 1`
   *     since the global stat sums everything), so this loose check just
   *     accommodates test mocks that only set a series-specific tier.
   *   • Series / offline-tier scope → strict scope-prefix match. "FFC 8 Badges"
   *     requires opponent to be specifically an FFC Gym Leader.
   */
  function oppHasTierAtRegion(oppId, scope, tierStr, minRegionId) {
    const achs = oppAchMap[oppId];
    if (!achs) return false;
    const validRegions = regionsAtOrAbove(minRegionId);
    const hasAch = (id) => (typeof achs.has === 'function' ? achs.has(id) : achs.includes(id));

    if (scope === 'global') {
      // Loose match: any scope's <tier>_<region> qualifies.
      const iter = typeof achs.values === 'function' ? achs : achs;
      for (const a of iter) {
        for (const rg of validRegions) {
          if (a.endsWith(`_${tierStr}_${rg}`)) return true;
        }
      }
      return false;
    }

    // Strict scope-prefix match.
    for (const rg of validRegions) {
      if (hasAch(`${scope}_${tierStr}_${rg}`)) return true;
    }
    return false;
  }

  // ── Build per-scope, per-opponent earliest-match maps ─────────────────────
  //
  // For each scope, the meta check needs:
  //   • earliest match where we took >= 1 game off each opponent (game mode)
  //   • earliest match where we won the match against each opponent (match mode)
  // ...considering only matches at tournaments in that scope.
  //
  // The 'global' scope considers every match. Scoped versions filter on
  // matchSeriesById[match.id] === scope.id.
  const scopeMaps = {}; // scope.id → { earliestGameByOpp, earliestWinByOpp }
  for (const scope of ALL_SCOPES) {
    scopeMaps[scope.id] = {
      earliestGameByOpp: new Map(),
      earliestWinByOpp:  new Map(),
    };
  }

  for (const m of matches) {
    const opp = m.player1_id === playerId ? m.player2_id : m.player1_id;
    if (!opp) continue;
    const myScore = m.player1_id === playerId ? m.player1_score : m.player2_score;
    const iWon = m.winner_id === playerId;
    const matchScope = matchSeriesById[m.id] || null;

    for (const scope of ALL_SCOPES) {
      if (scope.id !== 'global' && matchScope !== scope.id) continue;
      const maps = scopeMaps[scope.id];
      if (myScore >= 1 && !maps.earliestGameByOpp.has(opp)) {
        maps.earliestGameByOpp.set(opp, { opponent_id: opp, match_id: m.id });
      }
      if (iWon && !maps.earliestWinByOpp.has(opp)) {
        maps.earliestWinByOpp.set(opp, { opponent_id: opp, match_id: m.id });
      }
    }
  }

  // ── (Optional) count-scaled match achievements ─────────────────────────────
  // MATCH_TYPES is currently empty — every Pass-2 achievement is now meta.
  for (const mt of MATCH_TYPES) {
    void mt; // no-op
  }

  // ── Meta achievements (per scope × meta type × region) ─────────────────────
  //
  // ID convention (matches the catalog builder above):
  //   • global scope → `<meta.id>_<region.id>`  (back-compat with old IDs)
  //   • other scopes → `<scope.id>_<meta.id>_<region.id>`
  //
  // Each scope has its own opponent-match maps (built above) so we both
  // restrict which matches count AND which opponent placement achievements
  // qualify.
  for (const scope of ALL_SCOPES) {
    const isGlobal = scope.id === 'global';
    const maps = scopeMaps[scope.id];

    for (const meta of META_TYPES) {
      const oppMatchMap = meta.mode === 'game' ? maps.earliestGameByOpp : maps.earliestWinByOpp;

      for (const region of REGIONS) {
        const achId = isGlobal
          ? `${meta.id}_${region.id}`
          : `${scope.id}_${meta.id}_${region.id}`;
        if (already.has(achId)) continue;

        const qualifyingOpponents = [];
        for (const [oppId, info] of oppMatchMap) {
          if (oppHasTierAtRegion(oppId, scope.id, meta.targetTier, region.id)) {
            qualifyingOpponents.push({ opponent_id: oppId, match_id: info.match_id });
          }
        }

        if (qualifyingOpponents.length >= meta.required) {
          newAch.push({ id: achId, contributors: qualifyingOpponents });
        }
      }
    }
  }

  return newAch;
}

/**
 * DB-backed wrapper for checkAchievementsPass2Pure.
 * Fetches matches, tournament series, and opponent achievements from DB,
 * then delegates to the pure function.
 * Used by single-tournament import flow. For bulk recalculation, use the Pure
 * version directly (recalculate_elo.js builds matchSeriesById once across all
 * matches rather than per-player).
 */
async function checkAchievementsPass2(playerId, db, alreadyUnlocked = []) {
  // Fetch matches + their tournament series in one round trip so the meta
  // match-series filter has the data it needs.
  const { rows: matches } = await db.query(`
    SELECT m.id, m.tournament_id, m.player1_id, m.player2_id, m.winner_id,
           m.player1_score, m.player2_score, t.series AS tournament_series
    FROM matches m
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE (m.player1_id = $1 OR m.player2_id = $1)
      AND m.winner_id IS NOT NULL
  `, [playerId]);

  // Build match.id → tournament.series
  const matchSeriesById = {};
  for (const m of matches) {
    if (m.tournament_series) matchSeriesById[m.id] = m.tournament_series;
  }

  // Unique opponent IDs
  const opponentIdSet = new Set();
  for (const m of matches) {
    const opp = m.player1_id === playerId ? m.player2_id : m.player1_id;
    if (opp) opponentIdSet.add(opp);
  }
  const opponentIds = [...opponentIdSet];
  if (opponentIds.length === 0) return [];

  // Fetch opponent achievements
  const { rows: oppAchRows } = await db.query(`
    SELECT player_id, achievement_id
    FROM player_achievements
    WHERE player_id = ANY($1::int[])
  `, [opponentIds]);

  // Build opponent → Set<achievementId>
  const oppAchMap = {};
  for (const r of oppAchRows) {
    if (!oppAchMap[r.player_id]) oppAchMap[r.player_id] = new Set();
    oppAchMap[r.player_id].add(r.achievement_id);
  }

  return checkAchievementsPass2Pure(playerId, matches, oppAchMap, alreadyUnlocked, matchSeriesById);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Progress helpers (for frontend display)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute meta-achievement progress for a player.
 * Returns an object like { eight_badges_kanto: { current: 5, required: 8 }, … }
 * for every meta achievement the player does NOT yet have.
 *
 * Scope-aware (mirrors checkAchievementsPass2Pure semantics):
 *   • global → all opponents who hold `global_<targetTier>_<region>+`
 *   • non-global → opponents the player has played in tournaments of that
 *     scope AND who hold `<scope>_<targetTier>_<region>+`.
 */
async function computeMetaProgress(playerId, db, alreadyUnlocked = []) {
  const already = new Set(alreadyUnlocked);
  const progress = {};

  // Pull every completed match this player was in, with the tournament's series.
  const { rows: matches } = await db.query(`
    SELECT m.id, m.player1_id, m.player2_id, m.winner_id,
           m.player1_score, m.player2_score, t.series AS tournament_series
    FROM matches m
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE (m.player1_id = $1 OR m.player2_id = $1)
      AND m.winner_id IS NOT NULL
  `, [playerId]);

  // Per-scope sets of opponents the player took a game from / defeated.
  const scopeSets = {};
  for (const scope of ALL_SCOPES) {
    scopeSets[scope.id] = { tookGameFrom: new Set(), defeated: new Set() };
  }

  for (const m of matches) {
    const opp = m.player1_id === playerId ? m.player2_id : m.player1_id;
    if (!opp) continue;
    const myScore = m.player1_id === playerId ? m.player1_score : m.player2_score;
    const iWon = m.winner_id === playerId;
    const matchScope = m.tournament_series || null;

    for (const scope of ALL_SCOPES) {
      if (scope.id !== 'global' && matchScope !== scope.id) continue;
      const sets = scopeSets[scope.id];
      if (myScore >= 1) sets.tookGameFrom.add(opp);
      if (iWon)         sets.defeated.add(opp);
    }
  }

  // Collect every opponent we might need across all scopes
  const allOppIds = new Set();
  for (const scope of ALL_SCOPES) {
    for (const id of scopeSets[scope.id].tookGameFrom) allOppIds.add(id);
    for (const id of scopeSets[scope.id].defeated)     allOppIds.add(id);
  }
  if (allOppIds.size === 0) return progress;

  const { rows: oppAchRows } = await db.query(`
    SELECT player_id, achievement_id
    FROM player_achievements
    WHERE player_id = ANY($1::int[])
  `, [[...allOppIds]]);

  const oppAchMap = {};
  for (const r of oppAchRows) {
    if (!oppAchMap[r.player_id]) oppAchMap[r.player_id] = new Set();
    oppAchMap[r.player_id].add(r.achievement_id);
  }

  for (const scope of ALL_SCOPES) {
    const isGlobal = scope.id === 'global';
    const sets = scopeSets[scope.id];

    for (const meta of META_TYPES) {
      const oppSet = meta.mode === 'game' ? sets.tookGameFrom : sets.defeated;

      for (const region of REGIONS) {
        const achId = isGlobal
          ? `${meta.id}_${region.id}`
          : `${scope.id}_${meta.id}_${region.id}`;
        if (already.has(achId)) continue;

        const validRegions = regionsAtOrAbove(region.id);
        let qualifying = 0;
        const qualifyingOppIds = [];
        for (const oppId of oppSet) {
          const achs = oppAchMap[oppId];
          if (!achs) continue;
          let found = false;
          if (isGlobal) {
            // Loose match — see oppHasTierAtRegion in Pass 2 for rationale.
            for (const a of achs) {
              for (const rg of validRegions) {
                if (a.endsWith(`_${meta.targetTier}_${rg}`)) { found = true; break; }
              }
              if (found) break;
            }
          } else {
            for (const rg of validRegions) {
              if (achs.has(`${scope.id}_${meta.targetTier}_${rg}`)) { found = true; break; }
            }
          }
          if (found) {
            qualifying++;
            qualifyingOppIds.push(oppId);
          }
        }

        if (qualifying > 0) {
          progress[achId] = { current: qualifying, required: meta.required, qualifying_opponents: qualifyingOppIds };
        }
      }
    }
  }

  return progress;
}

/**
 * For a given player, return their highest region tier per placement tier.
 * Used for the home page "top trainers" display.
 * Returns e.g. { gym_leader: 'hoenn', elite_four: 'johto', rival: null, champion: 'kanto' }
 */
function highestRegions(achievementIds) {
  const result = {};
  for (const tier of PLACEMENT_TIERS) {
    let best = -1;
    for (const achId of achievementIds) {
      // Match global_{tier}_{region} pattern
      if (achId.includes(`_${tier.id}_`)) {
        for (let i = 0; i < REGIONS.length; i++) {
          if (achId.endsWith(`_${tier.id}_${REGIONS[i].id}`) && i > best) {
            best = i;
          }
        }
      }
    }
    result[tier.id] = best >= 0 ? REGIONS[best].id : null;
  }
  return result;
}

// ─── Lookup helpers ──────────────────────────────────────────────────────────

function getAchievementById(id) {
  return ACHIEVEMENT_MAP[id] || null;
}

function getPass1Achievements() {
  return ACHIEVEMENTS.filter(a => a.pass === 1);
}

function getPass2Achievements() {
  return ACHIEVEMENTS.filter(a => a.pass === 2);
}

// Legacy compat — wraps Pass 1 only (used in tournament import flow)
function checkAchievements(stats, alreadyUnlocked = []) {
  return checkAchievementsPass1(stats, alreadyUnlocked);
}

module.exports = {
  ACHIEVEMENTS,
  ACHIEVEMENT_MAP,
  SERIES,
  SERIES_NAMES,
  REGIONS,
  REGION_INDEX,
  PLACEMENT_TIERS,
  ONLINE_SERIES,
  OFFLINE_TIER_SCOPES,
  SCOPES,
  ALL_SCOPES,
  MATCH_TYPES,
  META_TYPES,
  detectSeries,
  detectOfflineTier,
  regionsAtOrAbove,
  checkAchievements,
  checkAchievementsPass1,
  checkAchievementsPass2,
  checkAchievementsPass2Pure,
  computeMetaProgress,
  highestRegions,
  getAchievementById,
  getPass1Achievements,
  getPass2Achievements,
};
