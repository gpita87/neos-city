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
// M2 will add to the tick: pairing passes (score-proximity, no immediate
// rematch, pg_advisory_xact_lock per tournament), 5-min auto-confirm of
// single-report matches, and the zombie-match cap.

const db = require('../db');
const socket = require('../socket');
const { getStandings, getTournamentRow, tournamentUpdatePayload, endsAtSql } = require('./arenaState');

const TICK_MS = 5000;
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

// Pairing pass for one live tournament. M1 ships the lifecycle only — this is
// the seam routes already call after register/resume so M2 can drop the real
// algorithm in without touching callers.
async function pairTournament(tournamentId) { // eslint-disable-line no-unused-vars
  // M2: transaction + pg_advisory_xact_lock(tournamentId); pair waiting
  // players by score proximity, avoiding immediate rematches.
}

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
    await pairTournament(t.id);
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

  // 3. finished → finalized once every match is terminal
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
};
