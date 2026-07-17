// Live Arena tournaments — REST layer.
//
// REST is the source of truth / snapshot layer; socket.io (src/socket) is push
// only. Spectators need no login: GET / and GET /:id are public, and GET /:id
// doubles as the poll fallback for clients whose socket won't connect.
//
// M1 surface: list, detail, register/withdraw/pause/resume, admin create/edit.
// M2 adds: match reporting, disputes, admin resolve. M3: chat history.

const express = require('express');
const db = require('../db');
const { requireAuth, attachUser } = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');
const { getSnapshot, endsAtSql } = require('../services/arenaState');
const {
  pairTournament, emitScoreboard, emitTournamentUpdate, handleScoringOutcome,
} = require('../services/arenaEngine');
const { applyReport, adminResolve } = require('../services/arenaScoring');

const router = express.Router();

const OPEN_MATCH_STATUSES = ['active', 'awaiting_confirm', 'disputed'];

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── Public reads ─────────────────────────────────────────────────────────────

// GET /api/arena — all tournaments with participant counts (client groups by status)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT t.id, t.name, t.description, t.starts_at, t.duration_minutes,
              t.status, t.created_at, ${endsAtSql()} AS ends_at,
              COUNT(ap.id)::int AS participants_count
       FROM arena_tournaments t
       LEFT JOIN arena_participants ap ON ap.tournament_id = t.id
       GROUP BY t.id
       ORDER BY t.starts_at DESC`
    );
    res.json({ tournaments: rows, server_now: new Date().toISOString() });
  } catch (err) {
    console.error('[arena] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load arena tournaments' });
  }
});

// GET /api/arena/:id — full snapshot; when logged in, includes `me`
// (participant row + current open match + shared groups with the opponent).
router.get('/:id', attachUser, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid tournament id' });
  try {
    const snapshot = await getSnapshot(id);
    if (!snapshot) return res.status(404).json({ error: 'Tournament not found' });

    let me = null;
    if (req.user) {
      const { rows: [participant] } = await db.query(
        `SELECT * FROM arena_participants WHERE tournament_id = $1 AND user_id = $2`,
        [id, req.user.id]
      );
      if (participant) {
        const { rows: [match] } = await db.query(
          `SELECT m.*,
                  CASE WHEN m.p1_user_id = $2 THEN m.p2_user_id ELSE m.p1_user_id END AS opponent_user_id
           FROM arena_matches m
           WHERE m.tournament_id = $1
             AND (m.p1_user_id = $2 OR m.p2_user_id = $2)
             AND m.status = ANY($3)
           ORDER BY m.created_at DESC LIMIT 1`,
          [id, req.user.id, OPEN_MATCH_STATUSES]
        );
        let currentMatch = null;
        if (match) {
          const [{ rows: [opp] }, { rows: sharedGroups }, { rows: opponentGroups }, { rows: reports }] = await Promise.all([
            db.query(
              `SELECT u.id AS user_id, u.region, u.ingame_name,
                      COALESCE(pl.display_name, u.display_name, u.discord_username, 'Player ' || u.id) AS name,
                      COALESCE(pl.avatar_url, u.avatar_url) AS avatar_url
               FROM users u LEFT JOIN players pl ON pl.id = u.player_id
               WHERE u.id = $1`,
              [match.opponent_user_id]
            ),
            // Groups BOTH players belong to — where this match can happen
            // in-game (ingame_id/password are the actual join details).
            db.query(
              `SELECT g.id, g.name, g.ruleset, g.ingame_id, g.password, g.has_room
               FROM pokken_groups g
               JOIN user_groups mine ON mine.group_id = g.id AND mine.user_id = $1
               JOIN user_groups theirs ON theirs.group_id = g.id AND theirs.user_id = $2
               WHERE g.active
               ORDER BY g.name`,
              [req.user.id, match.opponent_user_id]
            ),
            // ALL of the opponent's groups — when there's no overlap, the UI
            // offers "join one of theirs" so the pairing can still happen.
            db.query(
              `SELECT g.id, g.name, g.ruleset, g.ingame_id, g.password, g.has_room
               FROM pokken_groups g
               JOIN user_groups ug ON ug.group_id = g.id AND ug.user_id = $1
               WHERE g.active
               ORDER BY g.name`,
              [match.opponent_user_id]
            ),
            // Both players' filed reports — lets the UI render awaiting/disputed
            // states, including the opponent's conflicting claim.
            db.query(
              `SELECT reporter_user_id, winner_user_id, loser_games, reported_at
               FROM arena_match_reports WHERE match_id = $1 ORDER BY reported_at ASC`,
              [match.id]
            ),
          ]);
          currentMatch = { ...match, opponent: opp || null, sharedGroups, opponentGroups, reports };
        }
        me = { participant, match: currentMatch };
      }
    }

    res.json({ ...snapshot, me });
  } catch (err) {
    console.error('[arena] detail failed:', err.message);
    res.status(500).json({ error: 'Failed to load tournament' });
  }
});

// ── Player actions ───────────────────────────────────────────────────────────

// POST /api/arena/:id/register — join (late join allowed while live)
router.post('/:id/register', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid tournament id' });
  try {
    const { rows: [t] } = await db.query(
      `SELECT id, status FROM arena_tournaments WHERE id = $1`, [id]
    );
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (!['scheduled', 'live'].includes(t.status)) {
      return res.status(409).json({ error: 'Registration is closed for this tournament' });
    }

    // Idempotent: re-registering while already active is a no-op (keeps queue
    // priority); returning after a withdrawal reactivates with score intact.
    const { rows: [participant] } = await db.query(
      `INSERT INTO arena_participants (tournament_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (tournament_id, user_id) DO UPDATE
         SET status = 'active',
             waiting_since = CASE WHEN arena_participants.status = 'active'
                                  THEN arena_participants.waiting_since ELSE NOW() END
       RETURNING *`,
      [id, req.user.id]
    );

    await emitScoreboard(id);
    if (t.status === 'live') await pairTournament(id);
    res.json({ participant });
  } catch (err) {
    console.error('[arena] register failed:', err.message);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// Shared handler for withdraw/pause/resume status flips.
async function setParticipantStatus(req, res, newStatus) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid tournament id' });
  try {
    const waitingReset = newStatus === 'active' ? ', waiting_since = NOW()' : '';
    const { rows: [participant] } = await db.query(
      `UPDATE arena_participants SET status = $3${waitingReset}
       WHERE tournament_id = $1 AND user_id = $2
       RETURNING *`,
      [id, req.user.id, newStatus]
    );
    if (!participant) return res.status(404).json({ error: 'Not registered in this tournament' });

    await emitScoreboard(id);
    if (newStatus === 'active') await pairTournament(id);
    res.json({ participant });
  } catch (err) {
    console.error(`[arena] ${newStatus} failed:`, err.message);
    res.status(500).json({ error: 'Failed to update registration' });
  }
}

router.post('/:id/withdraw', requireAuth, (req, res) => setParticipantStatus(req, res, 'withdrawn'));
router.post('/:id/pause', requireAuth, (req, res) => setParticipantStatus(req, res, 'paused'));
router.post('/:id/resume', requireAuth, (req, res) => setParticipantStatus(req, res, 'active'));

// ── Match chat ───────────────────────────────────────────────────────────────

// GET /api/arena/matches/:id/chat — history for reconnect/reload. Live
// messages arrive over the socket (chat:message); this is the snapshot layer.
// Players in the match + admins only.
router.get('/matches/:id/chat', requireAuth, async (req, res) => {
  const matchId = parseId(req.params.id);
  if (!matchId) return res.status(400).json({ error: 'Invalid match id' });
  try {
    const { rows: [match] } = await db.query(
      `SELECT id, p1_user_id, p2_user_id FROM arena_matches WHERE id = $1`,
      [matchId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const isPlayer = match.p1_user_id === req.user.id || match.p2_user_id === req.user.id;
    if (!isPlayer && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not a player in this match' });
    }

    // Newest 200, returned oldest-first for straight rendering. The 1 msg/sec
    // socket throttle makes hitting the cap unlikely, but a full hour of chat
    // could — keeping the tail (not the head) is what a reload wants.
    const { rows } = await db.query(
      `SELECT c.id, c.match_id, c.sender_user_id, c.body, c.created_at,
              COALESCE(pl.display_name, u.display_name, u.discord_username, 'Player ' || u.id) AS sender_name
       FROM arena_chat_messages c
       JOIN users u ON u.id = c.sender_user_id
       LEFT JOIN players pl ON pl.id = u.player_id
       WHERE c.match_id = $1
       ORDER BY c.id DESC
       LIMIT 200`,
      [matchId]
    );
    res.json({ messages: rows.reverse() });
  } catch (err) {
    console.error('[arena] chat history failed:', err.message);
    res.status(500).json({ error: 'Failed to load chat' });
  }
});

// ── Match results ────────────────────────────────────────────────────────────

// POST /api/arena/matches/:id/report  { winner_user_id, loser_games }
// Players only (enforced in applyReport). Re-reporting is allowed while the
// match is open — a disputed match converges when the reports come to agree.
router.post('/matches/:id/report', requireAuth, async (req, res) => {
  const matchId = parseId(req.params.id);
  if (!matchId) return res.status(400).json({ error: 'Invalid match id' });
  const { winner_user_id, loser_games } = req.body || {};
  try {
    const outcome = await applyReport({
      matchId,
      reporterUserId: req.user.id,
      winnerUserId: Number(winner_user_id),
      loserGames: Number(loser_games),
    });
    await handleScoringOutcome(outcome);
    res.json({ result: outcome });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[arena] report failed:', err.message);
    res.status(500).json({ error: 'Failed to report result' });
  }
});

// POST /api/arena/matches/:id/resolve  { winner_user_id, loser_games }
// Admin force-confirm of a disputed/stuck match (confirm_method 'admin').
router.post('/matches/:id/resolve', requireAdmin, async (req, res) => {
  const matchId = parseId(req.params.id);
  if (!matchId) return res.status(400).json({ error: 'Invalid match id' });
  const { winner_user_id, loser_games } = req.body || {};
  try {
    const outcome = await adminResolve({
      matchId,
      winnerUserId: Number(winner_user_id),
      loserGames: Number(loser_games),
    });
    await handleScoringOutcome(outcome);
    res.json({ result: outcome });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[arena] resolve failed:', err.message);
    res.status(500).json({ error: 'Failed to resolve match' });
  }
});

// ── Admin ────────────────────────────────────────────────────────────────────

// POST /api/arena — create a tournament
router.post('/', requireAdmin, async (req, res) => {
  const { name, description, starts_at, duration_minutes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const startsAt = new Date(starts_at);
  if (Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: 'starts_at must be a valid date' });
  const duration = duration_minutes == null ? 60 : Number(duration_minutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 240) {
    return res.status(400).json({ error: 'duration_minutes must be 5–240' });
  }
  try {
    const { rows: [tournament] } = await db.query(
      `INSERT INTO arena_tournaments (name, description, starts_at, duration_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [String(name).trim(), description || null, startsAt.toISOString(), duration, req.user?.id ?? null]
    );
    res.status(201).json({ tournament });
  } catch (err) {
    console.error('[arena] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create tournament' });
  }
});

// PATCH /api/arena/:id — edit while scheduled; cancel any time before finalized
router.patch('/:id', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid tournament id' });
  const { name, description, starts_at, duration_minutes, status } = req.body || {};
  try {
    const { rows: [t] } = await db.query(
      `SELECT id, status FROM arena_tournaments WHERE id = $1`, [id]
    );
    if (!t) return res.status(404).json({ error: 'Tournament not found' });

    if (status !== undefined) {
      if (status !== 'cancelled') {
        return res.status(400).json({ error: 'Only status=cancelled may be set directly' });
      }
      if (['finalized', 'cancelled'].includes(t.status)) {
        return res.status(409).json({ error: `Tournament is already ${t.status}` });
      }
    }

    const fieldEdits = [name, description, starts_at, duration_minutes].some((v) => v !== undefined);
    if (fieldEdits && t.status !== 'scheduled') {
      return res.status(409).json({ error: 'Details can only be edited before the tournament starts' });
    }

    const sets = [];
    const vals = [];
    const push = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'name cannot be empty' });
      push('name', String(name).trim());
    }
    if (description !== undefined) push('description', description || null);
    if (starts_at !== undefined) {
      const d = new Date(starts_at);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'starts_at must be a valid date' });
      push('starts_at', d.toISOString());
    }
    if (duration_minutes !== undefined) {
      const dur = Number(duration_minutes);
      if (!Number.isInteger(dur) || dur < 5 || dur > 240) {
        return res.status(400).json({ error: 'duration_minutes must be 5–240' });
      }
      push('duration_minutes', dur);
    }
    if (status !== undefined) push('status', status);
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(id);
    const { rows: [tournament] } = await db.query(
      `UPDATE arena_tournaments SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (status === 'cancelled') {
      // Close out any open matches so nothing lingers, then tell the room.
      await db.query(
        `UPDATE arena_matches SET status = 'cancelled', completed_at = NOW()
         WHERE tournament_id = $1 AND status = ANY($2)`,
        [id, OPEN_MATCH_STATUSES]
      );
      await emitTournamentUpdate(id);
    }
    res.json({ tournament });
  } catch (err) {
    console.error('[arena] update failed:', err.message);
    res.status(500).json({ error: 'Failed to update tournament' });
  }
});

module.exports = router;
