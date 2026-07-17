/**
 * Unit tests for the arena scoring/pairing rules
 * (backend/src/services/arenaScoring.js — pure functions only; the DB
 * wrappers are exercised by the live-tournament verification pass).
 *
 * Run:  node --test backend/tests/arenaScoring.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  pointsForWin,
  resolveReports,
  computePairings,
  REMATCH_WAIVER_MS,
} = require('../src/services/arenaScoring');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const T0 = 1_700_000_000_000; // fixed "now" for pairing tests

function waiter(user_id, score, waitedMs = 0, last_opponent_user_id = null) {
  return {
    user_id,
    score,
    waiting_since: new Date(T0 - waitedMs),
    last_opponent_user_id,
  };
}

function report(reporter_user_id, winner_user_id, loser_games) {
  return { reporter_user_id, winner_user_id, loser_games };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  pointsForWin — lichess streak scoring
// ═══════════════════════════════════════════════════════════════════════════════

describe('pointsForWin', () => {
  it('is 2 points off-streak (streak 0 or 1 before the win)', () => {
    assert.equal(pointsForWin(0), 2);
    assert.equal(pointsForWin(1), 2);
  });

  it('is 4 points on a 2+ streak', () => {
    assert.equal(pointsForWin(2), 4);
    assert.equal(pointsForWin(3), 4);
    assert.equal(pointsForWin(10), 4);
  });

  it('scores a 4-win run as 2, 2, 4, 4 (total 12)', () => {
    let streak = 0;
    const earned = [];
    for (let i = 0; i < 4; i++) {
      earned.push(pointsForWin(streak));
      streak += 1;
    }
    assert.deepEqual(earned, [2, 2, 4, 4]);
    assert.equal(earned.reduce((a, b) => a + b, 0), 12);
  });

  it('a loss resets the streak, dropping the next win back to 2', () => {
    // W W W (streak now 3), loss (streak 0), W
    assert.equal(pointsForWin(3), 4);
    assert.equal(pointsForWin(0), 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  resolveReports — dual verification
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveReports', () => {
  it('no reports → none', () => {
    assert.equal(resolveReports([]).action, 'none');
    assert.equal(resolveReports(null).action, 'none');
  });

  it('one report → await (awaiting_confirm)', () => {
    assert.equal(resolveReports([report(1, 1, 0)]).action, 'await');
  });

  it('two agreeing reports → confirm with that winner/score', () => {
    const out = resolveReports([report(1, 1, 1), report(2, 1, 1)]);
    assert.equal(out.action, 'confirm');
    assert.equal(out.winner_user_id, 1);
    assert.equal(out.loser_games, 1);
  });

  it('different winners → dispute', () => {
    assert.equal(resolveReports([report(1, 1, 0), report(2, 2, 0)]).action, 'dispute');
  });

  it('same winner but different score → dispute (strict agreement)', () => {
    assert.equal(resolveReports([report(1, 1, 0), report(2, 1, 1)]).action, 'dispute');
  });

  it('converges when a re-report comes to agree (dispute → confirm)', () => {
    // Both claimed themselves the winner → dispute…
    const conflicting = [report(1, 1, 0), report(2, 2, 0)];
    assert.equal(resolveReports(conflicting).action, 'dispute');
    // …then player 2 re-files agreeing with player 1 (upsert replaces their row).
    const converged = [report(1, 1, 0), report(2, 1, 0)];
    const out = resolveReports(converged);
    assert.equal(out.action, 'confirm');
    assert.equal(out.winner_user_id, 1);
  });

  it('coerces string ids/scores from pg rows', () => {
    const out = resolveReports([report('7', '7', '1'), report('9', 7, 1)]);
    assert.equal(out.action, 'confirm');
    assert.equal(out.winner_user_id, 7);
    assert.equal(out.loser_games, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  computePairings — score proximity, tiebreaks, rematch avoidance
// ═══════════════════════════════════════════════════════════════════════════════

describe('computePairings', () => {
  const ids = (pairs) => pairs.map(([a, b]) => [a.user_id, b.user_id]);

  it('pairs an empty or single-player pool as nothing', () => {
    assert.deepEqual(computePairings([], T0), []);
    assert.deepEqual(computePairings([waiter(1, 4)], T0), []);
  });

  it('pairs by score proximity, best score first', () => {
    // 10 & 8 are closest; 2 & 0 pair up behind them.
    const pool = [waiter(1, 10), waiter(2, 8), waiter(3, 2), waiter(4, 0)];
    assert.deepEqual(ids(computePairings(pool, T0)), [[1, 2], [3, 4]]);
  });

  it('breaks equal scores by longest wait first', () => {
    const a = waiter(1, 4, 30_000); // waited longest → seeded first
    const b = waiter(2, 4, 20_000);
    const c = waiter(3, 4, 10_000);
    const d = waiter(4, 4, 0);
    // a pairs with b (equal diff, b waited longer than c/d).
    assert.deepEqual(ids(computePairings([d, c, b, a], T0)), [[1, 2], [3, 4]]);
  });

  it('leaves the odd player out', () => {
    const pool = [waiter(1, 6), waiter(2, 4), waiter(3, 2)];
    const pairs = computePairings(pool, T0);
    assert.equal(pairs.length, 1);
    assert.deepEqual(ids(pairs), [[1, 2]]);
  });

  it('skips an immediate rematch when another candidate exists', () => {
    // 1 and 2 just played each other; 3 is available.
    const pool = [
      waiter(1, 4, 0, 2),
      waiter(2, 4, 0, 1),
      waiter(3, 0, 0, null),
    ];
    // 1 seeds first; closest candidate 2 is their last opponent → picks 3.
    assert.deepEqual(ids(computePairings(pool, T0)), [[1, 3]]);
  });

  it('checks last_opponent in BOTH directions', () => {
    // Only 2 remembers playing 1 (1's row already points elsewhere) — still a rematch.
    const pool = [
      waiter(1, 4, 0, 99),
      waiter(2, 4, 0, 1),
      waiter(3, 0, 0, null),
    ];
    assert.deepEqual(ids(computePairings(pool, T0)), [[1, 3]]);
  });

  it('holds a fresh pair apart rather than forcing the rematch', () => {
    // Just these two, and they just played: no pairing this pass.
    const pool = [waiter(1, 4, 10_000, 2), waiter(2, 2, 10_000, 1)];
    assert.deepEqual(computePairings(pool, T0), []);
  });

  it('allows the rematch once the seeker has waited 45s+', () => {
    const pool = [waiter(1, 4, REMATCH_WAIVER_MS, 2), waiter(2, 2, REMATCH_WAIVER_MS, 1)];
    assert.deepEqual(ids(computePairings(pool, T0)), [[1, 2]]);
  });

  it('does not waive the rematch just under 45s', () => {
    const pool = [waiter(1, 4, REMATCH_WAIVER_MS - 1000, 2), waiter(2, 2, REMATCH_WAIVER_MS - 1000, 1)];
    assert.deepEqual(computePairings(pool, T0), []);
  });

  it('a skipped player does not block the rest of the pool', () => {
    // 1 & 2 just played; 3 & 4 are free to pair with each other.
    const pool = [
      waiter(1, 8, 0, 2),
      waiter(2, 8, 0, 1),
      waiter(3, 6, 0, null),
      waiter(4, 6, 0, null),
    ];
    const pairs = ids(computePairings(pool, T0));
    // 1 pairs with 3 (closest non-rematch); 2 pairs with 4.
    assert.deepEqual(pairs, [[1, 3], [2, 4]]);
  });

  it('accepts ISO-string waiting_since (pg driver variance)', () => {
    const pool = [
      { user_id: 1, score: 2, waiting_since: new Date(T0 - 5000).toISOString(), last_opponent_user_id: null },
      { user_id: 2, score: 2, waiting_since: new Date(T0).toISOString(), last_opponent_user_id: null },
    ];
    assert.deepEqual(ids(computePairings(pool, T0)), [[1, 2]]);
  });
});
