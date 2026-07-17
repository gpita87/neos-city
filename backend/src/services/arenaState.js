// Shared read helpers for the Arena feature. Used by both routes/arena.js and
// services/arenaEngine.js (lives here so neither imports the other).
//
// Display-name resolution: arena identity keys on users(id); a user with a
// claimed player shows the player's display_name, otherwise their account
// display_name / Discord username.

const db = require('../db');

const NAME_SQL = `COALESCE(pl.display_name, u.display_name, u.discord_username, 'Player ' || u.id)`;
const AVATAR_SQL = `COALESCE(pl.avatar_url, u.avatar_url)`;

function endsAtSql(alias = 't') {
  return `${alias}.starts_at + (${alias}.duration_minutes * INTERVAL '1 minute')`;
}

async function getTournamentRow(id) {
  const { rows: [t] } = await db.query(
    `SELECT t.*, ${endsAtSql()} AS ends_at FROM arena_tournaments t WHERE t.id = $1`, [id]
  );
  return t || null;
}

// Standings, best score first. Withdrawn players stay on the board (their
// points were earned) but sort by score like everyone else.
async function getStandings(tournamentId) {
  const { rows } = await db.query(
    `SELECT ap.user_id, ap.score, ap.streak, ap.wins, ap.losses, ap.status,
            ap.joined_at, u.player_id,
            ${NAME_SQL} AS name, ${AVATAR_SQL} AS avatar_url
     FROM arena_participants ap
     JOIN users u ON u.id = ap.user_id
     LEFT JOIN players pl ON pl.id = u.player_id
     WHERE ap.tournament_id = $1
     ORDER BY ap.score DESC, ap.wins DESC, ap.joined_at ASC`,
    [tournamentId]
  );
  return rows;
}

// Open (non-terminal) matches with both player names — the "now playing" list.
async function getOpenMatches(tournamentId) {
  const { rows } = await db.query(
    `SELECT m.id, m.status, m.p1_user_id, m.p2_user_id, m.created_at,
            COALESCE(pl1.display_name, u1.display_name, u1.discord_username, 'Player ' || u1.id) AS p1_name,
            COALESCE(pl2.display_name, u2.display_name, u2.discord_username, 'Player ' || u2.id) AS p2_name
     FROM arena_matches m
     JOIN users u1 ON u1.id = m.p1_user_id
     LEFT JOIN players pl1 ON pl1.id = u1.player_id
     JOIN users u2 ON u2.id = m.p2_user_id
     LEFT JOIN players pl2 ON pl2.id = u2.player_id
     WHERE m.tournament_id = $1 AND m.status IN ('active', 'awaiting_confirm', 'disputed')
     ORDER BY m.created_at ASC`,
    [tournamentId]
  );
  return rows;
}

// Full public snapshot: what GET /api/arena/:id returns and what a client
// refetches on socket reconnect. server_now lets clients compute clock offset.
async function getSnapshot(tournamentId) {
  const tournament = await getTournamentRow(tournamentId);
  if (!tournament) return null;
  const [standings, matches] = await Promise.all([
    getStandings(tournamentId),
    getOpenMatches(tournamentId),
  ]);
  return { tournament, standings, matches, server_now: new Date().toISOString() };
}

// Compact payload for tournament:update pushes.
function tournamentUpdatePayload(t) {
  return {
    id: t.id,
    status: t.status,
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    server_now: new Date().toISOString(),
  };
}

module.exports = {
  getTournamentRow,
  getStandings,
  getOpenMatches,
  getSnapshot,
  tournamentUpdatePayload,
  endsAtSql,
};
