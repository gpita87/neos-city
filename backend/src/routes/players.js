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

// GET /api/players/index — alphabetical lookup index of every known player.
// Used by the /players page so users can find players who don't surface on the
// leaderboard (no recent online activity, no podium offline finishes, etc.).
// Returns the full table — no LIMIT — with a lightweight column set.
router.get('/index', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, display_name, challonge_username, region, avatar_url,
              tournaments_entered, games_played, offline_top2
       FROM players
       ORDER BY LOWER(display_name) ASC, id ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/players/:id/offline-placements — contributing offline tournaments
// for a single tier × placement cell on the player profile.
//
// Query params:
//   tier:      worlds | major | regional | other            (required)
//   placement: wins | runner_up | top4 | top8               (required)
//
// `top4` and `top8` are inclusive (final_rank <= 4 / <= 8) so the row count
// matches the offline-record table on the profile page.
router.get('/:id/offline-placements', async (req, res) => {
  try {
    const validTiers = new Set(['worlds', 'major', 'regional', 'other']);
    const validPlacements = new Set(['wins', 'runner_up', 'top4', 'top8']);
    const tier = String(req.query.tier || '').toLowerCase();
    const placement = String(req.query.placement || '').toLowerCase();

    if (!validTiers.has(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${[...validTiers].join(', ')}` });
    }
    if (!validPlacements.has(placement)) {
      return res.status(400).json({ error: `placement must be one of: ${[...validPlacements].join(', ')}` });
    }

    let rankFilter;
    if      (placement === 'wins')      rankFilter = 'tp.final_rank = 1';
    else if (placement === 'runner_up') rankFilter = 'tp.final_rank = 2';
    else if (placement === 'top4')      rankFilter = 'tp.final_rank <= 4';
    else                                rankFilter = 'tp.final_rank <= 8';

    const { rows } = await db.query(
      `SELECT
         t.id, t.name, t.series, t.location, t.prize_pool, t.participants_count,
         t.completed_at, t.started_at, t.liquipedia_url, t.liquipedia_slug,
         tp.final_rank
       FROM tournament_placements tp
       JOIN tournaments t ON tp.tournament_id = t.id
       WHERE tp.player_id = $1
         AND t.is_offline = TRUE
         AND t.series = $2
         AND ${rankFilter}
       ORDER BY COALESCE(t.completed_at, t.started_at) DESC NULLS LAST, t.id DESC`,
      [req.params.id, tier]
    );

    res.json({
      player_id: Number(req.params.id),
      tier,
      placement,
      count: rows.length,
      tournaments: rows,
    });
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

    // Recent tournaments — most recent placements (online + offline)
    const { rows: recentTournaments } = await db.query(
      `SELECT t.id, t.name, t.series, t.is_offline, t.participants_count,
              t.completed_at, t.started_at, tp.final_rank
       FROM tournament_placements tp
       JOIN tournaments t ON tp.tournament_id = t.id
       WHERE tp.player_id = $1
       ORDER BY COALESCE(t.completed_at, t.started_at) DESC NULLS LAST, t.id DESC
       LIMIT 10`,
      [player.id]
    );

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
      recent_tournaments: recentTournaments,
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
