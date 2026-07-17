// Arena tournament engine — stateless and DB-driven, so a server restart
// mid-tournament loses nothing: every tick re-derives all state from Postgres.
//
// One global interval (~5s), started from app.js next to the other pollers.
// Lifecycle it drives:
//   scheduled → live       when NOW() >= starts_at         (pairing opens)
//   live      → finished   when the clock expires          (no NEW pairings;
//                                                           trailing matches finish)
//   finished  → finalized  when zero non-terminal matches  (standings frozen)
//
// Each tick also: auto-confirms single-report matches 5+ min old, cancels
// report-less zombie matches 15+ min past the clock, and runs a pairing pass
// for every live tournament. Pairing is ALSO event-driven (register/resume/
// confirm call pairTournament directly); the advisory lock makes the two
// entry points safe to overlap.

const db = require('../db');
const socket = require('../socket');
const {
  getStandings, getTournamentRow, tournamentUpdatePayload, endsAtSql,
} = require('./arenaState');
const { computePairings, autoConfirmDue, cancelZombieMatches } = require('./arenaScoring');

const TICK_MS = 5000;
// Namespace for pg_advisory_xact_lock(ns, tournament_id) — arbitrary but fixed,
// so arena pairing locks can never collide with other app locks.
const PAIR_LOCK_NS = 74201;
let timer = null;

async function emitTournamentUpdate(tournamentId) {
  const t = await getTournamentRow(tournamentId);
  if (t) socket.emitTournament(tournamentId, 'tournament:update', tournamentUpdatePayload(t));
}

async function emitScoreboard(tournamentId) {
  const standings = await getStandings(tournamentId);
  socket.emitTournament(tournamentId, 'scoreboard:update', {
    tournamentId,
    standings,
    server_now: new Date().toISOString(),
  });
}

// Push a match state change to everyone who cares: the match room (both
// players + admins) and each player's personal room, so a client that never
// joined the match room still hears about it. Payload is a nudge — clients
// refetch the REST snapshot for full detail.
function emitMatchUpdate(outcome) {
  const payload = {
    matchId: outcome.match_id,
    tournamentId: outcome.tournament_id,
    status: outcome.status,
    winner_user_id: outcome.winner_user_id ?? null,
    server_now: new Date().toISOString(),
  };
  socket.emitMatch(outcome.match_id, 'match:update', payload);
  socket.emitUser(outcome.p1_user_id, 'match:update', payload);
  socket.emitUser(outcome.p2_user_id, 'match:update', payload);
}

// Everything that has to happen AFTER a scoring transaction commits:
// tell the players, refresh the board, and (if the clock is still running)
// feed the two freed players back into the pairing pool. Trailing matches
// (tournament 'finished') score normally — they just don't re-pair.
async function handleScoringOutcome(outcome) {
  emitMatchUpdate(outcome);
  if (outcome.status !== 'confirmed') return;
  await emitScoreboard(outcome.tournament_id);
  const t = await getTournamentRow(outcome.tournament_id);
  if (t && t.status === 'live') await pairTournament(outcome.tournament_id);
}

// ── Pairing ──────────────────────────────────────────────────────────────────

// Announce one freshly created pairing: a public nudge to the tournament room
// and a targeted match:assigned (with opponent identity + shared groups) to
// each player. Runs after commit — a lost emit is only a missed push; the 10s
// REST poll fallback still surfaces the match.
async function announcePairing(match) {
  const { rows: players } = await db.query(
    `SELECT u.id AS user_id, u.region, u.ingame_name,
            COALESCE(pl.display_name, u.display_name, u.discord_username, 'Player ' || u.id) AS name,
            COALESCE(pl.avatar_url, u.avatar_url) AS avatar_url
     FROM users u LEFT JOIN players pl ON pl.id = u.player_id
     WHERE u.id = ANY($1)`,
    [[match.p1_user_id, match.p2_user_id]]
  );
  const { rows: sharedGroups } = await db.query(
    `SELECT g.id, g.name, g.ruleset
     FROM pokken_groups g
     JOIN user_groups a ON a.group_id = g.id AND a.user_id = $1
     JOIN user_groups b ON b.group_id = g.id AND b.user_id = $2
     WHERE g.active
     ORDER BY g.name`,
    [match.p1_user_id, match.p2_user_id]
  );
  const byId = new Map(players.map((p) => [Number(p.user_id), p]));
  const server_now = new Date().toISOString();

  socket.emitTournament(match.tournament_id, 'pairing:new', {
    matchId: match.id,
    tournamentId: match.tournament_id,
    p1: byId.get(Number(match.p1_user_id)) || null,
    p2: byId.get(Number(match.p2_user_id)) || null,
    server_now,
  });
  for (const [me, them] of [[match.p1_user_id, match.p2_user_id], [match.p2_user_id, match.p1_user_id]]) {
    socket.emitUser(me, 'match:assigned', {
      matchId: match.id,
      tournamentId: match.tournament_id,
      opponent: byId.get(Number(them)) || null,
      sharedGroups,
      server_now,
    });
  }
}

// Pairing pass for one tournament. Serialized per tournament via an advisory
// xact lock so the 5s tick and the event-driven calls (register/resume/
// confirm) can never double-pair a player. Never throws — a failed pass just
// logs; the next tick retries.
async function pairTournament(tournamentId) {
  const created = [];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [PAIR_LOCK_NS, tournamentId]);

    // Status re-checked under the lock: only a live clock opens new pairings.
    const { rows: [t] } = await client.query(
      `SELECT id, status FROM arena_tournaments WHERE id = $1`, [tournamentId]
    );
    if (!t || t.status !== 'live') {
      await client.query('ROLLBACK');
      return [];
    }

    // Waiting pool: active participants with no open match.
    const { rows: waiting } = await client.query(
      `SELECT ap.user_id, ap.score, ap.waiting_since, ap.last_opponent_user_id
       FROM arena_participants ap
       WHERE ap.tournament_id = $1 AND ap.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM arena_matches m
           WHERE m.tournament_id = $1
             AND m.status IN ('active', 'awaiting_confirm', 'disputed')
             AND (m.p1_user_id = ap.user_id OR m.p2_user_id = ap.user_id)
         )
       ORDER BY ap.score DESC, ap.waiting_since ASC`,
      [tournamentId]
    );

    for (const [a, b] of computePairings(waiting)) {
      const { rows: [match] } = await client.query(
        `INSERT INTO arena_matches (tournament_id, p1_user_id, p2_user_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [tournamentId, a.user_id, b.user_id]
      );
      await client.query(
        `UPDATE arena_participants
         SET last_opponent_user_id = CASE user_id WHEN $2 THEN $3 ELSE $2 END
         WHERE tournament_id = $1 AND user_id IN ($2, $3)`,
        [tournamentId, a.user_id, b.user_id]
      );
      created.push(match);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[arena] pairing pass for tournament ${tournamentId} failed:`, err.message);
    return [];
  } finally {
    client.release();
  }

  for (const match of created) {
    await announcePairing(match).catch((err) =>
      console.error(`[arena] announce pairing ${match.id} failed:`, err.message));
  }
  return created;
}

// ── Tick ─────────────────────────────────────────────────────────────────────

async function tick() {
  // 1. scheduled → live
  const { rows: started } = await db.query(
    `UPDATE arena_tournaments SET status = 'live'
     WHERE status = 'scheduled' AND starts_at <= NOW()
     RETURNING id`
  );
  for (const t of started) {
    console.log(`[arena] tournament ${t.id} is LIVE`);
    await emitTournamentUpdate(t.id);
  }

  // 2. live → finished (clock expired; trailing matches keep going)
  const { rows: ended } = await db.query(
    `UPDATE arena_tournaments t SET status = 'finished'
     WHERE t.status = 'live' AND NOW() >= ${endsAtSql()}
     RETURNING id`
  );
  for (const t of ended) {
    console.log(`[arena] tournament ${t.id} clock expired — trailing matches only`);
    await emitTournamentUpdate(t.id);
  }

  // 3. Auto-confirm single-report matches 5+ min old (silent opponent
  //    forfeits their veto). Scores + possibly re-pairs via the normal path.
  for (const outcome of await autoConfirmDue()) {
    console.log(`[arena] match ${outcome.match_id} auto-confirmed`);
    await handleScoringOutcome(outcome);
  }

  // 4. Zombie cap: report-less active matches 15+ min past the clock are
  //    cancelled (no points) so finalization can't hang. Disputed matches
  //    wait for an admin instead.
  for (const outcome of await cancelZombieMatches()) {
    console.log(`[arena] match ${outcome.match_id} cancelled as zombie`);
    emitMatchUpdate(outcome);
  }

  // 5. finished → finalized once every match is terminal
  const { rows: finalized } = await db.query(
    `UPDATE arena_tournaments t SET status = 'finalized', finalized_at = NOW()
     WHERE t.status = 'finished'
       AND NOT EXISTS (
         SELECT 1 FROM arena_matches m
         WHERE m.tournament_id = t.id
           AND m.status IN ('active', 'awaiting_confirm', 'disputed')
       )
     RETURNING id`
  );
  for (const t of finalized) {
    console.log(`[arena] tournament ${t.id} FINALIZED`);
    await emitTournamentUpdate(t.id);
    await emitScoreboard(t.id);
  }

  // 6. Pairing pass for every live tournament (covers newly-live ones from
  //    step 1 in the same tick). Event-driven calls between ticks keep
  //    pairing snappy; this pass is the safety net (e.g. the 45s rematch
  //    waiver only unlocks by re-checking).
  const { rows: live } = await db.query(
    `SELECT id FROM arena_tournaments WHERE status = 'live'`
  );
  for (const t of live) {
    await pairTournament(t.id);
  }
}

function startArenaEngine() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => console.error('[arena] tick failed:', err.message));
  }, TICK_MS);
  console.log('⚔️  Arena engine started (5s tick)');
}

function stopArenaEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startArenaEngine,
  stopArenaEngine,
  pairTournament,
  emitScoreboard,
  emitTournamentUpdate,
  emitMatchUpdate,
  handleScoringOutcome,
};
