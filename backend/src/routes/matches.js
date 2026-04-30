const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/matches — recent matches across all tournaments
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*,
        p1.display_name AS player1_name, p1.elo_rating AS player1_elo,
        p2.display_name AS player2_name, p2.elo_rating AS player2_elo,
        w.display_name AS winner_name,
        t.name AS tournament_name
       FROM matches m
       JOIN players p1 ON m.player1_id = p1.id
       JOIN players p2 ON m.player2_id = p2.id
       LEFT JOIN players w ON m.winner_id = w.id
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE m.state = 'complete'
       ORDER BY m.played_at DESC NULLS LAST
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
