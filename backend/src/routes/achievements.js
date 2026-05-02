const express = require('express');
const router = express.Router();
const { ACHIEVEMENTS, ACHIEVEMENT_MAP, REGIONS, PLACEMENT_TIERS, highestRegions } = require('../services/achievements');
const db = require('../db');

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Build a public bracket URL for a tournament row.
// Returns null when nothing usable is on file.
function buildBracketUrl(t) {
  if (!t) return null;
  if (t.challonge_url) return t.challonge_url;
  if (t.source === 'startgg' && t.startgg_slug) {
    return `https://www.start.gg/tournament/${t.startgg_slug}`;
  }
  if (t.source === 'tonamel' && t.tonamel_id) {
    return `https://tonamel.com/competition/${t.tonamel_id}/tournament`;
  }
  if (t.liquipedia_url) return t.liquipedia_url;
  return null;
}

// Friendly label for the bracket host
function bracketHost(t) {
  if (!t) return null;
  if (t.source === 'startgg') return 'start.gg';
  if (t.source === 'tonamel') return 'Tonamel';
  if (t.source === 'offline' || t.liquipedia_url) return 'Liquipedia';
  if (t.challonge_url) return 'Challonge';
  return null;
}

function decorateTournament(row) {
  return {
    ...row,
    bracket_url: buildBracketUrl(row),
    bracket_host: bracketHost(row),
  };
}

// GET /api/achievements — full catalog
// Optional ?category=placement&scope=global&tier=champion&region=kanto
router.get('/', (req, res) => {
  let list = ACHIEVEMENTS;
  const { category, scope, tier, region } = req.query;
  if (category) list = list.filter(a => a.category === category);
  if (scope)    list = list.filter(a => a.scope === scope);
  if (tier)     list = list.filter(a => a.tier === tier);
  if (region)   list = list.filter(a => a.region === region);

  res.json(list.map(({ id, name, description, icon, category, scope, tier, region, pass }) => ({
    id, name, description, icon, category, scope, tier, region, pass
  })));
});

// GET /api/achievements/recent — most-recently-unlocked achievements.
//
// Sorts by `unlocked_at` (the tournament date the threshold was crossed) so
// "recent" tracks the in-game event, not when the row landed in the DB. The
// only filter is `unlocked_at IS NOT NULL` — we hide undated unlocks so they
// don't pretend to be "just unlocked today". There is no time window: the
// feed is simply the top N most-recent dated unlocks, even if the newest
// is months old.
//
// Tiebreaker is `first_seen_at DESC` so multiple unlocks on the same
// tournament day get a stable, newest-first ordering.
router.get('/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const { rows } = await db.query(`
      SELECT pa.player_id, pa.achievement_id, pa.unlocked_at, pa.tournament_id,
             pa.first_seen_at,
             p.display_name AS player_name,
             a.name AS achievement_name, a.icon, a.description,
             t.name AS tournament_name
      FROM player_achievements pa
      JOIN players p ON p.id = pa.player_id
      JOIN achievements a ON a.id = pa.achievement_id
      LEFT JOIN tournaments t ON t.id = pa.tournament_id
      WHERE pa.unlocked_at IS NOT NULL
      ORDER BY pa.unlocked_at DESC, pa.first_seen_at DESC
      LIMIT $1
    `, [limit]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/achievements/holders?achievement_id=global_elite_four_johto
// Returns all players who have a specific achievement, with tournament + contributor metadata
router.get('/holders', async (req, res) => {
  try {
    const { achievement_id } = req.query;
    if (!achievement_id) return res.status(400).json({ error: 'achievement_id required' });

    const ach = ACHIEVEMENT_MAP[achievement_id];
    if (!ach) return res.status(404).json({ error: 'Unknown achievement' });

    const { rows } = await db.query(`
      SELECT pa.player_id, pa.unlocked_at, pa.tournament_id,
             p.display_name, p.challonge_username, p.elo_rating, p.region,
             t.name AS tournament_name
      FROM player_achievements pa
      JOIN players p ON p.id = pa.player_id
      LEFT JOIN tournaments t ON t.id = pa.tournament_id
      WHERE pa.achievement_id = $1
      ORDER BY p.elo_rating DESC
    `, [achievement_id]);

    // Fetch defeated-opponent evidence for each holder (for meta/match-based achievements)
    for (const holder of rows) {
      const { rows: contributors } = await db.query(`
        SELECT ado.opponent_id, ado.match_id,
               opp.display_name AS opponent_name, opp.challonge_username AS opponent_username
        FROM achievement_defeated_opponents ado
        JOIN players opp ON opp.id = ado.opponent_id
        WHERE ado.player_id = $1 AND ado.achievement_id = $2
        ORDER BY opp.display_name
      `, [holder.player_id, achievement_id]);
      holder.contributors = contributors;
    }

    res.json({
      achievement: { id: ach.id, name: ach.name, description: ach.description, icon: ach.icon },
      holders: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/achievements/leaderboard — players with the most achievements
router.get('/leaderboard', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.display_name, p.elo_rating, p.region,
             COUNT(pa.achievement_id) AS achievement_count
      FROM players p
      LEFT JOIN player_achievements pa ON pa.player_id = p.id
      GROUP BY p.id
      HAVING COUNT(pa.achievement_id) > 0
      ORDER BY achievement_count DESC, p.elo_rating DESC
      LIMIT 20
    `);

    // Enrich each player with their highest region tiers
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

// GET /api/achievements/:id/tournaments?player_id=123
//
// Returns the tournaments that contributed to an achievement.
//   - With player_id : the specific tournaments where THIS player earned the
//                      placements / matches / opponents that count toward it.
//   - Without        : an aggregate of every unlock event (player + the
//                      tournament where they unlocked it).
//
// Each tournament row carries a computed `bracket_url` pointing to the
// original Challonge / start.gg / Tonamel / Liquipedia bracket when available.
router.get('/:id/tournaments', async (req, res) => {
  try {
    const achievementId = req.params.id;
    const ach = ACHIEVEMENT_MAP[achievementId];
    if (!ach) return res.status(404).json({ error: 'Unknown achievement' });

    const playerId = req.query.player_id ? parseInt(req.query.player_id) : null;

    // Common tournament SELECT list — keep this in sync with buildBracketUrl.
    const T_COLS = `
      t.id, t.name, t.series, t.completed_at, t.participants_count,
      t.is_offline, t.source, t.challonge_url, t.startgg_slug,
      t.tonamel_id, t.liquipedia_url
    `;

    let tournaments = [];
    let mode;

    if (playerId) {
      mode = 'player';
      const seriesScope = ach.scope && ach.scope !== 'global' ? ach.scope : null;
      const tier = ach.tier;

      // ── Placement: gym_leader / elite_four / rival / champion ──────────────
      const placementRanks = {
        gym_leader: 'tp.final_rank <= 8 AND tp.final_rank > 0',
        elite_four: 'tp.final_rank <= 4 AND tp.final_rank > 0',
        rival:      'tp.final_rank = 2',
        champion:   'tp.final_rank = 1',
      };

      if (placementRanks[tier]) {
        const params = [playerId];
        let seriesFilter = '';
        if (seriesScope) {
          params.push(seriesScope);
          seriesFilter = `AND t.series = $${params.length}`;
        }
        const { rows } = await db.query(`
          SELECT ${T_COLS}, tp.final_rank
          FROM tournament_placements tp
          JOIN tournaments t ON t.id = tp.tournament_id
          WHERE tp.player_id = $1
            AND ${placementRanks[tier]}
            ${seriesFilter}
          ORDER BY t.completed_at ASC NULLS LAST
        `, params);
        tournaments = rows.map(decorateTournament);
      }

      // ── Participation: every tournament entered (within scope) ─────────────
      else if (tier === 'participation') {
        const params = [playerId];
        let seriesFilter = '';
        if (seriesScope) {
          params.push(seriesScope);
          seriesFilter = `AND t.series = $${params.length}`;
        }
        const { rows } = await db.query(`
          SELECT ${T_COLS}, tp.final_rank
          FROM tournament_placements tp
          JOIN tournaments t ON t.id = tp.tournament_id
          WHERE tp.player_id = $1
            ${seriesFilter}
          ORDER BY t.completed_at ASC NULLS LAST
        `, params);
        tournaments = rows.map(decorateTournament);
      }

      // ── Match-based / Meta: pull from achievement_defeated_opponents ───────
      else if (
        tier === 'rival_battle'   || tier === 'smell_ya_later' ||
        tier === 'foreshadowing'  || tier === 'dark_horse' ||
        tier === 'eight_badges'   || tier === 'elite_trainer'
      ) {
        const { rows } = await db.query(`
          SELECT ${T_COLS},
                 ado.match_id, ado.opponent_id,
                 opp.display_name      AS opponent_name,
                 opp.challonge_username AS opponent_username,
                 m.player1_score, m.player2_score, m.player1_id, m.player2_id, m.winner_id
          FROM achievement_defeated_opponents ado
          LEFT JOIN matches m       ON m.id = ado.match_id
          LEFT JOIN tournaments t   ON t.id = m.tournament_id
          LEFT JOIN players opp     ON opp.id = ado.opponent_id
          WHERE ado.player_id = $1 AND ado.achievement_id = $2
          ORDER BY t.completed_at ASC NULLS LAST, ado.opponent_id ASC
        `, [playerId, ach.id]);

        // For meta achievements (one row per unique opponent, no specific
        // match), some rows may be missing tournament context — keep them
        // anyway so the modal can still surface the opponent.
        tournaments = rows
          .filter(r => r.id != null) // only rows where a tournament joined
          .map(decorateTournament);
      }

      // ── Special: World Traveler (multi_series) — one per distinct series ──
      else if (ach.id === 'multi_series') {
        const { rows } = await db.query(`
          SELECT DISTINCT ON (t.series)
                 ${T_COLS}, tp.final_rank
          FROM tournament_placements tp
          JOIN tournaments t ON t.id = tp.tournament_id
          WHERE tp.player_id = $1
            AND (t.is_offline IS NULL OR t.is_offline = FALSE)
          ORDER BY t.series, t.completed_at ASC NULLS LAST
        `, [playerId]);
        tournaments = rows.map(decorateTournament);
      }
    } else {
      // ── Aggregate (no player_id) — every unlock event for this achievement ─
      mode = 'aggregate';
      const { rows } = await db.query(`
        SELECT ${T_COLS},
               pa.player_id, pa.unlocked_at,
               p.display_name        AS player_name,
               p.challonge_username  AS player_username,
               p.region              AS player_region
        FROM player_achievements pa
        JOIN players p ON p.id = pa.player_id
        LEFT JOIN tournaments t ON t.id = pa.tournament_id
        WHERE pa.achievement_id = $1
        ORDER BY pa.unlocked_at DESC NULLS LAST
      `, [ach.id]);
      tournaments = rows.map(decorateTournament);
    }

    res.json({
      achievement: {
        id: ach.id,
        name: ach.name,
        description: ach.description,
        icon: ach.icon,
        category: ach.category,
        scope: ach.scope,
        tier: ach.tier,
        region: ach.region,
      },
      mode,
      player_id: playerId,
      tournaments,
    });
  } catch (err) {
    console.error('GET /achievements/:id/tournaments failed', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
