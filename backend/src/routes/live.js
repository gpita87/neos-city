const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');

// Generate a short room code
function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F9B2"
}

// POST /api/live/create — create a Bo3/Bo5 room
router.post('/create', async (req, res) => {
  const { player1_id, player2_id, format = 'bo3' } = req.body;
  if (!player1_id || !player2_id) return res.status(400).json({ error: 'Both player IDs required' });
  if (!['bo3', 'bo5'].includes(format)) return res.status(400).json({ error: 'format must be bo3 or bo5' });

  try {
    const room_code = generateRoomCode();
    const { rows: [room] } = await db.query(
      `INSERT INTO live_matches (room_code, player1_id, player2_id, format, status)
       VALUES ($1, $2, $3, $4, 'waiting')
       RETURNING *`,
      [room_code, player1_id, player2_id, format]
    );
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/live/:code — get room state
router.get('/:code', async (req, res) => {
  try {
    const { rows: [room] } = await db.query(
      `SELECT lm.*,
        p1.display_name AS player1_name, p1.elo_rating AS player1_elo,
        p2.display_name AS player2_name, p2.elo_rating AS player2_elo
       FROM live_matches lm
       JOIN players p1 ON lm.player1_id = p1.id
       JOIN players p2 ON lm.player2_id = p2.id
       WHERE lm.room_code = $1`,
      [req.params.code.toUpperCase()]
    );
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/live/:code/report — report a game result
router.patch('/:code/report', async (req, res) => {
  const { winner } = req.body; // 'player1' or 'player2'
  if (!['player1', 'player2'].includes(winner)) {
    return res.status(400).json({ error: 'winner must be "player1" or "player2"' });
  }

  try {
    const { rows: [room] } = await db.query(
      `SELECT * FROM live_matches WHERE room_code = $1`, [req.params.code.toUpperCase()]
    );
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.status === 'complete') return res.status(400).json({ error: 'Match already complete' });

    const winsNeeded = room.format === 'bo5' ? 3 : 2;
    const newP1Games = room.player1_games + (winner === 'player1' ? 1 : 0);
    const newP2Games = room.player2_games + (winner === 'player2' ? 1 : 0);

    let status = 'active';
    let matchWinnerId = null;

    if (newP1Games >= winsNeeded) {
      status = 'complete';
      matchWinnerId = room.player1_id;
    } else if (newP2Games >= winsNeeded) {
      status = 'complete';
      matchWinnerId = room.player2_id;
    }

    const { rows: [updated] } = await db.query(
      `UPDATE live_matches SET
        player1_games = $2,
        player2_games = $3,
        status = $4,
        winner_id = $5,
        started_at = COALESCE(started_at, NOW()),
        completed_at = CASE WHEN $4 = 'complete' THEN NOW() ELSE NULL END
       WHERE room_code = $1
       RETURNING *`,
      [req.params.code.toUpperCase(), newP1Games, newP2Games, status, matchWinnerId]
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
