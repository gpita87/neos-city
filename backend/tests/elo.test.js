/**
 * Unit tests for the ELO rating system (backend/src/services/elo.js)
 *
 * Run:  node --test backend/tests/elo.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  STARTING_ELO,
  calculateNewRatings,
  placementBonus,
  processTournamentResults,
} = require('../src/services/elo');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlayer(elo = 1200, games_played = 0) {
  return { elo, games_played };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STARTING_ELO
// ═══════════════════════════════════════════════════════════════════════════════

describe('STARTING_ELO', () => {
  it('should be 1200', () => {
    assert.equal(STARTING_ELO, 1200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  calculateNewRatings
// ═══════════════════════════════════════════════════════════════════════════════

describe('calculateNewRatings', () => {

  describe('equal-rated new players', () => {
    it('winner gains and loser loses equal points', () => {
      const a = makePlayer(1200, 5);
      const b = makePlayer(1200, 5);
      const result = calculateNewRatings(a, b, 1); // A wins

      assert.ok(result.playerA.delta > 0, 'winner delta should be positive');
      assert.ok(result.playerB.delta < 0, 'loser delta should be negative');
      assert.equal(result.playerA.delta, -result.playerB.delta, 'deltas should be symmetric for equal K');
    });

    it('new players (K=32) should gain/lose 16 points when equal-rated', () => {
      const a = makePlayer(1200, 5);
      const b = makePlayer(1200, 5);
      const result = calculateNewRatings(a, b, 1);

      // Expected score = 0.5 for equal ratings, so delta = K * (1 - 0.5) = 16
      assert.equal(result.playerA.delta, 16);
      assert.equal(result.playerB.delta, -16);
    });
  });

  describe('K-factor tiers', () => {
    it('established player (30+ games, <2000) uses K=24', () => {
      const a = makePlayer(1500, 50);
      const b = makePlayer(1500, 50);
      const result = calculateNewRatings(a, b, 1);

      // K=24, expected=0.5 → delta = 24 * 0.5 = 12
      assert.equal(result.playerA.delta, 12);
    });

    it('top player (2000+) uses K=16', () => {
      const a = makePlayer(2100, 100);
      const b = makePlayer(2100, 100);
      const result = calculateNewRatings(a, b, 1);

      // K=16, expected=0.5 → delta = 16 * 0.5 = 8
      assert.equal(result.playerA.delta, 8);
    });

    it('mixed K-factors: new player vs established', () => {
      const newbie = makePlayer(1200, 5);   // K=32
      const vet    = makePlayer(1200, 50);  // K=24
      const result = calculateNewRatings(newbie, vet, 1); // newbie wins

      assert.equal(result.playerA.delta, 16, 'newbie gains K=32 * 0.5 = 16');
      assert.equal(result.playerB.delta, -12, 'vet loses K=24 * 0.5 = -12');
    });
  });

  describe('upset scenarios (rating difference)', () => {
    it('large upset: low-rated player beats high-rated player', () => {
      const underdog = makePlayer(1000, 5);  // K=32
      const favorite = makePlayer(1400, 5);  // K=32
      const result = calculateNewRatings(underdog, favorite, 1); // underdog wins

      assert.ok(result.playerA.delta > 16, 'underdog should gain more than 16');
      assert.ok(result.playerB.delta < -16, 'favorite should lose more than 16');
    });

    it('expected result: high-rated beats low-rated yields small gain', () => {
      const favorite = makePlayer(1600, 5);
      const underdog = makePlayer(1000, 5);
      const result = calculateNewRatings(favorite, underdog, 1);

      assert.ok(result.playerA.delta < 16, 'expected winner gains little');
      assert.ok(result.playerA.delta > 0, 'but still gains something');
    });
  });

  describe('playerB wins (result = 0)', () => {
    it('correctly handles playerB winning', () => {
      const a = makePlayer(1200, 5);
      const b = makePlayer(1200, 5);
      const result = calculateNewRatings(a, b, 0); // B wins

      assert.equal(result.playerA.delta, -16);
      assert.equal(result.playerB.delta, 16);
    });
  });

  describe('draw (result = 0.5)', () => {
    it('equal-rated draw produces zero deltas', () => {
      const a = makePlayer(1200, 5);
      const b = makePlayer(1200, 5);
      const result = calculateNewRatings(a, b, 0.5);

      assert.equal(result.playerA.delta, 0);
      assert.equal(result.playerB.delta, 0);
    });

    it('draw between unequal ratings: lower-rated gains, higher loses', () => {
      const weaker  = makePlayer(1000, 5);
      const stronger = makePlayer(1400, 5);
      const result = calculateNewRatings(weaker, stronger, 0.5);

      assert.ok(result.playerA.delta > 0, 'weaker player gains from draw');
      assert.ok(result.playerB.delta < 0, 'stronger player loses from draw');
    });
  });

  describe('ELO can go below starting value', () => {
    it('no floor — rating can drop below 1200', () => {
      // Simulate repeated losses
      let rating = 1200;
      for (let i = 0; i < 20; i++) {
        const loser = makePlayer(rating, i);
        const winner = makePlayer(1400, 50);
        const result = calculateNewRatings(loser, winner, 0);
        rating = result.playerA.newElo;
      }
      assert.ok(rating < 1200, `after 20 losses, rating (${rating}) should be below 1200`);
      assert.ok(rating < 1100, `rating should have dropped significantly (got ${rating})`);
    });
  });

  describe('mathematical properties', () => {
    it('total ELO change is zero-sum when K-factors match', () => {
      const a = makePlayer(1350, 10);
      const b = makePlayer(1250, 10);
      const result = calculateNewRatings(a, b, 1);

      // Same K-factor bracket → zero-sum
      assert.equal(result.playerA.delta + result.playerB.delta, 0);
    });

    it('newElo = elo + delta for both players', () => {
      const a = makePlayer(1300, 20);
      const b = makePlayer(1100, 40);
      const result = calculateNewRatings(a, b, 1);

      assert.equal(result.playerA.newElo, a.elo + result.playerA.delta);
      assert.equal(result.playerB.newElo, b.elo + result.playerB.delta);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  placementBonus
// ═══════════════════════════════════════════════════════════════════════════════

// Placement bonuses are deliberately disabled (see elo.js): the old
// +50/+30/+20/+10/+5 tiers caused runaway ELO inflation. The function is kept
// so call sites (tournaments.js, recalculate_elo.js) can guard on bonus > 0.
describe('placementBonus', () => {

  it('returns 0 for every placement — bonuses are disabled', () => {
    assert.equal(placementBonus(1, 16), 0);
    assert.equal(placementBonus(1, 64), 0);
    assert.equal(placementBonus(2, 16), 0);
    assert.equal(placementBonus(3, 16), 0);
    assert.equal(placementBonus(4, 16), 0);
    assert.equal(placementBonus(8, 64), 0);
    assert.equal(placementBonus(16, 64), 0);
    assert.equal(placementBonus(32, 64), 0);
  });

  it('returns 0 for tiny brackets too', () => {
    assert.equal(placementBonus(1, 1), 0);
    assert.equal(placementBonus(1, 2), 0);
    assert.equal(placementBonus(1, 3), 0);
    assert.equal(placementBonus(1, 4), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  processTournamentResults
// ═══════════════════════════════════════════════════════════════════════════════

describe('processTournamentResults', () => {

  function makeParticipant(id, challonge_id, elo = 1200, games = 0, rank = null, total = null) {
    return {
      id,
      challonge_participant_id: challonge_id,
      elo_rating: elo,
      games_played: games,
      final_rank: rank,
      total_in_tournament: total,
    };
  }

  it('processes a simple 2-player bracket', () => {
    const participants = [
      makeParticipant(1, 'p1', 1200, 0, 1, 2),  // winner — no bonus (total < 4)
      makeParticipant(2, 'p2', 1200, 0, 2, 2),
    ];
    const matches = [
      {
        player1_challonge_id: 'p1',
        player2_challonge_id: 'p2',
        winner_challonge_id: 'p1',
        winner_id: 1,
      },
    ];

    const { eloUpdates, playerMap } = processTournamentResults(matches, participants);

    // Should have 2 updates from the match (no placement bonus since total < 4)
    assert.equal(eloUpdates.length, 2);
    assert.ok(eloUpdates[0].delta > 0, 'winner gained ELO');
    assert.ok(eloUpdates[1].delta < 0, 'loser lost ELO');
  });

  it('emits no placement-bonus updates (bonuses are disabled)', () => {
    const participants = [
      makeParticipant(1, 'p1', 1200, 0, 1, 8),
      makeParticipant(2, 'p2', 1200, 0, 2, 8),
      makeParticipant(3, 'p3', 1200, 0, 3, 8),
    ];
    const matches = [
      { player1_challonge_id: 'p1', player2_challonge_id: 'p2', winner_challonge_id: 'p1', winner_id: 1 },
      { player1_challonge_id: 'p1', player2_challonge_id: 'p3', winner_challonge_id: 'p1', winner_id: 1 },
    ];

    const { eloUpdates } = processTournamentResults(matches, participants);

    // 2 matches × 2 updates, and nothing else — no bonus rows even with ranks set
    const bonuses = eloUpdates.filter(u => u.reason);
    assert.equal(bonuses.length, 0, 'placement bonuses are disabled');
    assert.equal(eloUpdates.length, 4);
  });

  it('skips matches with missing players', () => {
    const participants = [
      makeParticipant(1, 'p1', 1200, 0),
    ];
    const matches = [
      { player1_challonge_id: 'p1', player2_challonge_id: 'p_unknown', winner_challonge_id: 'p1', winner_id: 1 },
    ];

    const { eloUpdates } = processTournamentResults(matches, participants);
    assert.equal(eloUpdates.length, 0, 'should skip match with unknown participant');
  });

  it('skips matches with no winner', () => {
    const participants = [
      makeParticipant(1, 'p1', 1200, 0),
      makeParticipant(2, 'p2', 1200, 0),
    ];
    const matches = [
      { player1_challonge_id: 'p1', player2_challonge_id: 'p2', winner_challonge_id: null, winner_id: null },
    ];

    const { eloUpdates } = processTournamentResults(matches, participants);
    assert.equal(eloUpdates.length, 0, 'no updates for incomplete match');
  });

  it('accumulates ELO across multiple matches (same player)', () => {
    const participants = [
      makeParticipant(1, 'p1', 1200, 0, null, null),
      makeParticipant(2, 'p2', 1200, 0, null, null),
      makeParticipant(3, 'p3', 1200, 0, null, null),
    ];
    const matches = [
      { player1_challonge_id: 'p1', player2_challonge_id: 'p2', winner_challonge_id: 'p1', winner_id: 1 },
      { player1_challonge_id: 'p1', player2_challonge_id: 'p3', winner_challonge_id: 'p1', winner_id: 1 },
    ];

    const { playerMap } = processTournamentResults(matches, participants);
    const p1 = playerMap.get('p1');

    // p1 won both matches — ELO should be > starting
    assert.ok(p1.elo > 1200, 'player who won 2 matches should be above 1200');
    assert.equal(p1.games_played, 2, 'should have 2 games played');
  });

  it('match order matters for ELO calculation', () => {
    // Player A beats C (gains ELO), then B beats A (B should gain less because A is now higher-rated)
    const participants = [
      makeParticipant(1, 'a', 1200, 0),
      makeParticipant(2, 'b', 1200, 0),
      makeParticipant(3, 'c', 1200, 0),
    ];

    const matchesOrder1 = [
      { player1_challonge_id: 'a', player2_challonge_id: 'c', winner_challonge_id: 'a', winner_id: 1 },
      { player1_challonge_id: 'b', player2_challonge_id: 'a', winner_challonge_id: 'b', winner_id: 2 },
    ];

    const result1 = processTournamentResults(matchesOrder1, participants);
    const bElo1 = result1.playerMap.get('b').elo;

    // Reset and reverse order
    const participants2 = [
      makeParticipant(1, 'a', 1200, 0),
      makeParticipant(2, 'b', 1200, 0),
      makeParticipant(3, 'c', 1200, 0),
    ];

    const matchesOrder2 = [
      { player1_challonge_id: 'b', player2_challonge_id: 'a', winner_challonge_id: 'b', winner_id: 2 },
      { player1_challonge_id: 'a', player2_challonge_id: 'c', winner_challonge_id: 'a', winner_id: 1 },
    ];

    const result2 = processTournamentResults(matchesOrder2, participants2);
    const bElo2 = result2.playerMap.get('b').elo;

    // B beats A in both cases, but A's rating is different depending on order
    assert.notEqual(bElo1, bElo2, 'ELO should differ based on match order');
  });
});
