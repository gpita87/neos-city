/**
 * Unit tests for the achievement engine (backend/src/services/achievements.js)
 *
 * Run:  node --test backend/tests/achievements.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ACHIEVEMENTS,
  ACHIEVEMENT_MAP,
  SERIES,
  REGIONS,
  REGION_INDEX,
  PLACEMENT_TIERS,
  ONLINE_SERIES,
  SCOPES,
  MATCH_TYPES,
  META_TYPES,
  detectSeries,
  detectOfflineTier,
  regionsAtOrAbove,
  checkAchievementsPass1,
  checkAchievementsPass2,
  computeMetaProgress,
  highestRegions,
  getAchievementById,
  getPass1Achievements,
  getPass2Achievements,
} = require('../src/services/achievements');

// ─── Test helper: build a fake player stats row ──────────────────────────────
function makeStats(overrides = {}) {
  const defaults = {
    id: 1,
    tournaments_entered: 0,
    tournament_wins: 0,
    runner_up_finishes: 0,
    top4_finishes: 0,
    top8_finishes: 0,
  };
  // Zero out all per-series stats
  for (const s of ['ffc', 'rtg_na', 'rtg_eu', 'dcm', 'tcc', 'eotr', 'nezumi', 'nezumi_rookies', 'ha']) {
    defaults[`${s}_entered`] = 0;
    defaults[`${s}_top8`] = 0;
    defaults[`${s}_top4`] = 0;
    defaults[`${s}_runner_up`] = 0;
    defaults[`${s}_wins`] = 0;
  }
  return { ...defaults, ...overrides };
}

// ─── Test helper: extract just IDs from Pass 2 results ───────────────────────
function achIds(results) {
  return results.map(r => r.id);
}

// ─── Test helper: find a specific result by ID ───────────────────────────────
function findAch(results, id) {
  return results.find(r => r.id === id);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Achievement catalog structure
// ═══════════════════════════════════════════════════════════════════════════════

describe('Achievement catalog', () => {

  it('has a substantial number of achievements', () => {
    assert.ok(ACHIEVEMENTS.length >= 400, `Expected ~409 achievements, got ${ACHIEVEMENTS.length}`);
  });

  it('all achievements have required fields', () => {
    for (const a of ACHIEVEMENTS) {
      assert.ok(a.id, `achievement missing id`);
      assert.ok(a.name, `${a.id} missing name`);
      assert.ok(a.description, `${a.id} missing description`);
      assert.ok(a.icon, `${a.id} missing icon`);
      assert.ok(a.category, `${a.id} missing category`);
      assert.ok(a.scope, `${a.id} missing scope`);
      assert.ok([1, 2].includes(a.pass), `${a.id} has invalid pass: ${a.pass}`);
    }
  });

  it('all achievement IDs are unique', () => {
    const ids = new Set();
    for (const a of ACHIEVEMENTS) {
      assert.ok(!ids.has(a.id), `duplicate achievement ID: ${a.id}`);
      ids.add(a.id);
    }
  });

  it('ACHIEVEMENT_MAP is consistent with ACHIEVEMENTS array', () => {
    assert.equal(Object.keys(ACHIEVEMENT_MAP).length, ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      assert.equal(ACHIEVEMENT_MAP[a.id], a);
    }
  });

  it('Pass 1 achievements all have a check function', () => {
    const pass1 = getPass1Achievements();
    assert.ok(pass1.length > 0);
    for (const a of pass1) {
      assert.equal(typeof a.check, 'function', `${a.id} missing check function`);
    }
  });

  it('Pass 2 achievements do NOT have a check function', () => {
    const pass2 = getPass2Achievements();
    assert.ok(pass2.length > 0);
    for (const a of pass2) {
      assert.equal(a.check, undefined, `${a.id} should not have check function (Pass 2)`);
    }
  });

  it('has correct number of placement achievements (9 scopes x 4 tiers x 8 regions)', () => {
    const placement = ACHIEVEMENTS.filter(a => a.pass === 1 && a.tier !== 'participation' && a.tier !== 'special');
    assert.equal(placement.length, 9 * 4 * 8, `Expected 288 placement achievements, got ${placement.length}`);
  });

  it('has correct number of participation achievements (9 scopes x 8 regions)', () => {
    const participation = ACHIEVEMENTS.filter(a => a.tier === 'participation');
    assert.equal(participation.length, 9 * 8, `Expected 72 participation achievements, got ${participation.length}`);
  });

  it('has one World Traveler (multi-series) achievement', () => {
    const multi = ACHIEVEMENTS.filter(a => a.id === 'multi_series');
    assert.equal(multi.length, 1);
  });

  it('has no match-category achievements (everything moved to meta)', () => {
    const matchBased = ACHIEVEMENTS.filter(a => a.category === 'match');
    // MATCH_TYPES is currently empty — every Pass-2 achievement scales by
    // opponent region tier and lives under the meta category.
    assert.equal(matchBased.length, 0, `Expected 0 match-based, got ${matchBased.length}`);
  });

  it('has meta achievements: 6 types × one per region', () => {
    const meta = ACHIEVEMENTS.filter(a => a.category === 'meta');
    // 8 Badges, Elite Trainer, Rival Battle, Smell Ya Later, Foreshadowing, Dark Horse
    assert.equal(meta.length, 6 * REGIONS.length,
      `Expected ${6 * REGIONS.length} meta, got ${meta.length}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  detectSeries
// ═══════════════════════════════════════════════════════════════════════════════

describe('detectSeries', () => {

  it('detects FFC by slug', () => {
    assert.equal(detectSeries('FFC12', ''), 'ffc');
    assert.equal(detectSeries('ffc1', ''), 'ffc');
    assert.equal(detectSeries('FFC99', ''), 'ffc');
  });

  it('detects RTG NA by slug', () => {
    assert.equal(detectSeries('RTGNA5', ''), 'rtg_na');
    assert.equal(detectSeries('rtgna12', ''), 'rtg_na');
  });

  it('detects RTG NA by name', () => {
    assert.equal(detectSeries('', 'Road to Greatness NA #5'), 'rtg_na');
  });

  it('detects RTG EU by slug', () => {
    assert.equal(detectSeries('RTGEU3', ''), 'rtg_eu');
  });

  it('detects RTG EU by name', () => {
    assert.equal(detectSeries('', 'Road to Greatness EU #10'), 'rtg_eu');
  });

  it('detects DCM by slug', () => {
    assert.equal(detectSeries('DCMP7', ''), 'dcm');
  });

  it('detects DCM by name', () => {
    assert.equal(detectSeries('', 'DCM Monthly #14'), 'dcm');
  });

  it('detects TCC by slug', () => {
    assert.equal(detectSeries('TCC5', ''), 'tcc');
    assert.equal(detectSeries('TCC-3', ''), 'tcc');
    assert.equal(detectSeries('TCC_10', ''), 'tcc');
  });

  it('detects TCC by name', () => {
    assert.equal(detectSeries('', 'The Croissant Cup #8'), 'tcc');
  });

  it('detects EOTR by name', () => {
    assert.equal(detectSeries('', 'End of the Road 5'), 'eotr');
    assert.equal(detectSeries('', 'End of Road'), 'eotr');
  });

  it('detects Nezumi by name (Japanese)', () => {
    assert.equal(detectSeries('', 'ポッ拳ねずみ杯 オンライン 第25回'), 'nezumi');
  });

  it('detects Nezumi Rookies (must check before nezumi)', () => {
    assert.equal(detectSeries('', 'ポッ拳ねずみ杯Rookies オンライン 第7回'), 'nezumi_rookies');
  });

  it('detects Heaven\'s Arena by name', () => {
    assert.equal(detectSeries('', "Heaven's Arena #20"), 'ha');
  });

  it('detects Heaven\'s Arena by slug pattern', () => {
    assert.equal(detectSeries('heaven-s-arena-20', ''), 'ha');
  });

  it('returns "other" for unknown tournaments', () => {
    assert.equal(detectSeries('random123', 'Some Random Tournament'), 'other');
    assert.equal(detectSeries('', ''), 'other');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  detectOfflineTier
// ═══════════════════════════════════════════════════════════════════════════════

describe('detectOfflineTier', () => {

  it('classifies World Championships as worlds', () => {
    assert.equal(detectOfflineTier('Pokkén World Championships 2019'), 'worlds');
  });

  it('classifies International Championships as worlds', () => {
    assert.equal(detectOfflineTier('NA International Championships 2018'), 'worlds');
  });

  it('classifies EVO as major', () => {
    assert.equal(detectOfflineTier('EVO 2017'), 'major');
    assert.equal(detectOfflineTier('EVO Japan 2020'), 'major');
  });

  it('classifies CEO as major', () => {
    assert.equal(detectOfflineTier('CEO 2018'), 'major');
  });

  it('classifies DreamHack as major', () => {
    assert.equal(detectOfflineTier('DreamHack Atlanta 2017'), 'major');
  });

  it('classifies Genesis as major', () => {
    assert.equal(detectOfflineTier('Genesis 5'), 'major');
  });

  it('classifies NEC as regional', () => {
    assert.equal(detectOfflineTier('Northeast Championship 2019'), 'regional');
    assert.equal(detectOfflineTier('NEC 20'), 'regional');
  });

  it('classifies Winter Brawl as regional', () => {
    assert.equal(detectOfflineTier('Winter Brawl 12'), 'regional');
  });

  it('classifies BAM as regional', () => {
    assert.equal(detectOfflineTier('Battle Arena Melbourne 10'), 'regional');
    assert.equal(detectOfflineTier('BAM 11'), 'regional');
  });

  it('classifies unknown events as other', () => {
    assert.equal(detectOfflineTier('Bob\'s Basement Bracket'), 'other');
    assert.equal(detectOfflineTier('Local Weekly #42'), 'other');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  regionsAtOrAbove
// ═══════════════════════════════════════════════════════════════════════════════

describe('regionsAtOrAbove', () => {

  it('kanto returns all 8 regions', () => {
    const result = regionsAtOrAbove('kanto');
    assert.equal(result.length, 8);
    assert.equal(result[0], 'kanto');
    assert.equal(result[7], 'galar');
  });

  it('galar returns only galar', () => {
    const result = regionsAtOrAbove('galar');
    assert.deepEqual(result, ['galar']);
  });

  it('hoenn returns hoenn through galar (6 regions)', () => {
    const result = regionsAtOrAbove('hoenn');
    assert.equal(result.length, 6);
    assert.equal(result[0], 'hoenn');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  checkAchievementsPass1
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkAchievementsPass1', () => {

  describe('placement achievements', () => {

    it('awards Kanto Champion (global) for 1 tournament win', () => {
      const stats = makeStats({ tournament_wins: 1 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_champion_kanto'), 'should earn Kanto Champion');
    });

    it('does NOT award Johto Champion for only 1 win (needs 3)', () => {
      const stats = makeStats({ tournament_wins: 1 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(!earned.includes('global_champion_johto'), 'should not earn Johto Champion with 1 win');
    });

    it('awards multiple region tiers at once (auto-cascade)', () => {
      const stats = makeStats({ tournament_wins: 5 }); // passes Kanto(1), Johto(3), Hoenn(5)
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_champion_kanto'));
      assert.ok(earned.includes('global_champion_johto'));
      assert.ok(earned.includes('global_champion_hoenn'));
      assert.ok(!earned.includes('global_champion_sinnoh'), 'should not reach Sinnoh (needs 10)');
    });

    it('awards Gym Leader (top 8) tiers correctly', () => {
      const stats = makeStats({ top8_finishes: 10 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_gym_leader_kanto'));
      assert.ok(earned.includes('global_gym_leader_johto'));   // 3
      assert.ok(earned.includes('global_gym_leader_hoenn'));    // 5
      assert.ok(earned.includes('global_gym_leader_sinnoh'));   // 10
      assert.ok(!earned.includes('global_gym_leader_unova'));   // needs 20
    });

    it('awards Rival (runner-up) tiers', () => {
      const stats = makeStats({ runner_up_finishes: 3 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_rival_kanto'));   // 1
      assert.ok(earned.includes('global_rival_johto'));    // 3
      assert.ok(!earned.includes('global_rival_hoenn'));    // needs 5
    });

    it('awards Elite Four (top 4) tiers', () => {
      const stats = makeStats({ top4_finishes: 1 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_elite_four_kanto'));
    });
  });

  describe('series-scoped achievements', () => {

    it('awards FFC Champion for 1 FFC win', () => {
      const stats = makeStats({ ffc_wins: 1 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('ffc_champion_kanto'));
    });

    it('awards RTG NA Gym Leader for top-8 finishes', () => {
      const stats = makeStats({ rtg_na_top8: 3 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('rtg_na_gym_leader_kanto'));
      assert.ok(earned.includes('rtg_na_gym_leader_johto'));
    });

    it('series achievements are independent — FFC wins dont affect RTG', () => {
      const stats = makeStats({ ffc_wins: 10, rtg_na_wins: 0 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('ffc_champion_sinnoh'), 'FFC should have Sinnoh');
      assert.ok(!earned.includes('rtg_na_champion_kanto'), 'RTG NA should have nothing');
    });

    it('awards nezumi series achievements', () => {
      const stats = makeStats({ nezumi_entered: 5, nezumi_wins: 1 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('nezumi_participation_hoenn'), 'entered 5 = Hoenn tier');
      assert.ok(earned.includes('nezumi_champion_kanto'), '1 win = Kanto champion');
    });
  });

  describe('participation achievements', () => {

    it('awards Kanto Trainer for 1 tournament entered', () => {
      const stats = makeStats({ tournaments_entered: 1 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_participation_kanto'));
    });

    it('awards higher participation tiers', () => {
      const stats = makeStats({ tournaments_entered: 20 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_participation_unova'), '20 events = Unova');
    });

    it('awards series participation independently', () => {
      const stats = makeStats({ dcm_entered: 10 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('dcm_participation_sinnoh'), 'DCM 10 events = Sinnoh');
    });
  });

  describe('World Traveler (multi-series)', () => {

    it('not awarded for only 1 series', () => {
      const stats = makeStats({ ffc_entered: 10 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(!earned.includes('multi_series'));
    });

    it('awarded for 2+ series', () => {
      const stats = makeStats({ ffc_entered: 1, dcm_entered: 1 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('multi_series'));
    });

    it('awarded for many series', () => {
      const stats = makeStats({
        ffc_entered: 1, rtg_na_entered: 1, rtg_eu_entered: 1,
        dcm_entered: 1, tcc_entered: 1, eotr_entered: 1,
      });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('multi_series'));
    });
  });

  describe('alreadyUnlocked filtering', () => {

    it('does not re-award already unlocked achievements', () => {
      const stats = makeStats({ tournament_wins: 1 });
      const earned = checkAchievementsPass1(stats, ['global_champion_kanto']);
      assert.ok(!earned.includes('global_champion_kanto'), 'should not re-award');
    });

    it('still awards new achievements when some are already unlocked', () => {
      const stats = makeStats({ tournament_wins: 3 });
      const earned = checkAchievementsPass1(stats, ['global_champion_kanto']);
      assert.ok(!earned.includes('global_champion_kanto'), 'already had kanto');
      assert.ok(earned.includes('global_champion_johto'), 'should earn johto');
    });
  });

  describe('edge cases', () => {

    it('returns empty array for zeroed-out stats', () => {
      const stats = makeStats();
      const earned = checkAchievementsPass1(stats);
      assert.equal(earned.length, 0);
    });

    it('handles string stats (from DB rows where values come as strings)', () => {
      const stats = makeStats({ tournament_wins: '5', tournaments_entered: '10' });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_champion_hoenn'), 'parseInt should handle string "5"');
      assert.ok(earned.includes('global_participation_sinnoh'), 'parseInt should handle string "10"');
    });

    it('handles null/undefined stats gracefully (defaults to 0)', () => {
      const stats = makeStats({ tournament_wins: null, tournaments_entered: undefined });
      const earned = checkAchievementsPass1(stats);
      assert.ok(!earned.includes('global_champion_kanto'), 'null should not trigger');
    });

    it('Galar tier requires 150 — the maximum', () => {
      const stats = makeStats({ tournaments_entered: 150 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(earned.includes('global_participation_galar'), '150 = Galar tier');
    });

    it('149 is NOT enough for Galar', () => {
      const stats = makeStats({ tournaments_entered: 149 });
      const earned = checkAchievementsPass1(stats);
      assert.ok(!earned.includes('global_participation_galar'));
      assert.ok(earned.includes('global_participation_alola'), '149 >= 80 = Alola');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  checkAchievementsPass2 (requires mock DB)
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkAchievementsPass2', () => {

  // Mock DB: returns predefined results based on query pattern
  // Updated to include id/tournament_id fields in match rows
  function makeMockDb(matches = [], oppAchievements = []) {
    return {
      query: async (sql, params) => {
        if (sql.includes('FROM matches')) {
          return { rows: matches };
        }
        if (sql.includes('FROM player_achievements')) {
          return { rows: oppAchievements };
        }
        return { rows: [] };
      },
    };
  }

  // Helper: make a match row with the new id/tournament_id fields
  function makeMatch(overrides) {
    return {
      id: overrides.id || 1,
      tournament_id: overrides.tournament_id || 100,
      player1_id: overrides.player1_id,
      player2_id: overrides.player2_id,
      winner_id: overrides.winner_id,
      player1_score: overrides.player1_score,
      player2_score: overrides.player2_score,
    };
  }

  describe('return format', () => {

    it('returns empty array when player has no matches', async () => {
      const db = makeMockDb([], []);
      const result = await checkAchievementsPass2(1, db, []);
      assert.deepEqual(result, []);
    });

    it('returns objects with id and contributors fields', async () => {
      const matches = [
        makeMatch({ id: 10, tournament_id: 100, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 0 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_champion_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      assert.ok(result.length > 0, 'should have results');
      for (const ach of result) {
        assert.ok(typeof ach.id === 'string', 'each result should have string id');
        assert.ok(Array.isArray(ach.contributors), 'each result should have contributors array');
      }
    });
  });

  describe('match-based achievements', () => {

    it('awards Rival Battle (game) when taking a game from a Rival', async () => {
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 2, player1_score: 1, player2_score: 2 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_rival_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(ids.includes('rival_battle_kanto'), 'should earn Rival Battle Kanto (took a game from rival)');
    });

    it('awards Smell Ya Later when winning a match against a Rival', async () => {
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 1 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'ffc_rival_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(ids.includes('smell_ya_later_kanto'), 'should earn Smell Ya Later Kanto');
    });

    it('awards Dark Horse when winning a match against a Champion', async () => {
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 0 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_champion_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(ids.includes('dark_horse_kanto'), 'should earn Dark Horse Kanto');
    });

    it('awards Foreshadowing when taking a game from a Champion', async () => {
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 2, player1_score: 1, player2_score: 2 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_champion_johto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(ids.includes('foreshadowing_kanto'), 'should earn Foreshadowing Kanto');
    });

    it('Smell Ya Later region tier is the opponents Rival region (not match count)', async () => {
      // Three wins against three different KANTO-only Rivals.
      // Under count-scaling, this used to unlock Johto. Under the new meta
      // semantics, only Kanto Smell Ya Later fires because no opponent has a
      // Rival achievement at Johto+ tier.
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 0 }),
        makeMatch({ id: 11, player1_id: 1, player2_id: 3, winner_id: 1, player1_score: 2, player2_score: 1 }),
        makeMatch({ id: 12, player1_id: 1, player2_id: 4, winner_id: 1, player1_score: 2, player2_score: 0 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_rival_kanto' },
        { player_id: 3, achievement_id: 'global_rival_kanto' },
        { player_id: 4, achievement_id: 'global_rival_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(ids.includes('smell_ya_later_kanto'), 'Kanto fires — opponents are Kanto Rivals');
      assert.ok(!ids.includes('smell_ya_later_johto'), 'Johto should NOT fire — no opponent at Johto+ Rival tier');
      assert.ok(!ids.includes('smell_ya_later_hoenn'), 'Hoenn should NOT fire — no opponent at Hoenn+ Rival tier');
    });

    it('Smell Ya Later climbs as opponents Rival region rises', async () => {
      // One opponent who has Rival achievement up to Sinnoh — beating them
      // unlocks Smell Ya Later through Sinnoh in a single match.
      const matches = [
        makeMatch({ id: 20, player1_id: 1, player2_id: 7, winner_id: 1, player1_score: 2, player2_score: 0 }),
      ];
      const oppAch = [
        { player_id: 7, achievement_id: 'global_rival_kanto' },
        { player_id: 7, achievement_id: 'global_rival_johto' },
        { player_id: 7, achievement_id: 'global_rival_hoenn' },
        { player_id: 7, achievement_id: 'global_rival_sinnoh' },
      ];
      const db = makeMockDb(matches, oppAch);
      const ids = achIds(await checkAchievementsPass2(1, db, []));

      assert.ok(ids.includes('smell_ya_later_kanto'),  'Kanto fires');
      assert.ok(ids.includes('smell_ya_later_johto'),  'Johto fires via Johto-tier Rival');
      assert.ok(ids.includes('smell_ya_later_hoenn'),  'Hoenn fires via Hoenn-tier Rival');
      assert.ok(ids.includes('smell_ya_later_sinnoh'), 'Sinnoh fires via Sinnoh-tier Rival');
      assert.ok(!ids.includes('smell_ya_later_unova'), 'Unova should NOT fire — opponent is only Sinnoh-tier');
    });

    it('does not re-award already unlocked achievements', async () => {
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 0 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_champion_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, ['dark_horse_kanto']);
      const ids = achIds(result);

      assert.ok(!ids.includes('dark_horse_kanto'), 'should not re-award');
    });
  });

  describe('match-based contributor tracking', () => {

    it('includes opponent_id and match_id in match-based contributors', async () => {
      const matches = [
        makeMatch({ id: 42, tournament_id: 100, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 0 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_champion_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      const darkHorse = findAch(result, 'dark_horse_kanto');
      assert.ok(darkHorse, 'should have dark_horse_kanto');
      assert.ok(darkHorse.contributors.length >= 1, 'should have at least 1 contributor');
      assert.equal(darkHorse.contributors[0].opponent_id, 2);
      assert.equal(darkHorse.contributors[0].match_id, 42);
    });

    it('Smell Ya Later (now meta) keeps every qualifying Rival as a contributor', async () => {
      // Three unique Rivals defeated. Smell Ya Later is meta with required=1,
      // but like every other meta achievement it preserves ALL qualifying
      // opponents so the modal can list every Rival you've beaten.
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 1 }),
        makeMatch({ id: 11, player1_id: 1, player2_id: 3, winner_id: 1, player1_score: 2, player2_score: 0 }),
        makeMatch({ id: 12, player1_id: 1, player2_id: 4, winner_id: 1, player1_score: 2, player2_score: 1 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_rival_kanto' },
        { player_id: 3, achievement_id: 'global_rival_kanto' },
        { player_id: 4, achievement_id: 'global_rival_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      const kantoSmell = findAch(result, 'smell_ya_later_kanto');
      assert.ok(kantoSmell, 'should have smell_ya_later_kanto');
      assert.equal(kantoSmell.contributors.length, 3, 'meta should preserve all qualifying opponents');

      const oppIds = new Set(kantoSmell.contributors.map(c => c.opponent_id));
      assert.equal(oppIds.size, 3, 'each contributor should be a unique opponent');
      for (const c of kantoSmell.contributors) {
        assert.ok(c.opponent_id, 'contributor should have opponent_id');
        assert.ok(c.match_id, 'meta contributors should carry match_id');
      }
    });

    it('Rival Battle (game-mode meta) fires on a loss where the player took a game', async () => {
      // Lost 1-2 to a Rival — took one game, should still earn Rival Battle
      // but NOT Smell Ya Later (which requires the match win).
      const matches = [
        makeMatch({ id: 30, player1_id: 1, player2_id: 5, winner_id: 5, player1_score: 1, player2_score: 2 }),
      ];
      const oppAch = [{ player_id: 5, achievement_id: 'global_rival_kanto' }];
      const db = makeMockDb(matches, oppAch);
      const ids = achIds(await checkAchievementsPass2(1, db, []));

      assert.ok(ids.includes('rival_battle_kanto'),    'rival_battle should fire — game taken from a Rival');
      assert.ok(!ids.includes('smell_ya_later_kanto'), 'smell_ya_later should NOT fire — match was lost');
    });

    it('Dark Horse (now meta) keeps every qualifying Champion as a contributor', async () => {
      // Two unique Champions defeated. Dark Horse is now a meta achievement
      // with required=1, but like other metas it preserves ALL qualifying
      // opponents so the modal can list every champion you've taken down.
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 0 }),
        makeMatch({ id: 11, player1_id: 1, player2_id: 3, winner_id: 1, player1_score: 2, player2_score: 0 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_champion_kanto' },
        { player_id: 3, achievement_id: 'global_champion_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      const darkHorse = findAch(result, 'dark_horse_kanto');
      assert.ok(darkHorse, 'should have dark_horse_kanto');
      assert.equal(darkHorse.contributors.length, 2, 'meta should preserve all qualifying opponents');
      const oppIds = new Set(darkHorse.contributors.map(c => c.opponent_id));
      assert.equal(oppIds.size, 2, 'each contributor should be a unique opponent');
      for (const c of darkHorse.contributors) {
        assert.ok(c.match_id, 'meta contributors should carry match_id for tournament linking');
      }
    });

    it('tracks both game and match contributors independently', async () => {
      // Player 1 loses to Champion (takes a game) — earns Foreshadowing but not Dark Horse
      const matches = [
        makeMatch({ id: 10, player1_id: 1, player2_id: 2, winner_id: 2, player1_score: 1, player2_score: 2 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_champion_kanto' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      const foreshadowing = findAch(result, 'foreshadowing_kanto');
      assert.ok(foreshadowing, 'should earn foreshadowing');
      assert.equal(foreshadowing.contributors.length, 1);
      assert.equal(foreshadowing.contributors[0].opponent_id, 2);
      assert.equal(foreshadowing.contributors[0].match_id, 10);

      // Dark Horse not earned (didn't win the match)
      assert.ok(!achIds(result).includes('dark_horse_kanto'), 'should not earn dark_horse');
    });
  });

  describe('meta achievements', () => {

    it('awards 8 Badges when enough unique Gym Leaders defeated', async () => {
      const matches = [];
      const oppAch = [];
      for (let i = 2; i <= 9; i++) {
        matches.push(makeMatch({ id: i + 100, player1_id: 1, player2_id: i, winner_id: 1, player1_score: 2, player2_score: 0 }));
        oppAch.push({ player_id: i, achievement_id: `global_gym_leader_kanto` });
      }

      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(ids.includes('eight_badges_kanto'), 'should earn 8 Badges Kanto');
    });

    it('does NOT award 8 Badges with only 7 unique Gym Leaders', async () => {
      const matches = [];
      const oppAch = [];
      for (let i = 2; i <= 8; i++) { // only 7
        matches.push(makeMatch({ id: i + 100, player1_id: 1, player2_id: i, winner_id: 1, player1_score: 2, player2_score: 0 }));
        oppAch.push({ player_id: i, achievement_id: `global_gym_leader_kanto` });
      }

      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(!ids.includes('eight_badges_kanto'), 'should not earn with only 7');
    });

    it('awards Elite Trainer when defeating 4 unique Elite Four members', async () => {
      const matches = [];
      const oppAch = [];
      for (let i = 2; i <= 5; i++) {
        matches.push(makeMatch({ id: i + 100, player1_id: 1, player2_id: i, winner_id: 1, player1_score: 2, player2_score: 0 }));
        oppAch.push({ player_id: i, achievement_id: `global_elite_four_kanto` });
      }

      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(ids.includes('elite_trainer_kanto'), 'should earn Elite Trainer Kanto');
    });

    it('Foreshadowing meta unlocks when a single Champion lets you take a game', async () => {
      // Lost 1-2 to a Champion — took one game, should still earn Foreshadowing.
      const matches = [
        makeMatch({ id: 50, player1_id: 1, player2_id: 2, winner_id: 2, player1_score: 1, player2_score: 2 }),
      ];
      const oppAch = [{ player_id: 2, achievement_id: 'global_champion_kanto' }];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      const fs = findAch(result, 'foreshadowing_kanto');
      assert.ok(fs, 'foreshadowing_kanto should fire on game taken from a Champion');
      assert.equal(fs.contributors.length, 1);
      assert.equal(fs.contributors[0].opponent_id, 2);
      assert.equal(fs.contributors[0].match_id, 50);

      // Dark Horse should NOT fire — player lost the match
      assert.ok(!achIds(result).includes('dark_horse_kanto'),
        'dark_horse should require winning the match, not just taking a game');
    });

    it('Foreshadowing/Dark Horse scale by Champion region tier, not by count', async () => {
      // Player defeats opp 2 (Kanto Champion) and opp 3 (Sinnoh Champion)
      const matches = [
        makeMatch({ id: 60, player1_id: 1, player2_id: 2, winner_id: 1, player1_score: 2, player2_score: 0 }),
        makeMatch({ id: 61, player1_id: 1, player2_id: 3, winner_id: 1, player1_score: 2, player2_score: 1 }),
      ];
      const oppAch = [
        { player_id: 2, achievement_id: 'global_champion_kanto' },
        // opp 3 has Champion at Kanto, Johto, Hoenn, Sinnoh tiers (auto-cascade)
        { player_id: 3, achievement_id: 'global_champion_kanto' },
        { player_id: 3, achievement_id: 'global_champion_johto' },
        { player_id: 3, achievement_id: 'global_champion_hoenn' },
        { player_id: 3, achievement_id: 'global_champion_sinnoh' },
      ];
      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      // Dark Horse: Kanto (any), Johto (Johto+), Hoenn (Hoenn+), Sinnoh (Sinnoh+) — all qualify via opp 3
      assert.ok(ids.includes('dark_horse_kanto'),  'Kanto Dark Horse via either champion');
      assert.ok(ids.includes('dark_horse_johto'),  'Johto Dark Horse via Sinnoh-tier champion');
      assert.ok(ids.includes('dark_horse_hoenn'),  'Hoenn Dark Horse via Sinnoh-tier champion');
      assert.ok(ids.includes('dark_horse_sinnoh'), 'Sinnoh Dark Horse via Sinnoh-tier champion');
      assert.ok(!ids.includes('dark_horse_unova'), 'Unova Dark Horse needs an Unova-tier champion');

      // Same for Foreshadowing — game-mode catches both wins (took >=1 game in each)
      assert.ok(ids.includes('foreshadowing_kanto'));
      assert.ok(ids.includes('foreshadowing_sinnoh'));
      assert.ok(!ids.includes('foreshadowing_unova'));
    });

    it('meta achievements respect region tier (Johto+ means kanto-only opponents dont count)', async () => {
      const matches = [];
      const oppAch = [];
      for (let i = 2; i <= 9; i++) {
        matches.push(makeMatch({ id: i + 100, player1_id: 1, player2_id: i, winner_id: 1, player1_score: 2, player2_score: 0 }));
        oppAch.push({ player_id: i, achievement_id: `global_gym_leader_kanto` }); // only kanto
      }

      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);
      const ids = achIds(result);

      assert.ok(ids.includes('eight_badges_kanto'), 'Kanto tier should work');
      assert.ok(!ids.includes('eight_badges_johto'), 'Johto tier should NOT work (opponents only have kanto)');
    });
  });

  describe('meta achievement contributor tracking', () => {

    it('includes all qualifying opponents for 8 Badges', async () => {
      const matches = [];
      const oppAch = [];
      for (let i = 2; i <= 9; i++) {
        matches.push(makeMatch({ id: i + 100, player1_id: 1, player2_id: i, winner_id: 1, player1_score: 2, player2_score: 0 }));
        oppAch.push({ player_id: i, achievement_id: `global_gym_leader_kanto` });
      }

      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      const badges = findAch(result, 'eight_badges_kanto');
      assert.ok(badges, 'should have eight_badges_kanto');
      assert.equal(badges.contributors.length, 8, 'should have 8 contributors (one per Gym Leader)');

      // All contributor opponent_ids should be unique
      const oppIds = badges.contributors.map(c => c.opponent_id);
      const uniqueOppIds = new Set(oppIds);
      assert.equal(uniqueOppIds.size, 8, 'all 8 contributors should be unique opponents');

      // Meta contributors now carry match_id so the modal can link to the
      // tournament where each badge was earned.
      for (const c of badges.contributors) {
        assert.ok(c.opponent_id, 'contributor should have opponent_id');
        assert.ok(c.match_id, 'meta contributors should carry match_id');
      }
    });

    it('includes all qualifying opponents for Elite Trainer', async () => {
      const matches = [];
      const oppAch = [];
      for (let i = 2; i <= 5; i++) {
        matches.push(makeMatch({ id: i + 100, player1_id: 1, player2_id: i, winner_id: 1, player1_score: 2, player2_score: 0 }));
        oppAch.push({ player_id: i, achievement_id: `global_elite_four_kanto` });
      }

      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      const trainer = findAch(result, 'elite_trainer_kanto');
      assert.ok(trainer, 'should have elite_trainer_kanto');
      assert.equal(trainer.contributors.length, 4, 'should have 4 contributors');

      const oppIds = new Set(trainer.contributors.map(c => c.opponent_id));
      assert.equal(oppIds.size, 4, 'all 4 contributors should be unique');
    });

    it('includes more than required opponents when available', async () => {
      // 10 Gym Leaders defeated — 8 required, but all 10 should be in contributors
      const matches = [];
      const oppAch = [];
      for (let i = 2; i <= 11; i++) {
        matches.push(makeMatch({ id: i + 100, player1_id: 1, player2_id: i, winner_id: 1, player1_score: 2, player2_score: 0 }));
        oppAch.push({ player_id: i, achievement_id: `global_gym_leader_kanto` });
      }

      const db = makeMockDb(matches, oppAch);
      const result = await checkAchievementsPass2(1, db, []);

      const badges = findAch(result, 'eight_badges_kanto');
      assert.ok(badges, 'should have eight_badges_kanto');
      assert.equal(badges.contributors.length, 10, 'should include all 10 qualifying opponents, not just 8');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  computeMetaProgress
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeMetaProgress', () => {

  // computeMetaProgress now pulls full match rows so it can support both
  // match-mode meta (defeated opponent) and game-mode meta (took a game).
  // The mock here mirrors the matches-table shape it expects.
  function makeMockDb(matches = [], oppAchievements = []) {
    return {
      query: async (sql, _params) => {
        if (sql.includes('FROM matches')) {
          return { rows: matches };
        }
        if (sql.includes('FROM player_achievements')) {
          return { rows: oppAchievements };
        }
        return { rows: [] };
      },
    };
  }

  // Helper: a match where player 1 beats `oppId` 2-0
  function winOver(oppId) {
    return { player1_id: 1, player2_id: oppId, winner_id: 1, player1_score: 2, player2_score: 0 };
  }
  // Helper: a match where player 1 LOSES to `oppId` 1-2 (took 1 game)
  function lossTakingGame(oppId) {
    return { player1_id: 1, player2_id: oppId, winner_id: oppId, player1_score: 1, player2_score: 2 };
  }

  it('returns empty progress when no matches', async () => {
    const db = makeMockDb([], []);
    const result = await computeMetaProgress(1, db, []);
    assert.deepEqual(result, {});
  });

  it('returns progress with qualifying_opponents', async () => {
    // Player 1 defeated players 2 and 3, who are both Gym Leaders
    const matches = [winOver(2), winOver(3)];
    const oppAch = [
      { player_id: 2, achievement_id: 'global_gym_leader_kanto' },
      { player_id: 3, achievement_id: 'global_gym_leader_kanto' },
    ];
    const db = makeMockDb(matches, oppAch);
    const result = await computeMetaProgress(1, db, []);

    assert.ok(result['eight_badges_kanto'], 'should have progress for eight_badges_kanto');
    assert.equal(result['eight_badges_kanto'].current, 2);
    assert.equal(result['eight_badges_kanto'].required, 8);
    assert.ok(Array.isArray(result['eight_badges_kanto'].qualifying_opponents), 'should have qualifying_opponents array');
    assert.equal(result['eight_badges_kanto'].qualifying_opponents.length, 2);
    assert.ok(result['eight_badges_kanto'].qualifying_opponents.includes(2));
    assert.ok(result['eight_badges_kanto'].qualifying_opponents.includes(3));
  });

  it('skips already unlocked achievements', async () => {
    const matches = [winOver(2)];
    const oppAch = [{ player_id: 2, achievement_id: 'global_gym_leader_kanto' }];
    const db = makeMockDb(matches, oppAch);
    const result = await computeMetaProgress(1, db, ['eight_badges_kanto']);

    assert.ok(!result['eight_badges_kanto'], 'should not show progress for already unlocked');
  });

  it('counts game-mode meta (Foreshadowing) on losses where player took a game', async () => {
    // Lost 1-2 to a Champion — qualifies for Foreshadowing but NOT Dark Horse.
    const matches = [lossTakingGame(2)];
    const oppAch = [{ player_id: 2, achievement_id: 'global_champion_kanto' }];
    const db = makeMockDb(matches, oppAch);
    const result = await computeMetaProgress(1, db, []);

    assert.ok(result['foreshadowing_kanto'], 'foreshadowing should record progress');
    assert.equal(result['foreshadowing_kanto'].current, 1);
    assert.equal(result['foreshadowing_kanto'].required, 1);

    // Dark Horse needs a match win, which didn't happen here
    assert.ok(!result['dark_horse_kanto'], 'dark_horse should NOT have progress on a loss');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  highestRegions
// ═══════════════════════════════════════════════════════════════════════════════

describe('highestRegions', () => {

  it('returns null for all tiers when no achievements', () => {
    const result = highestRegions([]);
    assert.equal(result.gym_leader, null);
    assert.equal(result.elite_four, null);
    assert.equal(result.rival, null);
    assert.equal(result.champion, null);
  });

  it('finds highest region for each tier', () => {
    const achIds = [
      'global_champion_kanto',
      'global_champion_johto',
      'global_champion_hoenn',
      'global_gym_leader_sinnoh',
      'global_elite_four_kanto',
    ];
    const result = highestRegions(achIds);
    assert.equal(result.champion, 'hoenn');
    assert.equal(result.gym_leader, 'sinnoh');
    assert.equal(result.elite_four, 'kanto');
    assert.equal(result.rival, null);
  });

  it('works with series-scoped achievements too', () => {
    const achIds = [
      'ffc_champion_galar',
      'global_champion_kanto',
    ];
    const result = highestRegions(achIds);
    assert.equal(result.champion, 'galar', 'should pick highest across any scope');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getAchievementById
// ═══════════════════════════════════════════════════════════════════════════════

describe('getAchievementById', () => {

  it('returns the correct achievement', () => {
    const ach = getAchievementById('global_champion_kanto');
    assert.ok(ach);
    assert.equal(ach.id, 'global_champion_kanto');
    assert.equal(ach.tier, 'champion');
    assert.equal(ach.region, 'kanto');
  });

  it('returns null for unknown ID', () => {
    assert.equal(getAchievementById('nonexistent_xyz'), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Region constants
// ═══════════════════════════════════════════════════════════════════════════════

describe('Region constants', () => {

  it('has 8 regions in order', () => {
    assert.equal(REGIONS.length, 8);
    assert.equal(REGIONS[0].id, 'kanto');
    assert.equal(REGIONS[7].id, 'galar');
  });

  it('thresholds are strictly increasing', () => {
    for (let i = 1; i < REGIONS.length; i++) {
      assert.ok(REGIONS[i].threshold > REGIONS[i - 1].threshold,
        `${REGIONS[i].id} threshold (${REGIONS[i].threshold}) should be > ${REGIONS[i - 1].id} (${REGIONS[i - 1].threshold})`);
    }
  });

  it('REGION_INDEX maps correctly', () => {
    assert.equal(REGION_INDEX.kanto, 0);
    assert.equal(REGION_INDEX.galar, 7);
    assert.equal(REGION_INDEX.hoenn, 2);
  });
});
    assert.equal(ach.region, 'kanto');
  });

  it('returns null for unknown ID', () => {
    assert.equal(getAchievementById('nonexistent_xyz'), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Region constants
// ═══════════════════════════════════════════════════════════════════════════════

describe('Region constants', () => {

  it('has 8 regions in order', () => {
    assert.equal(REGIONS.length, 8);
    assert.equal(REGIONS[0].id, 'kanto');
    assert.equal(REGIONS[7].id, 'galar');
  });

  it('thresholds are strictly increasing', () => {
    for (let i = 1; i < REGIONS.length; i++) {
      assert.ok(REGIONS[i].threshold > REGIONS[i - 1].threshold,
        `${REGIONS[i].id} threshold (${REGIONS[i].threshold}) should be > ${REGIONS[i - 1].id} (${REGIONS[i - 1].threshold})`);
    }
  });

  it('REGION_INDEX maps correctly', () => {
    assert.equal(REGION_INDEX.kanto, 0);
    assert.equal(REGION_INDEX.galar, 7);
    assert.equal(REGION_INDEX.hoenn, 2);
  });
});

describe('getAchievementById', () => {

  it('returns the correct achievement', () => {
    const ach = getAchievementById('global_champion_kanto');
    assert.ok(ach);
    assert.equal(ach.id, 'global_champion_kanto');
    assert.equal(ach.tier, 'champion');
    assert.equal(ach.region, 'kanto');
  });

  it('returns null for unknown ID', () => {
    assert.equal(getAchievementById('nonexistent_xyz'), null);
  });
});

describe('Region constants', () => {

  it('thresholds are strictly increasing', () => {
    for (let i = 1; i < REGIONS.length; i++) {
      assert.ok(REGIONS[i].threshold > REGIONS[i - 1].threshold,
        `${REGIONS[i].id} threshold (${REGIONS[i].threshold}) should be > ${REGIONS[i - 1].id} (${REGIONS[i - 1].threshold})`);
    }
  });

  it('REGION_INDEX maps correctly', () => {
    assert.equal(REGION_INDEX.kanto, 0);
    assert.equal(REGION_INDEX[REGIONS[REGIONS.length - 1].id], REGIONS.length - 1);
    assert.equal(REGION_INDEX.hoenn, 2);
  });
});
