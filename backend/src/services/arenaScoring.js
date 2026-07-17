// Arena scoring + pairing decisions — the rules of the game.
//
// Split in two layers so the rules are unit-testable without a DB:
//   • Pure functions (pointsForWin, resolveReports, computePairings) hold ALL
//     the decision logic. Tests: backend/tests/arenaScoring.test.js.
//   • DB wrappers (applyReport, adminResolve, autoConfirmDue, cancelZombieMatches)
//     run those decisions inside transactions. They do NOT emit socket events
//     or trigger re-pairing — callers (routes/arena.js, arenaEngine's tick)
//     handle side effects via arenaEngine.handleScoringOutcome, which keeps
//     this module free of a circular require on arenaEngine.
//
// Dual-verification lifecycle for a match:
//   active → (1st report) → awaiting_confirm
//          → (2nd report agrees)    → confirmed  (confirm_method 'agreed')
//          → (2nd report conflicts) → disputed   (re-reports may converge;
//                                                 admin resolve overrides)
//   awaiting_confirm 5+ min old     → confirmed  (confirm_method 'auto', engine tick)
//   active 15+ min past clock end   → cancelled  (zombie cap, engine tick)
//
// Lichess scoring: win = 2 pts; each win while already ON a 2+ streak = 4 pts.
// Trailing matches (tournament 'finished') score through this same path —
// only NEW pairings gate on 'live'.

const db = require('../db');

const OPEN_STATUSES = ['active', 'awaiting_confirm', 'disputed'];
const AUTO_CONFIRM_MINUTES = 5;
const ZOMBIE_GRACE_MINUTES = 15;
const REMATCH_WAIVER_MS = 45 * 1000;

// ── Pure functions ───────────────────────────────────────────────────────────

// Points for a win given the winner's streak BEFORE this match.
// Streak sequence from zero: 2, 2, 4, 4, 4, ...
function pointsForWin(streakBefore) {
  return streakBefore >= 2 ? 4 : 2;
}

// Decide what the current set of reports (0–2 rows of
// {winner_user_id, loser_games}) means for the match.
//   → { action: 'none' | 'await' | 'confirm' | 'dispute', winner_user_id?, loser_games? }
// Agreement is strict: same winner AND same score. A same-winner/different-score
// pair is still a dispute — one of the two is misreporting something.
function resolveReports(reports) {
  if (!reports || reports.length === 0) return { action: 'none' };
  if (reports.length === 1) return { action: 'await' };
  const [a, b] = reports;
  if (Number(a.winner_user_id) === Number(b.winner_user_id)
      && Number(a.loser_games) === Number(b.loser_games)) {
    return { action: 'confirm', winner_user_id: Number(a.winner_user_id), loser_games: Number(a.loser_games) };
  }
  return { action: 'dispute' };
}

function tsMs(v) {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

// Score-proximity pairing over the waiting pool. Input rows:
//   { user_id, score, waiting_since, last_opponent_user_id }
// Returns [[a, b], ...] pairs of those rows.
//
// Walks the pool best-score-first (waiting_since breaks ties); each player is
// matched to the candidate with the closest score. An immediate rematch
// (either side's last_opponent) is skipped unless the seeking player has
// already waited 45s+ — better a rematch than a player idling forever in a
// small pool. A player with no legal candidate sits out this pass and keeps
// their waiting_since priority for the next one.
function computePairings(waiting, nowMs = tsMs(new Date())) {
  const queue = [...waiting].sort(
    (x, y) => y.score - x.score || tsMs(x.waiting_since) - tsMs(y.waiting_since)
  );
  const pairs = [];
  while (queue.length >= 2) {
    const p = queue.shift();
    const candidates = [...queue].sort(
      (x, y) => Math.abs(x.score - p.score) - Math.abs(y.score - p.score)
        || tsMs(x.waiting_since) - tsMs(y.waiting_since)
    );
    const isRematch = (c) =>
      Number(c.user_id) === Number(p.last_opponent_user_id)
      || Number(c.last_opponent_user_id) === Number(p.user_id);
    let chosen = candidates.find((c) => !isRematch(c));
    if (!chosen && nowMs - tsMs(p.waiting_since) >= REMATCH_WAIVER_MS) {
      chosen = candidates[0]; // rematch waiver
    }
    if (!chosen) continue;
    queue.splice(queue.indexOf(chosen), 1);
    pairs.push([p, chosen]);
  }
  return pairs;
}

// ── DB wrappers ──────────────────────────────────────────────────────────────

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Confirm a match inside an existing transaction: set the match terminal and
// apply points/streaks to both participants. Participant rows are locked in
// user_id order (deterministic, deadlock-safe). Returns the outcome summary
// the caller feeds to arenaEngine.handleScoringOutcome.
async function confirmMatchTx(client, match, winnerUserId, loserGames, confirmMethod) {
  const loserUserId = Number(winnerUserId) === Number(match.p1_user_id)
    ? match.p2_user_id : match.p1_user_id;

  const { rows: parts } = await client.query(
    `SELECT user_id, streak FROM arena_participants
     WHERE tournament_id = $1 AND user_id = ANY($2)
     ORDER BY user_id FOR UPDATE`,
    [match.tournament_id, [match.p1_user_id, match.p2_user_id]]
  );
  const winnerRow = parts.find((p) => Number(p.user_id) === Number(winnerUserId));
  const points = pointsForWin(winnerRow ? winnerRow.streak : 0);

  await client.query(
    `UPDATE arena_matches
     SET status = 'confirmed', winner_user_id = $2, winner_games = 2, loser_games = $3,
         winner_points = $4, confirm_method = $5, completed_at = NOW()
     WHERE id = $1`,
    [match.id, winnerUserId, loserGames, points, confirmMethod]
  );
  await client.query(
    `UPDATE arena_participants
     SET score = score + $3, streak = streak + 1, wins = wins + 1, waiting_since = NOW()
     WHERE tournament_id = $1 AND user_id = $2`,
    [match.tournament_id, winnerUserId]
  );
  await client.query(
    `UPDATE arena_participants
     SET streak = 0, losses = losses + 1, waiting_since = NOW()
     WHERE tournament_id = $1 AND user_id = $2`,
    [match.tournament_id, loserUserId]
  );

  return {
    status: 'confirmed',
    match_id: match.id,
    tournament_id: match.tournament_id,
    p1_user_id: match.p1_user_id,
    p2_user_id: match.p2_user_id,
    winner_user_id: Number(winnerUserId),
    winner_points: points,
    confirm_method: confirmMethod,
  };
}

// A player files (or re-files) their result. Throws httpError(status, msg) on
// bad input; returns the outcome summary otherwise.
async function applyReport({ matchId, reporterUserId, winnerUserId, loserGames }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [match] } = await client.query(
      `SELECT * FROM arena_matches WHERE id = $1 FOR UPDATE`, [matchId]
    );
    if (!match) throw httpError(404, 'Match not found');
    const players = [Number(match.p1_user_id), Number(match.p2_user_id)];
    if (!players.includes(Number(reporterUserId))) {
      throw httpError(403, 'Only the two players in this match can report its result');
    }
    if (!OPEN_STATUSES.includes(match.status)) {
      throw httpError(409, `Match is already ${match.status}`);
    }
    if (!players.includes(Number(winnerUserId))) {
      throw httpError(400, 'winner_user_id must be one of the two players');
    }
    if (![0, 1].includes(Number(loserGames))) {
      throw httpError(400, 'loser_games must be 0 or 1 (best 2 of 3)');
    }

    await client.query(
      `INSERT INTO arena_match_reports (match_id, reporter_user_id, winner_user_id, loser_games)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (match_id, reporter_user_id)
       DO UPDATE SET winner_user_id = $3, loser_games = $4, reported_at = NOW()`,
      [matchId, reporterUserId, winnerUserId, Number(loserGames)]
    );

    const { rows: reports } = await client.query(
      `SELECT reporter_user_id, winner_user_id, loser_games FROM arena_match_reports WHERE match_id = $1`,
      [matchId]
    );
    const decision = resolveReports(reports);

    let outcome;
    if (decision.action === 'confirm') {
      outcome = await confirmMatchTx(client, match, decision.winner_user_id, decision.loser_games, 'agreed');
    } else if (decision.action === 'dispute') {
      await client.query(`UPDATE arena_matches SET status = 'disputed' WHERE id = $1`, [matchId]);
      outcome = baseOutcome(match, 'disputed');
    } else {
      await client.query(
        `UPDATE arena_matches
         SET status = 'awaiting_confirm', first_reported_at = COALESCE(first_reported_at, NOW())
         WHERE id = $1`,
        [matchId]
      );
      outcome = baseOutcome(match, 'awaiting_confirm');
    }
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Admin force-confirm of a stuck/disputed match (confirm_method 'admin').
async function adminResolve({ matchId, winnerUserId, loserGames }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [match] } = await client.query(
      `SELECT * FROM arena_matches WHERE id = $1 FOR UPDATE`, [matchId]
    );
    if (!match) throw httpError(404, 'Match not found');
    if (!OPEN_STATUSES.includes(match.status)) {
      throw httpError(409, `Match is already ${match.status}`);
    }
    const players = [Number(match.p1_user_id), Number(match.p2_user_id)];
    if (!players.includes(Number(winnerUserId))) {
      throw httpError(400, 'winner_user_id must be one of the two players');
    }
    if (![0, 1].includes(Number(loserGames))) {
      throw httpError(400, 'loser_games must be 0 or 1 (best 2 of 3)');
    }
    const outcome = await confirmMatchTx(client, match, winnerUserId, Number(loserGames), 'admin');
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Engine tick: confirm awaiting_confirm matches whose single report is 5+ min
// old — the silent opponent forfeits their veto. Each match gets its own
// transaction; a race with a just-landed second report is settled by the
// re-check under FOR UPDATE. Returns outcome summaries for the engine to emit.
async function autoConfirmDue() {
  const { rows: due } = await db.query(
    `SELECT id FROM arena_matches
     WHERE status = 'awaiting_confirm'
       AND first_reported_at <= NOW() - INTERVAL '${AUTO_CONFIRM_MINUTES} minutes'`
  );
  const outcomes = [];
  for (const { id } of due) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [match] } = await client.query(
        `SELECT * FROM arena_matches WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!match || match.status !== 'awaiting_confirm') {
        await client.query('ROLLBACK');
        continue;
      }
      const { rows: reports } = await client.query(
        `SELECT reporter_user_id, winner_user_id, loser_games FROM arena_match_reports WHERE match_id = $1`,
        [id]
      );
      // Normally exactly one report here; resolveReports also covers the edge
      // where a second agreeing report landed without a status flip.
      const decision = resolveReports(reports);
      const single = reports[0];
      const winner = decision.action === 'confirm' ? decision.winner_user_id : Number(single.winner_user_id);
      const games = decision.action === 'confirm' ? decision.loser_games : Number(single.loser_games);
      const outcome = await confirmMatchTx(client, match, winner, games, 'auto');
      await client.query('COMMIT');
      outcomes.push(outcome);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[arena] auto-confirm of match ${id} failed:`, err.message);
    } finally {
      client.release();
    }
  }
  return outcomes;
}

// Engine tick: cancel report-less 'active' matches 15+ min past their
// tournament's clock end so finalization can't hang on ghosts. Matches with
// any report auto-confirm instead; disputed ones wait for an admin.
async function cancelZombieMatches() {
  const { rows } = await db.query(
    `UPDATE arena_matches m
     SET status = 'cancelled', completed_at = NOW()
     FROM arena_tournaments t
     WHERE t.id = m.tournament_id
       AND m.status = 'active'
       AND t.status = 'finished'
       AND NOW() >= t.starts_at + (t.duration_minutes * INTERVAL '1 minute')
                   + INTERVAL '${ZOMBIE_GRACE_MINUTES} minutes'
     RETURNING m.id AS match_id, m.tournament_id, m.p1_user_id, m.p2_user_id`
  );
  return rows.map((r) => ({ ...r, status: 'cancelled', winner_user_id: null }));
}

function baseOutcome(match, status) {
  return {
    status,
    match_id: match.id,
    tournament_id: match.tournament_id,
    p1_user_id: match.p1_user_id,
    p2_user_id: match.p2_user_id,
    winner_user_id: null,
  };
}

module.exports = {
  // pure
  pointsForWin,
  resolveReports,
  computePairings,
  REMATCH_WAIVER_MS,
  // db
  applyReport,
  adminResolve,
  autoConfirmDue,
  cancelZombieMatches,
};
