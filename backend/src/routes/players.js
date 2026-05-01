const express = require('express');
const router = express.Router();
const db = require('../db');
const { computeMetaProgress, highestRegions } = require('../services/achievements');

// GET /api/players — leaderboard
// Optional query param: ?region=NA | EU | JP  (omit for global/all)
router.get('/', async (req, res) => {
  try {
    const { region } = req.query;
    const validRegions = ['NA', 'EU', 'JP'];

    let whereClause = 'WHERE games_played > 0';
    const params = [];

    if (region && validRegions.includes(region.toUpperCase())) {
      params.push(region.toUpperCase());
      whereClause += ` AND region = $1`;
    }

    const { rows } = await db.query(
      `SELECT id, display_name, challonge_username, elo_rating, games_played,
              total_match_wins, total_match_losses, tournaments_entered, tournament_wins,
              top8_finishes, longest_win_streak, avatar_url, region
       FROM players
       ${whereClause}
       ORDER BY elo_rating DESC
       LIMIT 100`,
      params
    );

    // Enrich top players with their achievement region tiers
    for (const player of rows) {
      const { rows: achRows } = await db.query(
        `SELECT achievement_id FROM player_achievements WHERE player_id = $1`,
        [player.id]
      );
      player.highest_regions = highestRegions(achRows.map(r => r.achievement_id));
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/players/offline-leaderboard — top players ranked by offline_score
router.get('/offline-leaderboard', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, display_name, challonge_username, offline_score,
              offline_wins, offline_top2,
              offline_worlds_wins, offline_worlds_runner_up, offline_worlds_top4, offline_worlds_top8,
              offline_major_wins, offline_major_runner_up, offline_major_top4, offline_major_top8,
              offline_regional_wins, offline_regional_runner_up, offline_regional_top4, offline_regional_top8,
              offline_other_wins, offline_other_runner_up, offline_other_top4, offline_other_top8,
              avatar_url, region
       FROM players
       WHERE offline_score > 0
       ORDER BY offline_score DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/players/:id — full profile
router.get('/:id', async (req, res) => {
  try {
    const { rows: [player] } = await db.query(
      `SELECT * FROM players WHERE id = $1`, [req.params.id]
    );
    if (!player) return res.status(404).json({ error: 'Player not found' });

    // Recent matches
    const { rows: recentMatches } = await db.query(
      `SELECT m.*,
        p1.display_name AS player1_name, p2.display_name AS player2_name,
        t.name AS tournament_name, t.completed_at AS tournament_date
       FROM matches m
       JOIN players p1 ON m.player1_id = p1.id
       JOIN players p2 ON m.player2_id = p2.id
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE (m.player1_id = $1 OR m.player2_id = $1) AND m.state = 'complete'
       ORDER BY m.played_at DESC NULLS LAST
       LIMIT 20`,
      [player.id]
    );

    // ELO history for chart
    const { rows: eloHistory } = await db.query(
      `SELECT eh.new_elo, eh.delta, eh.recorded_at, t.name AS tournament_name
       FROM elo_history eh
       LEFT JOIN matches m ON eh.match_id = m.id
       LEFT JOIN tournaments t ON m.tournament_id = t.id
       WHERE eh.player_id = $1
       ORDER BY eh.recorded_at ASC
       LIMIT 100`,
      [player.id]
    );

    // Achievements
    const { rows: achievements } = await db.query(
      `SELECT pa.achievement_id, pa.unlocked_at, a.name, a.description, a.icon, a.category
       FROM player_achievements pa
       JOIN achievements a ON pa.achievement_id = a.id
       WHERE pa.player_id = $1
       ORDER BY pa.unlocked_at DESC`,
      [player.id]
    );

    // Highest region tiers for display
    const achIds = achievements.map(a => a.achievement_id);
    const highest_regions = highestRegions(achIds);

    // Meta-achievement progress (8 Badges, Elite Trainer)
    const meta_progress = await computeMetaProgress(player.id, db, achIds);

    // Head-to-head summary
    const { rows: h2h } = await db.query(
      `SELECT
        CASE WHEN m.player1_id = $1 THEN m.player2_id ELSE m.player1_id END AS opponent_id,
        opp.display_name AS opponent_name,
        COUNT(*) FILTER (WHERE m.winner_id = $1) AS wins,
        COUNT(*) FILTER (WHERE m.winner_id != $1) AS losses
       FROM matches m
       JOIN players opp ON opp.id = CASE WHEN m.player1_id = $1 THEN m.player2_id ELSE m.player1_id END
       WHERE (m.player1_id = $1 OR m.player2_id = $1) AND m.state = 'complete'
       GROUP BY opponent_id, opponent_name
       ORDER BY (COUNT(*)) DESC
       LIMIT 20`,
      [player.id]
    );

    res.json({
      ...player,
      recent_matches: recentMatches,
      elo_history: eloHistory,
      achievements,
      highest_regions,
      meta_progress,
      h2h,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
