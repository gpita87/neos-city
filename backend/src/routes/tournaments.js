const express = require('express');
const router = express.Router();
const challonge = require('../services/challonge');
const startgg   = require('../services/startgg');
const { checkAchievements, checkAchievementsPass1, checkAchievementsPass2, detectSeries, detectOfflineTier } = require('../services/achievements');
const { calculateNewRatings, placementBonus } = require('../services/elo');
const db = require('../db');

// ── Player alias resolution ──────────────────────────────────────────────────
// Checks the player_aliases table for name changes (e.g. thankswalot → jukem).
// Returns the canonical username if an alias exists, otherwise the original.
let _aliasCache = null;
async function loadAliasCache() {
  if (_aliasCache) return _aliasCache;
  try {
    const { rows } = await db.query('SELECT alias_username, canonical_username FROM player_aliases');
    _aliasCache = new Map(rows.map(r => [r.alias_username, r.canonical_username]));
  } catch {
    // Table might not exist yet — no aliases
    _aliasCache = new Map();
  }
  return _aliasCache;
}
async function resolveAlias(username) {
  const cache = await loadAliasCache();
  return cache.get(username) || username;
}
// Invalidate cache when server has been running a while (pick up new aliases)
setInterval(() => { _aliasCache = null; }, 5 * 60 * 1000);

// Career point values by placement percentile
function careerPoints(rank, total) {
  if (rank === 1)              return 10;
  if (rank === 2)              return 7;
  if (rank <= 4)               return 5;
  if (rank / total <= 0.125)   return 3;  // top 8 in large brackets
  return 1;                                // attended
}

// GET /api/tournaments
// Optional: ?is_offline=true  → only offline events
//           ?is_offline=false → only online events
router.get('/', async (req, res) => {
  try {
    const { is_offline } = req.query;
    let whereClause = '';
    if (is_offline === 'true')  whereClause = `WHERE is_offline = TRUE`;
    if (is_offline === 'false') whereClause = `WHERE (is_offline = FALSE OR is_offline IS NULL)`;

    const { rows } = await db.query(
      `SELECT * FROM tournaments ${whereClause} ORDER BY completed_at DESC NULLS LAST`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournaments/recent-placements
// Returns top-8 placements from online tournaments completed in the last N days.
// Query params: ?days=30 (default 30), ?limit=8 (placements per tournament, default 8)
router.get('/recent-placements', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const placementLimit = parseInt(req.query.limit) || 8;

    // Get recent online tournaments with their top placements
    const { rows: tournaments } = await db.query(
      `SELECT t.id, t.name, t.series, t.completed_at, t.participants_count, t.challonge_url,
              t.source, t.startgg_slug, t.tonamel_id
       FROM tournaments t
       WHERE (t.is_offline = FALSE OR t.is_offline IS NULL)
         AND t.completed_at >= NOW() - INTERVAL '1 day' * $1
       ORDER BY t.completed_at DESC`,
      [days]
    );

    // For each tournament, fetch top N placements
    const results = [];
    for (const t of tournaments) {
      const { rows: placements } = await db.query(
        `SELECT tp.player_id, tp.final_rank, tp.career_points,
                p.display_name, p.challonge_username, p.region
         FROM tournament_placements tp
         JOIN players p ON tp.player_id = p.id
         WHERE tp.tournament_id = $1 AND tp.final_rank <= $2
         ORDER BY tp.final_rank ASC`,
        [t.id, placementLimit]
      );
      results.push({
        tournament_id: t.id,
        name: t.name,
        series: t.series,
        completed_at: t.completed_at,
        participants_count: t.participants_count,
        placements,
      });
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournaments/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [tournament] } = await db.query(
      `SELECT * FROM tournaments WHERE id = $1`, [req.params.id]
    );
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const { rows: matches } = await db.query(
      `SELECT m.*,
        p1.display_name AS player1_name, p1.elo_rating AS player1_elo,
        p2.display_name AS player2_name, p2.elo_rating AS player2_elo,
        w.display_name AS winner_name
       FROM matches m
       LEFT JOIN players p1 ON m.player1_id = p1.id
       LEFT JOIN players p2 ON m.player2_id = p2.id
       LEFT JOIN players w ON m.winner_id = w.id
       WHERE m.tournament_id = $1
       ORDER BY m.round, m.id`,
      [tournament.id]
    );

    const { rows: placements } = await db.query(
      `SELECT tp.*, p.display_name, p.elo_rating
       FROM tournament_placements tp
       JOIN players p ON tp.player_id = p.id
       WHERE tp.tournament_id = $1
       ORDER BY tp.final_rank`,
      [tournament.id]
    );

    res.json({ ...tournament, matches, placements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared importOne() — called by both the HTTP route and the sync endpoint ──
async function importOne(challonge_id) {
  try {
    // ── Fetch from Challonge ───────────────────────────────────────────────
    const [tourneyData, participantsData, matchesData] = await Promise.all([
      challonge.getTournament(challonge_id),
      challonge.getParticipants(challonge_id),
      challonge.getMatches(challonge_id, { state: 'all' })
    ]);

    const t = tourneyData.data?.attributes || tourneyData.tournament || tourneyData;
    const tournamentName = t.name || t.tournament?.name || challonge_id;
    const series = detectSeries(challonge_id, tournamentName);

    // ── Upsert tournament ──────────────────────────────────────────────────
    const { rows: [tournament] } = await db.query(
      `INSERT INTO tournaments
         (challonge_id, challonge_url, name, series, tournament_type, participants_count, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (challonge_id) DO UPDATE SET
         name = EXCLUDED.name,
         series = EXCLUDED.series,
         participants_count = EXCLUDED.participants_count,
         completed_at = EXCLUDED.completed_at
       RETURNING *`,
      [
        challonge_id,
        `https://challonge.com/${challonge_id}`,
        tournamentName,
        series,
        t.tournament_type,
        t.participants_count,
        t.started_at,
        t.completed_at
      ]
    );

    // ── Upsert participants → players ──────────────────────────────────────
    const participantList = participantsData.data || participantsData.participants || participantsData;
    const playerMap = new Map(); // challonge participant id (string) → our player row

    for (const p of participantList) {
      const attrs = p.attributes || p.participant || p;
      const chalId = String(p.id || attrs.id);
      let username = (attrs.challonge_username || attrs.name || `player_${chalId}`).toLowerCase();
      username = await resolveAlias(username);
      const displayName = attrs.display_name || attrs.name || username;
      const finalRank = attrs.final_rank || attrs.final_rank_or_null || null;

      const { rows: [player] } = await db.query(
        `INSERT INTO players (challonge_username, display_name)
         VALUES ($1, $2)
         ON CONFLICT (challonge_username) DO UPDATE SET
           display_name = EXCLUDED.display_name
         RETURNING *`,
        [username, displayName]
      );

      playerMap.set(chalId, { ...player, finalRank: finalRank ? parseInt(finalRank) : null });
    }

    const totalParticipants = participantList.length;

    // ── Upsert matches ─────────────────────────────────────────────────────
    const matchList = matchesData.data || matchesData.matches || matchesData;
    let importedMatches = 0;
    const insertedMatchIds = [];

    for (const m of matchList) {
      const attrs = m.attributes || m.match || m;
      if (attrs.state !== 'complete') continue;

      const chalMatchId = String(m.id || attrs.id);
      const p1ChalId = String(attrs.player1_id);
      const p2ChalId = String(attrs.player2_id);
      const winnerChalId = String(attrs.winner_id);

      const p1 = playerMap.get(p1ChalId);
      const p2 = playerMap.get(p2ChalId);
      if (!p1 || !p2) continue;

      const winnerId = winnerChalId === p1ChalId ? p1.id : p2.id;

      let p1Score = null, p2Score = null;
      if (attrs.scores_csv) {
        const parts = attrs.scores_csv.split(',')[0]?.split('-');
        if (parts?.length === 2) {
          p1Score = parseInt(parts[0]);
          p2Score = parseInt(parts[1]);
        }
      }

      const { rows: [inserted] } = await db.query(
        `INSERT INTO matches
           (tournament_id, challonge_match_id, player1_id, player2_id, winner_id,
            player1_score, player2_score, round, state, played_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'complete',$9)
         ON CONFLICT (tournament_id, challonge_match_id) DO NOTHING
         RETURNING id`,
        [tournament.id, chalMatchId, p1.id, p2.id, winnerId,
         p1Score, p2Score, attrs.round, attrs.completed_at]
      );

      if (inserted) {
        insertedMatchIds.push(inserted.id);
        importedMatches++;
      }
    }

    // ── ELO computation (only when new matches were inserted) ─────────────
    if (insertedMatchIds.length > 0) {
      // Build current ELO snapshot from playerMap (already has elo_rating from DB RETURNING *)
      const eloMap  = new Map(); // DB player id → current elo (in-flight)
      const gamesMap = new Map(); // DB player id → games played (in-flight)
      for (const [, player] of playerMap) {
        eloMap.set(player.id, player.elo_rating || 1200);
        gamesMap.set(player.id, player.games_played || 0);
      }

      // Sort matches by round ascending for chronological ELO
      const completedMatches = matchList
        .map(m => ({ attrs: m.attributes || m.match || m }))
        .filter(({ attrs }) => attrs.state === 'complete')
        .sort((a, b) => (a.attrs.round || 0) - (b.attrs.round || 0));

      for (const { attrs } of completedMatches) {
        const p1ChalId = String(attrs.player1_id);
        const p2ChalId = String(attrs.player2_id);
        const winnerChalId = String(attrs.winner_id);
        const p1 = playerMap.get(p1ChalId);
        const p2 = playerMap.get(p2ChalId);
        if (!p1 || !p2) continue;

        const pAData = { elo: eloMap.get(p1.id) || 1200, games_played: gamesMap.get(p1.id) || 0 };
        const pBData = { elo: eloMap.get(p2.id) || 1200, games_played: gamesMap.get(p2.id) || 0 };
        const result = winnerChalId === p1ChalId ? 1 : 0;
        const { playerA, playerB } = calculateNewRatings(pAData, pBData, result);

        eloMap.set(p1.id, playerA.newElo);
        eloMap.set(p2.id, playerB.newElo);
        gamesMap.set(p1.id, (gamesMap.get(p1.id) || 0) + 1);
        gamesMap.set(p2.id, (gamesMap.get(p2.id) || 0) + 1);
      }

      // Apply placement bonuses
      for (const [, player] of playerMap) {
        if (!player.finalRank) continue;
        const bonus = placementBonus(player.finalRank, totalParticipants);
        if (bonus > 0 && eloMap.has(player.id)) {
          eloMap.set(player.id, eloMap.get(player.id) + bonus);
        }
      }

      // Write ELO to DB and record history
      for (const [playerId, newElo] of eloMap) {
        const { rows: [cur] } = await db.query('SELECT elo_rating FROM players WHERE id = $1', [playerId]);
        const oldElo = cur?.elo_rating || 1200;
        await db.query(
          `UPDATE players SET elo_rating = $2, peak_elo = GREATEST(peak_elo, $2) WHERE id = $1`,
          [playerId, newElo]
        );
        if (newElo !== oldElo) {
          await db.query(
            `INSERT INTO elo_history (player_id, old_elo, new_elo, delta, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [playerId, oldElo, newElo, newElo - oldElo, `Tournament: ${tournament.name}`]
          );
        }
      }
    }

    // ── Tournament placements & career points ──────────────────────────────
    const tournamentWinnerId = [...playerMap.values()].find(p => p.finalRank === 1)?.id || null;

    for (const [, player] of playerMap) {
      const rank = player.finalRank;
      const pts = rank ? careerPoints(rank, totalParticipants) : 1;

      await db.query(
        `INSERT INTO tournament_placements (tournament_id, player_id, final_rank, career_points)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tournament_id, player_id) DO UPDATE SET
           final_rank = EXCLUDED.final_rank,
           career_points = EXCLUDED.career_points`,
        [tournament.id, player.id, rank, pts]
      );
    }

    // ── Update all involved player stats ───────────────────────────────────
    const involvedIds = [...new Set([...playerMap.values()].map(p => p.id))];
    for (const playerId of involvedIds) {
      await updatePlayerStats(playerId, tournament, playerMap, matchList, tournamentWinnerId, totalParticipants);
    }

    return {
      success: true,
      tournament: tournament.name,
      series,
      participants: totalParticipants,
      matches_imported: importedMatches
    };
  } catch (err) {
    console.error('Import error:', err.response?.data || err.message);
    throw err;
  }
}

// POST /api/tournaments/import  — HTTP wrapper around importOne()
router.post('/import', async (req, res) => {
  const { challonge_id } = req.body;
  if (!challonge_id) return res.status(400).json({ error: 'challonge_id required' });
  // Strip full URL down to slug if pasted
  const slug = challonge_id.trim().replace(/.*challonge\.com\//, '').split('#')[0].split('/')[0];
  try {
    const result = await importOne(slug);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

// POST /api/tournaments/batch-import — import several tournaments at once
// Body: { urls: ["https://challonge.com/abc123", "challonge.com/xyz", ...] }
// Each entry can be a full URL or just a slug.
router.post('/batch-import', async (req, res) => {
  const { urls = [] } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls array is required' });
  }

  const results = { imported: [], skipped: [], errors: [] };

  // Extract slugs and deduplicate
  const slugs = [...new Set(
    urls
      .map(u => String(u).trim())
      .filter(Boolean)
      .map(u => {
        // Handle "https://challonge.com/wise_/ffc12" → "ffc12"
        // Handle "challonge.com/ffc12"               → "ffc12"
        // Handle "ffc12"                             → "ffc12"
        const stripped = u.replace(/^https?:\/\//i, '').replace(/^challonge\.com\//i, '');
        // Take the last non-empty path segment, strip anchors
        const parts = stripped.split('/').filter(Boolean);
        return parts[parts.length - 1]?.split('#')[0] || '';
      })
      .filter(Boolean)
  )];

  if (slugs.length === 0) {
    return res.status(400).json({ error: 'No valid slugs found in urls' });
  }

  // Check which slugs are already in the DB
  const { rows: existing } = await db.query(`SELECT challonge_id FROM tournaments`);
  const existingIds = new Set(existing.map(r => r.challonge_id));

  for (const slug of slugs) {
    if (existingIds.has(slug)) {
      results.skipped.push({ slug, reason: 'already imported' });
      continue;
    }
    try {
      const result = await importOne(slug);
      results.imported.push({ slug, name: result?.name || slug });
      console.log(`✅ Batch imported: ${slug}`);
    } catch (err) {
      console.error(`❌ Batch import failed for ${slug}:`, err.message);
      results.errors.push({ slug, error: err.message });
    }
  }

  res.json({
    total: slugs.length,
    imported: results.imported.length,
    skipped: results.skipped.length,
    errors: results.errors.length,
    detail: results
  });
});

// POST /api/tournaments/preview-dates
// Body: { urls: ["https://challonge.com/...", "https://www.start.gg/...", ...] }
// Returns each URL's tournament date without writing anything to the DB.
// batch_import.js calls this first so it can sort URLs chronologically across
// sources, which keeps live ELO close to correct without a full recalc.
router.post('/preview-dates', async (req, res) => {
  const { urls = [] } = req.body;
  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: 'urls array is required' });
  }

  const results = [];

  for (const raw of urls) {
    const url = String(raw).trim();
    if (!url) continue;

    if (url.includes('start.gg')) {
      const parsed = startgg.parseStartggUrl(url);
      if (!parsed?.phaseGroupId) {
        results.push({ url, source: 'startgg', date: null, error: 'unparseable URL' });
        continue;
      }
      try {
        const pg = await startgg.getPhaseGroup(parsed.phaseGroupId);
        const startAt = pg?.phase?.event?.tournament?.startAt
                     ?? pg?.phase?.event?.startAt
                     ?? null;
        results.push({
          url,
          source: 'startgg',
          phase_group_id: parsed.phaseGroupId,
          date: startAt ? new Date(startAt * 1000).toISOString() : null,
        });
      } catch (err) {
        results.push({ url, source: 'startgg', date: null, error: err.message });
      }
    } else {
      // Treat anything else as a Challonge URL or bare slug
      const slug = challonge.extractSlugFromUrl(url) || url;
      try {
        const data = await challonge.getTournament(slug);
        const t = data?.tournament || data;
        results.push({
          url,
          source: 'challonge',
          slug,
          date: t?.started_at || t?.completed_at || t?.created_at || null,
        });
      } catch (err) {
        results.push({ url, source: 'challonge', date: null, error: err.message });
      }
    }
  }

  res.json({ count: results.length, results });
});

// ── Update a single player's stats after a tournament import ─────────────────
async function updatePlayerStats(playerId, tournament, playerMap, matchList, tournamentWinnerId, totalParticipants) {
  const series = tournament.series;

  // ── Global stats ──────────────────────────────────────────────────────────
  const { rows: [global] } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE winner_id = $1)    AS wins,
       COUNT(*) FILTER (WHERE winner_id != $1)   AS losses,
       COUNT(DISTINCT tournament_id)             AS entered
     FROM matches
     WHERE (player1_id = $1 OR player2_id = $1) AND state = 'complete'`,
    [playerId]
  );

  const { rows: [placements] } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE final_rank = 1)  AS t_wins,
       COUNT(*) FILTER (WHERE final_rank = 2)  AS runner_up,
       COUNT(*) FILTER (WHERE final_rank <= 4) AS top4,
       COUNT(*) FILTER (WHERE final_rank <= 8) AS top8,
       COALESCE(SUM(career_points), 0)         AS career_pts
     FROM tournament_placements WHERE player_id = $1`,
    [playerId]
  );

  // Win streak
  const { rows: recentMatches } = await db.query(
    `SELECT winner_id FROM matches
     WHERE (player1_id = $1 OR player2_id = $1) AND state = 'complete'
     ORDER BY played_at DESC NULLS LAST, id DESC
     LIMIT 50`,
    [playerId]
  );

  let currentStreak = 0, longestStreak = 0, streak = 0;
  for (const m of recentMatches) {
    if (m.winner_id === playerId) { streak++; if (streak > longestStreak) longestStreak = streak; }
    else { if (currentStreak === 0) currentStreak = streak; streak = 0; }
  }
  if (currentStreak === 0) currentStreak = streak;

  // ── Per-series stats ───────────────────────────────────────────────────────
  const seriesStats = {};
  for (const s of ['ffc', 'rtg_na', 'rtg_eu', 'dcm', 'tcc', 'eotr', 'nezumi', 'nezumi_rookies', 'ha']) {
    const { rows: [sr] } = await db.query(
      `SELECT
         COUNT(DISTINCT tp.tournament_id)               AS entered,
         COUNT(*) FILTER (WHERE tp.final_rank <= 8)     AS top8,
         COUNT(*) FILTER (WHERE tp.final_rank <= 4)     AS top4,
         COUNT(*) FILTER (WHERE tp.final_rank = 2)      AS runner_up,
         COUNT(*) FILTER (WHERE tp.final_rank = 1)      AS wins
       FROM tournament_placements tp
       JOIN tournaments t ON tp.tournament_id = t.id
       WHERE tp.player_id = $1 AND t.series = $2`,
      [playerId, s]
    );
    seriesStats[s] = sr;
  }

  // ── Special stat: games taken from champions ───────────────────────────────
  // A "game taken off champion" = the tournament winner beat you but you won at least 1 game (1-2 loss)
  const { rows: [champGames] } = await db.query(
    `SELECT COUNT(*) AS count
     FROM matches m
     JOIN tournament_placements tp ON tp.tournament_id = m.tournament_id AND tp.final_rank = 1
     WHERE
       (m.player1_id = $1 OR m.player2_id = $1)
       AND m.winner_id != $1
       AND tp.player_id = m.winner_id
       AND (
         (m.player1_id = $1 AND m.player1_score >= 1) OR
         (m.player2_id = $1 AND m.player2_score >= 1)
       )`,
    [playerId]
  );

  // ── Comeback wins: won a set after losing game 1 (score 0 then won) ───────
  // We approximate: player was p1 and scored 0 first then won overall
  // With limited score data this is a best-effort calculation
  const { rows: [comebacks] } = await db.query(
    `SELECT COUNT(*) AS count FROM matches
     WHERE winner_id = $1 AND state = 'complete'
       AND (
         (player1_id = $1 AND player1_score IS NOT NULL AND player2_score IS NOT NULL AND player1_score > player2_score AND player2_score > 0) OR
         (player2_id = $1 AND player2_score IS NOT NULL AND player1_score IS NOT NULL AND player2_score > player1_score AND player1_score > 0)
       )`,
    [playerId]
  );

  // ── Commit all stat updates (matches recalculate_elo.js layout) ────────────
  const ALL_SERIES = ['ffc', 'rtg_na', 'rtg_eu', 'dcm', 'tcc', 'eotr', 'nezumi', 'nezumi_rookies', 'ha'];

  const params = [
    playerId,
    parseInt(global.wins),        parseInt(global.losses),      parseInt(global.entered),
    parseInt(placements.t_wins),  parseInt(placements.runner_up), parseInt(placements.top4), parseInt(placements.top8),
    parseInt(placements.career_pts),
    currentStreak,                longestStreak,
  ];
  // Per-series: entered, top8, top4, runner_up, wins (5 fields × 9 series = 45)
  for (const s of ALL_SERIES) {
    const ss = seriesStats[s];
    params.push(
      parseInt(ss.entered), parseInt(ss.top8), parseInt(ss.top4),
      parseInt(ss.runner_up), parseInt(ss.wins)
    );
  }
  params.push(parseInt(champGames.count), parseInt(comebacks.count));

  // Dynamic SET clause — same column order as recalculate_elo.js
  let paramIdx = 2;
  const setFields = [
    'total_match_wins',      'total_match_losses',    'tournaments_entered',
    'tournament_wins',       'runner_up_finishes',    'top4_finishes',         'top8_finishes',
    'career_points',
    'current_win_streak',    'longest_win_streak',
  ];
  for (const s of ALL_SERIES) {
    setFields.push(`${s}_entered`, `${s}_top8`, `${s}_top4`, `${s}_runner_up`, `${s}_wins`);
  }
  setFields.push('games_taken_from_champions', 'comebacks');

  const setClauses = setFields.map(f => `${f} = $${paramIdx++}`).join(', ');

  await db.query(
    `UPDATE players SET ${setClauses},
      games_played = $2::int + $3::int,
      peak_elo = GREATEST(peak_elo, elo_rating),
      updated_at = NOW()
     WHERE id = $1`,
    params
  );

  // ── Pass 1: Stat-based achievements ───────────────────────────────────────
  const tournamentId = tournament.id || null;
  const { rows: [playerFull] } = await db.query(`SELECT * FROM players WHERE id = $1`, [playerId]);
  const { rows: existing } = await db.query(
    `SELECT achievement_id FROM player_achievements WHERE player_id = $1`, [playerId]
  );
  const alreadyUnlocked = existing.map(r => r.achievement_id);
  const pass1New = checkAchievementsPass1(playerFull, alreadyUnlocked);

  for (const achId of pass1New) {
    await db.query(
      `INSERT INTO player_achievements (player_id, achievement_id, tournament_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [playerId, achId, tournamentId]
    );
  }

  // ── Pass 2: Match-based & meta achievements ─────────────────────────────
  // Re-fetch unlocked list (now includes Pass 1 results)
  const { rows: existingAfterP1 } = await db.query(
    `SELECT achievement_id FROM player_achievements WHERE player_id = $1`, [playerId]
  );
  const unlockedAfterP1 = existingAfterP1.map(r => r.achievement_id);
  const pass2New = await checkAchievementsPass2(playerId, db, unlockedAfterP1);

  for (const ach of pass2New) {
    await db.query(
      `INSERT INTO player_achievements (player_id, achievement_id, tournament_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [playerId, ach.id, tournamentId]
    );

    // Persist defeated-opponent evidence for meta & match-based achievements
    if (ach.contributors && ach.contributors.length > 0) {
      for (const c of ach.contributors) {
        await db.query(
          `INSERT INTO achievement_defeated_opponents (player_id, achievement_id, opponent_id, match_id)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [playerId, ach.id, c.opponent_id, c.match_id || null]
        );
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// start.gg import
// ══════════════════════════════════════════════════════════════════════════════

async function importOneStartgg(phaseGroupId) {
  try {
    // ── Fetch bracket + metadata from start.gg ─────────────────────────────
    const bracket = await startgg.getAllSets(phaseGroupId);

    const event      = bracket.phase?.event;
    const tournament = event?.tournament;
    if (!tournament) throw new Error(`No tournament metadata returned for phaseGroup ${phaseGroupId}`);

    const tournamentName = tournament.name || `start.gg #${phaseGroupId}`;
    const series         = detectSeries(tournament.slug || '', tournamentName);

    // start.gg timestamps are Unix seconds — convert to ISO for Postgres
    const startedAt   = event.startAt   ? new Date(event.startAt   * 1000).toISOString() : null;
    const endedAt     = tournament.endAt ? new Date(tournament.endAt * 1000).toISOString() : null;
    const numEntrants = event.numEntrants || null;

    // ── Upsert tournament ──────────────────────────────────────────────────
    const { rows: [t] } = await db.query(
      `INSERT INTO tournaments
         (challonge_id, name, series, participants_count, started_at, completed_at,
          source, startgg_slug, startgg_phase_group_id)
       VALUES (NULL, $1, $2, $3, $4, $5, 'startgg', $6, $7)
       ON CONFLICT (startgg_phase_group_id) WHERE startgg_phase_group_id IS NOT NULL
       DO UPDATE SET
         name               = EXCLUDED.name,
         series             = EXCLUDED.series,
         participants_count = EXCLUDED.participants_count,
         started_at         = EXCLUDED.started_at,
         completed_at       = EXCLUDED.completed_at
       RETURNING *`,
      [
        tournamentName,
        series,
        numEntrants,
        startedAt,
        endedAt,
        tournament.slug || null,
        String(phaseGroupId),
      ]
    );

    // ── Build player map from set slots ────────────────────────────────────
    // Collect every unique entrant name across all completed sets.
    const sets = bracket.sets.nodes.filter(s => s.state === 3); // 3 = completed
    const entrantMap = new Map(); // startgg entrant id (string) → our player row

    const allEntrants = new Map();
    for (const set of sets) {
      for (const slot of set.slots) {
        if (slot.entrant) allEntrants.set(String(slot.entrant.id), slot.entrant.name);
      }
    }

    for (const [entrantId, entrantName] of allEntrants) {
      // Use lowercased display name as the unique key, same as Challonge does.
      // This naturally merges players who compete on both platforms under the same handle.
      let username    = entrantName.toLowerCase().replace(/\s+/g, '_');
      username = await resolveAlias(username);
      const displayName = entrantName;

      const { rows: [player] } = await db.query(
        `INSERT INTO players (challonge_username, display_name)
         VALUES ($1, $2)
         ON CONFLICT (challonge_username) DO UPDATE SET
           display_name = EXCLUDED.display_name
         RETURNING *`,
        [username, displayName]
      );
      entrantMap.set(entrantId, player);
    }

    // Derive final placements from set slot standings
    const placementByEntrantId = new Map();
    for (const set of sets) {
      for (const slot of set.slots) {
        if (slot.entrant && slot.standing?.placement) {
          const existing = placementByEntrantId.get(String(slot.entrant.id));
          // Keep the best (lowest) placement seen
          if (!existing || slot.standing.placement < existing) {
            placementByEntrantId.set(String(slot.entrant.id), slot.standing.placement);
          }
        }
      }
    }

    const totalParticipants = allEntrants.size;

    // ── Upsert matches ─────────────────────────────────────────────────────
    let importedMatches = 0;
    const insertedMatchIds = [];

    // Determine winners vs losers bracket section from fullRoundText
    function bracketSection(fullRoundText = '') {
      const t = fullRoundText.toLowerCase();
      if (t.includes('grand final')) return 'grand_final';
      if (t.includes('winner'))      return 'winners';
      if (t.includes('loser'))       return 'losers';
      return null;
    }

    for (const set of sets) {
      const p1Slot = set.slots[0];
      const p2Slot = set.slots[1];
      if (!p1Slot?.entrant || !p2Slot?.entrant) continue;

      const p1 = entrantMap.get(String(p1Slot.entrant.id));
      const p2 = entrantMap.get(String(p2Slot.entrant.id));
      if (!p1 || !p2) continue;

      const winnerId = set.winnerId === p1Slot.entrant.id ? p1.id : p2.id;

      const { rows: [inserted] } = await db.query(
        `INSERT INTO matches
           (tournament_id, challonge_match_id, player1_id, player2_id, winner_id,
            round, bracket_section, state, played_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'complete', $8)
         ON CONFLICT (tournament_id, challonge_match_id) DO NOTHING
         RETURNING id`,
        [
          t.id,
          String(set.id),        // use start.gg set id as match identifier
          p1.id,
          p2.id,
          winnerId,
          set.round || null,
          bracketSection(set.fullRoundText),
          startedAt,             // best available date for individual matches
        ]
      );

      if (inserted) {
        insertedMatchIds.push(inserted.id);
        importedMatches++;
      }
    }

    // ── ELO computation ────────────────────────────────────────────────────
    if (insertedMatchIds.length > 0) {
      const eloMap   = new Map();
      const gamesMap = new Map();
      for (const [, player] of entrantMap) {
        eloMap.set(player.id, player.elo_rating || 1200);
        gamesMap.set(player.id, player.games_played || 0);
      }

      // Sort by round ascending for chronological ELO
      const sortedSets = [...sets].sort((a, b) => (a.round || 0) - (b.round || 0));

      for (const set of sortedSets) {
        const p1Slot = set.slots[0];
        const p2Slot = set.slots[1];
        if (!p1Slot?.entrant || !p2Slot?.entrant) continue;

        const p1 = entrantMap.get(String(p1Slot.entrant.id));
        const p2 = entrantMap.get(String(p2Slot.entrant.id));
        if (!p1 || !p2) continue;

        const pAData = { elo: eloMap.get(p1.id) || 1200, games_played: gamesMap.get(p1.id) || 0 };
        const pBData = { elo: eloMap.get(p2.id) || 1200, games_played: gamesMap.get(p2.id) || 0 };
        const result = set.winnerId === p1Slot.entrant.id ? 1 : 0;
        const { playerA, playerB } = calculateNewRatings(pAData, pBData, result);

        eloMap.set(p1.id, Math.max(1200, playerA.newElo));
        eloMap.set(p2.id, Math.max(1200, playerB.newElo));
        gamesMap.set(p1.id, (gamesMap.get(p1.id) || 0) + 1);
        gamesMap.set(p2.id, (gamesMap.get(p2.id) || 0) + 1);
      }

      // Placement bonuses
      for (const [entrantId, player] of entrantMap) {
        const rank = placementByEntrantId.get(entrantId);
        if (!rank) continue;
        const bonus = placementBonus(rank, totalParticipants);
        if (bonus > 0 && eloMap.has(player.id)) {
          eloMap.set(player.id, eloMap.get(player.id) + bonus);
        }
      }

      // Persist ELO
      for (const [playerId, newElo] of eloMap) {
        const { rows: [cur] } = await db.query('SELECT elo_rating FROM players WHERE id = $1', [playerId]);
        const oldElo = cur?.elo_rating || 1200;
        await db.query(
          `UPDATE players SET elo_rating = $2, peak_elo = GREATEST(peak_elo, $2) WHERE id = $1`,
          [playerId, newElo]
        );
        if (newElo !== oldElo) {
          await db.query(
            `INSERT INTO elo_history (player_id, old_elo, new_elo, delta, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [playerId, oldElo, newElo, newElo - oldElo, `Tournament: ${tournamentName}`]
          );
        }
      }
    }

    // ── Tournament placements & career points ──────────────────────────────
    for (const [entrantId, player] of entrantMap) {
      const rank = placementByEntrantId.get(entrantId) || null;
      const pts  = rank ? careerPoints(rank, totalParticipants) : 1;

      await db.query(
        `INSERT INTO tournament_placements (tournament_id, player_id, final_rank, career_points)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tournament_id, player_id) DO UPDATE SET
           final_rank   = EXCLUDED.final_rank,
           career_points = EXCLUDED.career_points`,
        [t.id, player.id, rank, pts]
      );
    }

    // ── Update player stats ────────────────────────────────────────────────
    const tournamentWinnerId = [...entrantMap.entries()]
      .find(([entrantId]) => placementByEntrantId.get(entrantId) === 1)?.[1]?.id || null;

    for (const [, player] of entrantMap) {
      await updatePlayerStats(player.id, t, entrantMap, sets, tournamentWinnerId, totalParticipants);
    }

    return {
      success: true,
      tournament: tournamentName,
      series,
      participants: totalParticipants,
      matches_imported: importedMatches,
      started_at: startedAt,
    };
  } catch (err) {
    console.error('start.gg import error:', err.message);
    throw err;
  }
}

// POST /api/tournaments/import-startgg — import a single start.gg bracket
router.post('/import-startgg', async (req, res) => {
  const { url, phase_group_id } = req.body;

  let pgId = phase_group_id;
  if (!pgId && url) {
    const parsed = startgg.parseStartggUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Could not parse phase_group_id from URL' });
    pgId = parsed.phaseGroupId;
  }
  if (!pgId) return res.status(400).json({ error: 'url or phase_group_id required' });

  try {
    const result = await importOneStartgg(pgId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournaments/batch-import-startgg
// Body: { urls: ["https://www.start.gg/tournament/.../brackets/PHASE/PHASEGROUP/..."] }
router.post('/batch-import-startgg', async (req, res) => {
  const { urls = [] } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls array is required' });
  }

  const results = { imported: [], skipped: [], errors: [] };

  // Check which phase group IDs are already imported
  const { rows: existing } = await db.query(
    `SELECT startgg_phase_group_id FROM tournaments WHERE startgg_phase_group_id IS NOT NULL`
  );
  const existingIds = new Set(existing.map(r => r.startgg_phase_group_id));

  for (const url of urls) {
    const parsed = startgg.parseStartggUrl(String(url).trim());
    if (!parsed) {
      results.errors.push({ url, error: 'Could not parse phase_group_id from URL' });
      continue;
    }
    const { phaseGroupId } = parsed;

    if (existingIds.has(phaseGroupId)) {
      results.skipped.push({ url, phaseGroupId, reason: 'already imported' });
      continue;
    }

    try {
      const result = await importOneStartgg(phaseGroupId);
      results.imported.push({ url, phaseGroupId, name: result.tournament });
      console.log(`✅ start.gg imported: ${result.tournament} (pgid ${phaseGroupId})`);
    } catch (err) {
      console.error(`❌ start.gg import failed for ${phaseGroupId}:`, err.message);
      results.errors.push({ url, phaseGroupId, error: err.message });
    }
  }

  res.json({
    total:    urls.length,
    imported: results.imported.length,
    skipped:  results.skipped.length,
    errors:   results.errors.length,
    detail:   results,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Tonamel import (ポッ拳ねずみ杯 / Mouse Cup)
//
// Accepts pre-parsed bracket data extracted from the Tonamel DOM by the
// browser console script (tonamel_import_console.js). No Tonamel account
// or API token is required — results are scraped from the public page.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Derive final placements from a double-elimination bracket.
 *
 * Tonamel match IDs: #W1-1 (Winners R1 M1), #L3-2 (Losers R3 M2), etc.
 *
 * Interleaving order: W and L rounds alternate chronologically, so the weight
 * of match #Wn-x  = n*2 - 1  and  #Ln-x = n*2.
 * This means W1 < L1 < W2 < L2 < W3 < L3 … < GF < GF_reset.
 *
 * The player whose last match is a WIN is 1st.
 * All other players are ranked by the weight of the last match they appeared in
 * (higher weight = eliminated later = better placement).
 * Ties within the same last-match are assigned the same rank.
 */
function deriveTonamelPlacements(matches) {
  const parseId = (id) => {
    const m = id.match(/^#([WL])(\d+)-(\d+)/);
    if (!m) return null;
    return { bracket: m[1], round: parseInt(m[2]) };
  };

  // weight: earlier rounds eliminated = lower weight = worse placement
  const weight = (bracket, round) =>
    bracket === 'W' ? round * 2 - 1 : round * 2;

  // Track each player's highest-weight match appearance (win or loss)
  const playerRecord = new Map(); // username → { weight, isWin }

  for (const match of matches) {
    const parsed = parseId(match.matchId);
    if (!parsed) continue;
    const w = weight(parsed.bracket, parsed.round);

    const update = (username, isWin) => {
      const cur = playerRecord.get(username);
      if (!cur || w > cur.weight || (w === cur.weight && isWin)) {
        playerRecord.set(username, { weight: w, isWin });
      }
    };

    update(match.winner, true);
    update(match.loser,  false);
  }

  // Sort: winner of final (isWin=true) goes first, then by weight desc
  const sorted = Array.from(playerRecord.entries()).sort((a, b) => {
    if (a[1].isWin !== b[1].isWin) return a[1].isWin ? -1 : 1;
    return b[1].weight - a[1].weight;
  });

  // Assign placements (tied players at the same weight share the same rank)
  const placements = {};
  let rank = 1;
  let i = 0;
  while (i < sorted.length) {
    const { weight: w, isWin } = sorted[i][1];
    let j = i;
    while (j < sorted.length &&
           sorted[j][1].weight === w &&
           sorted[j][1].isWin  === isWin) {
      placements[sorted[j][0]] = rank;
      j++;
    }
    rank += (j - i);
    i = j;
  }

  return placements;
}

/**
 * Import one Tonamel competition.
 *
 * @param {object} payload
 *   tonamel_id       - competition ID from the Tonamel URL (e.g. 'Sbekx')
 *   name             - tournament display name
 *   series           - 'nezumi' | 'nezumi_rookies' | 'other'
 *   date             - ISO date string for completed_at
 *   participants_count - number of entrants
 *   matches          - array of { matchId, winner, loser, p1, p1Score, p2, p2Score }
 *                      where p1/p2/winner/loser are Tonamel display names
 */
async function importOneTonamel(payload) {
  const { tonamel_id, name, series, date, participants_count, matches } = payload;

  if (!tonamel_id) throw new Error('tonamel_id is required');
  if (!Array.isArray(matches) || matches.length === 0) throw new Error('matches array is required');

  // ── Derive placements ───────────────────────────────────────────────────────
  const placements = deriveTonamelPlacements(matches);

  // ── Upsert tournament ───────────────────────────────────────────────────────
  const completedAt = date ? new Date(date).toISOString() : null;

  const { rows: [tournament] } = await db.query(
    `INSERT INTO tournaments
       (challonge_id, name, series, participants_count, completed_at, started_at,
        source, tonamel_id)
     VALUES (NULL, $1, $2, $3, $4, $4, 'tonamel', $5)
     ON CONFLICT (tonamel_id) WHERE tonamel_id IS NOT NULL
     DO UPDATE SET
       name               = EXCLUDED.name,
       series             = EXCLUDED.series,
       participants_count = EXCLUDED.participants_count,
       completed_at       = EXCLUDED.completed_at
     RETURNING *`,
    [name, series, participants_count || null, completedAt, tonamel_id]
  );

  // ── Upsert players ──────────────────────────────────────────────────────────
  // Collect unique player names from all matches
  const allNames = new Set();
  for (const m of matches) {
    if (m.p1) allNames.add(m.p1);
    if (m.p2) allNames.add(m.p2);
  }

  const playerMap = new Map(); // display name → player row

  for (const displayName of allNames) {
    // Use lowercased name as the stable key, same approach as start.gg importer
    let username = displayName.toLowerCase().replace(/\s+/g, '_');
    username = await resolveAlias(username);
    // Tonamel sources are JP-only — auto-tag region on insert, fill in if NULL on update.
    // Players who already have a non-NULL region (e.g. someone manually flagged elsewhere)
    // are left alone via COALESCE.
    const { rows: [player] } = await db.query(
      `INSERT INTO players (challonge_username, display_name, region)
       VALUES ($1, $2, 'JP')
       ON CONFLICT (challonge_username) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         region       = COALESCE(players.region, 'JP')
       RETURNING *`,
      [username, displayName]
    );
    playerMap.set(displayName, player);
  }

  const totalParticipants = participants_count || allNames.size;

  // ── Upsert matches ──────────────────────────────────────────────────────────
  let importedMatches = 0;
  const insertedMatchIds = [];

  // Sort matches by their bracket weight for chronological ELO (early → late)
  const parseId = (id) => {
    const m = id.match(/^#([WL])(\d+)-(\d+)/);
    if (!m) return { bracket: 'W', round: 0 };
    return { bracket: m[1], round: parseInt(m[2]) };
  };
  const matchWeight = (m) => {
    const { bracket, round } = parseId(m.matchId);
    return bracket === 'W' ? round * 2 - 1 : round * 2;
  };

  const sortedMatches = [...matches].sort((a, b) => matchWeight(a) - matchWeight(b));

  for (const m of sortedMatches) {
    const p1 = playerMap.get(m.p1);
    const p2 = playerMap.get(m.p2);
    if (!p1 || !p2) continue;

    const winner = playerMap.get(m.winner);
    if (!winner) continue;

    const parsed = parseId(m.matchId);
    const section = parsed.bracket === 'W' ? 'winners' : 'losers';

    const { rows: [inserted] } = await db.query(
      `INSERT INTO matches
         (tournament_id, challonge_match_id, player1_id, player2_id, winner_id,
          player1_score, player2_score, round, bracket_section, state, played_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'complete', $10)
       ON CONFLICT (tournament_id, challonge_match_id) DO NOTHING
       RETURNING id`,
      [
        tournament.id,
        m.matchId,
        p1.id, p2.id, winner.id,
        m.p1Score != null ? m.p1Score : null,
        m.p2Score != null ? m.p2Score : null,
        parsed.round,
        section,
        completedAt
      ]
    );

    if (inserted) {
      insertedMatchIds.push(inserted.id);
      importedMatches++;
    }
  }

  // ── ELO computation ─────────────────────────────────────────────────────────
  if (insertedMatchIds.length > 0) {
    const eloMap   = new Map();
    const gamesMap = new Map();
    for (const [, player] of playerMap) {
      eloMap.set(player.id, player.elo_rating || 1200);
      gamesMap.set(player.id, player.games_played || 0);
    }

    for (const m of sortedMatches) {
      const p1 = playerMap.get(m.p1);
      const p2 = playerMap.get(m.p2);
      if (!p1 || !p2) continue;

      const pAData = { elo: eloMap.get(p1.id) || 1200, games_played: gamesMap.get(p1.id) || 0 };
      const pBData = { elo: eloMap.get(p2.id) || 1200, games_played: gamesMap.get(p2.id) || 0 };
      const result = m.winner === m.p1 ? 1 : 0;
      const { playerA, playerB } = calculateNewRatings(pAData, pBData, result);

      eloMap.set(p1.id, playerA.newElo);
      eloMap.set(p2.id, playerB.newElo);
      gamesMap.set(p1.id, (gamesMap.get(p1.id) || 0) + 1);
      gamesMap.set(p2.id, (gamesMap.get(p2.id) || 0) + 1);
    }

    // Placement bonuses
    for (const [name, player] of playerMap) {
      const rank = placements[name];
      if (!rank) continue;
      const bonus = placementBonus(rank, totalParticipants);
      if (bonus > 0) eloMap.set(player.id, (eloMap.get(player.id) || 1200) + bonus);
    }

    // Persist ELO
    for (const [playerId, newElo] of eloMap) {
      const { rows: [cur] } = await db.query('SELECT elo_rating FROM players WHERE id = $1', [playerId]);
      const oldElo = cur?.elo_rating || 1200;
      await db.query(
        `UPDATE players SET elo_rating = $2, peak_elo = GREATEST(peak_elo, $2) WHERE id = $1`,
        [playerId, newElo]
      );
      if (newElo !== oldElo) {
        await db.query(
          `INSERT INTO elo_history (player_id, old_elo, new_elo, delta, reason) VALUES ($1,$2,$3,$4,$5)`,
          [playerId, oldElo, newElo, newElo - oldElo, `Tournament: ${name}`]
        );
      }
    }
  }

  // ── Tournament placements & career points ───────────────────────────────────
  const tournamentWinnerId = [...playerMap.entries()]
    .find(([n]) => placements[n] === 1)?.[1]?.id || null;

  for (const [playerName, player] of playerMap) {
    const rank = placements[playerName] || null;
    const pts  = rank ? careerPoints(rank, totalParticipants) : 1;

    await db.query(
      `INSERT INTO tournament_placements (tournament_id, player_id, final_rank, career_points)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tournament_id, player_id) DO UPDATE SET
         final_rank    = EXCLUDED.final_rank,
         career_points = EXCLUDED.career_points`,
      [tournament.id, player.id, rank, pts]
    );
  }

  // ── Update player stats ─────────────────────────────────────────────────────
  for (const [, player] of playerMap) {
    await updatePlayerStats(player.id, tournament, playerMap, matches, tournamentWinnerId, totalParticipants);
  }

  return {
    success: true,
    tournament: name,
    series,
    participants: totalParticipants,
    matches_imported: importedMatches,
    placements,
  };
}

// POST /api/tournaments/import-tonamel — import a single Tonamel bracket
// Body: { tonamel_id, name, series, date, participants_count, matches: [...] }
router.post('/import-tonamel', async (req, res) => {
  try {
    const result = await importOneTonamel(req.body);
    res.json(result);
  } catch (err) {
    console.error('Tonamel import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournaments/batch-import-tonamel
// Body: { tournaments: [{ tonamel_id, name, series, date, participants_count, matches }, ...] }
router.post('/batch-import-tonamel', async (req, res) => {
  const { tournaments = [] } = req.body;
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    return res.status(400).json({ error: 'tournaments array is required' });
  }

  const results = { imported: [], skipped: [], errors: [] };

  const { rows: existing } = await db.query(
    `SELECT tonamel_id FROM tournaments WHERE tonamel_id IS NOT NULL`
  );
  const existingIds = new Set(existing.map(r => r.tonamel_id));

  for (const t of tournaments) {
    if (!t.tonamel_id) {
      results.errors.push({ name: t.name, error: 'missing tonamel_id' });
      continue;
    }
    if (existingIds.has(t.tonamel_id)) {
      results.skipped.push({ tonamel_id: t.tonamel_id, name: t.name, reason: 'already imported' });
      continue;
    }
    try {
      const result = await importOneTonamel(t);
      results.imported.push({ tonamel_id: t.tonamel_id, name: t.name });
      console.log(`✅ Tonamel imported: ${t.name}`);
    } catch (err) {
      console.error(`❌ Tonamel import failed for ${t.tonamel_id}:`, err.message);
      results.errors.push({ tonamel_id: t.tonamel_id, name: t.name, error: err.message });
    }
  }

  res.json({
    total:    tournaments.length,
    imported: results.imported.length,
    skipped:  results.skipped.length,
    errors:   results.errors.length,
    detail:   results,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Offline (Liquipedia) import
// Stores real-world offline tournament results.
// No match data — only 1st and 2nd place are recorded.
// Offline events do NOT affect ELO (online competitive rating stays separate).
// ══════════════════════════════════════════════════════════════════════════════

// Weighted offline score: placement points × tier prestige
const OFFLINE_WEIGHTS = {
  worlds:   { wins: 100, runner_up: 60, top4: 35, top8: 20 },
  major:    { wins: 50,  runner_up: 30, top4: 18, top8: 10 },
  regional: { wins: 25,  runner_up: 15, top4: 9,  top8: 5 },
  other:    { wins: 10,  runner_up: 6,  top4: 3,  top8: 2 },
};

/**
 * Recalculate all per-tier offline stats and offline_score for a player.
 * Called after each offline import and during full recalculation.
 */
async function refreshOfflineStats(playerId) {
  const { rows: [s] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank = 1)   AS worlds_wins,
      COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank = 2)   AS worlds_runner_up,
      COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank <= 4)  AS worlds_top4,
      COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank <= 8)  AS worlds_top8,
      COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank = 1)    AS major_wins,
      COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank = 2)    AS major_runner_up,
      COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank <= 4)   AS major_top4,
      COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank <= 8)   AS major_top8,
      COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank = 1) AS regional_wins,
      COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank = 2) AS regional_runner_up,
      COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank <= 4) AS regional_top4,
      COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank <= 8) AS regional_top8,
      COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank = 1)    AS other_wins,
      COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank = 2)    AS other_runner_up,
      COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank <= 4)   AS other_top4,
      COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank <= 8)   AS other_top8,
      COUNT(*) FILTER (WHERE tp.final_rank = 1)  AS total_wins,
      COUNT(*) FILTER (WHERE tp.final_rank <= 2) AS total_top2
    FROM tournament_placements tp
    JOIN tournaments t ON tp.tournament_id = t.id
    WHERE tp.player_id = $1 AND t.is_offline = TRUE
  `, [playerId]);

  // Calculate weighted score
  let score = 0;
  for (const [tier, w] of Object.entries(OFFLINE_WEIGHTS)) {
    const wins = parseInt(s[`${tier}_wins`]) || 0;
    const ru   = parseInt(s[`${tier}_runner_up`]) || 0;
    const top4 = parseInt(s[`${tier}_top4`]) || 0;
    const top8 = parseInt(s[`${tier}_top8`]) || 0;
    // top4 count includes wins+runner_up, top8 includes top4 — use exclusive counts
    const pure_top4 = Math.max(0, top4 - wins - ru);
    const pure_top8 = Math.max(0, top8 - top4);
    score += wins * w.wins + ru * w.runner_up + pure_top4 * w.top4 + pure_top8 * w.top8;
  }

  await db.query(`
    UPDATE players SET
      offline_wins = $2, offline_top2 = $3,
      offline_worlds_wins = $4, offline_worlds_runner_up = $5,
      offline_worlds_top4 = $6, offline_worlds_top8 = $7,
      offline_major_wins = $8, offline_major_runner_up = $9,
      offline_major_top4 = $10, offline_major_top8 = $11,
      offline_regional_wins = $12, offline_regional_runner_up = $13,
      offline_regional_top4 = $14, offline_regional_top8 = $15,
      offline_other_wins = $16, offline_other_runner_up = $17,
      offline_other_top4 = $18, offline_other_top8 = $19,
      offline_score = $20
    WHERE id = $1
  `, [
    playerId,
    parseInt(s.total_wins) || 0, parseInt(s.total_top2) || 0,
    parseInt(s.worlds_wins) || 0, parseInt(s.worlds_runner_up) || 0,
    parseInt(s.worlds_top4) || 0, parseInt(s.worlds_top8) || 0,
    parseInt(s.major_wins) || 0, parseInt(s.major_runner_up) || 0,
    parseInt(s.major_top4) || 0, parseInt(s.major_top8) || 0,
    parseInt(s.regional_wins) || 0, parseInt(s.regional_runner_up) || 0,
    parseInt(s.regional_top4) || 0, parseInt(s.regional_top8) || 0,
    parseInt(s.other_wins) || 0, parseInt(s.other_runner_up) || 0,
    parseInt(s.other_top4) || 0, parseInt(s.other_top8) || 0,
    score,
  ]);
}

async function importOneOffline({ name, date, location, prize_pool, participants_count, winner, runner_up, liquipedia_slug }) {
  if (!name)   throw new Error('name is required');
  if (!date)   throw new Error('date is required');
  if (!winner) throw new Error('winner is required');

  // Derive a stable slug from the name if not supplied
  const slug = liquipedia_slug ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');

  // ── Detect offline tier ────────────────────────────────────────────────────
  const tier = detectOfflineTier(name);

  // ── Upsert tournament ──────────────────────────────────────────────────────
  const { rows: [tournament] } = await db.query(
    `INSERT INTO tournaments
       (challonge_id, name, series, is_offline, location, prize_pool, participants_count,
        completed_at, started_at, source, liquipedia_slug)
     VALUES (NULL, $1, $7, TRUE, $2, $3, $4, $5, $5, 'offline', $6)
     ON CONFLICT (liquipedia_slug) WHERE liquipedia_slug IS NOT NULL
     DO UPDATE SET
       name               = EXCLUDED.name,
       series             = EXCLUDED.series,
       location           = EXCLUDED.location,
       prize_pool         = EXCLUDED.prize_pool,
       participants_count = EXCLUDED.participants_count,
       completed_at       = EXCLUDED.completed_at
     RETURNING *`,
    [name, location || null, prize_pool || null, participants_count || null, date, slug, tier]
  );

  // Helper: upsert a player by display name (same logic as start.gg/Tonamel)
  async function upsertOfflinePlayer(displayName) {
    let username = displayName.toLowerCase().replace(/\s+/g, '_');
    username = await resolveAlias(username);
    const { rows: [player] } = await db.query(
      `INSERT INTO players (challonge_username, display_name)
       VALUES ($1, $2)
       ON CONFLICT (challonge_username) DO UPDATE SET
         display_name = EXCLUDED.display_name
       RETURNING *`,
      [username, displayName]
    );
    return player;
  }

  // ── Insert 1st place ───────────────────────────────────────────────────────
  const winnerPlayer = await upsertOfflinePlayer(winner);

  await db.query(
    `INSERT INTO tournament_placements (tournament_id, player_id, final_rank, career_points)
     VALUES ($1, $2, 1, 10)
     ON CONFLICT (tournament_id, player_id) DO UPDATE SET final_rank = 1, career_points = 10`,
    [tournament.id, winnerPlayer.id]
  );

  // ── Insert 2nd place ───────────────────────────────────────────────────────
  let runnerUpPlayer = null;
  if (runner_up) {
    runnerUpPlayer = await upsertOfflinePlayer(runner_up);

    await db.query(
      `INSERT INTO tournament_placements (tournament_id, player_id, final_rank, career_points)
       VALUES ($1, $2, 2, 7)
       ON CONFLICT (tournament_id, player_id) DO UPDATE SET final_rank = 2, career_points = 7`,
      [tournament.id, runnerUpPlayer.id]
    );
  }

  // ── Refresh all offline stats for affected players ─────────────────────
  const playersToRefresh = [winnerPlayer.id];
  if (runnerUpPlayer) playersToRefresh.push(runnerUpPlayer.id);

  for (const pid of playersToRefresh) {
    await refreshOfflineStats(pid);
  }

  return {
    success: true,
    tournament: name,
    winner,
    runner_up: runner_up || null,
    liquipedia_slug: slug,
  };
}

// POST /api/tournaments/import-offline
// Body: { name, date, location, prize_pool, participants_count, winner, runner_up, liquipedia_slug }
router.post('/import-offline', async (req, res) => {
  try {
    const result = await importOneOffline(req.body);
    res.json(result);
  } catch (err) {
    console.error('Offline import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournaments/batch-import-offline
// Body: { tournaments: [{ name, date, location, prize_pool, participants_count, winner, runner_up, liquipedia_slug }] }
router.post('/batch-import-offline', async (req, res) => {
  const { tournaments = [] } = req.body;
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    return res.status(400).json({ error: 'tournaments array is required' });
  }

  const results = { imported: [], skipped: [], errors: [] };

  // Fetch already-imported slugs
  const { rows: existing } = await db.query(
    `SELECT liquipedia_slug FROM tournaments WHERE liquipedia_slug IS NOT NULL`
  );
  const existingSlugs = new Set(existing.map(r => r.liquipedia_slug));

  for (const t of tournaments) {
    const slug = t.liquipedia_slug ||
      (t.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');

    if (existingSlugs.has(slug)) {
      results.skipped.push({ name: t.name, reason: 'already imported' });
      continue;
    }

    try {
      const result = await importOneOffline({ ...t, liquipedia_slug: slug });
      results.imported.push({ name: t.name, winner: t.winner });
      existingSlugs.add(slug); // prevent duplicates within same batch
      console.log(`✅ Offline imported: ${t.name}`);
    } catch (err) {
      console.error(`❌ Offline import failed for ${t.name}:`, err.message);
      results.errors.push({ name: t.name, error: err.message });
    }
  }

  res.json({
    total:    tournaments.length,
    imported: results.imported.length,
    skipped:  results.skipped.length,
    errors:   results.errors.length,
    detail:   results,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Liquipedia bracket import
//
// Accepts pre-parsed bracket data from liquipedia_import_console.js.
// Uses fetch() on same-origin Liquipedia pages — no navigation needed.
// Unlike the basic offline import, this stores full match data and computes ELO.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Derive a stable slug from a Liquipedia bracket URL.
 * e.g. "https://liquipedia.net/fighters/Frostfire/2022/Pokken/Bracket"
 *      → "frostfire/2022/pokken"
 */
function liquipediaUrlToSlug(bracketUrl) {
  return bracketUrl
    .replace(/^https?:\/\/liquipedia\.net\/fighters\//i, '')
    .replace(/\/Bracket\/?$/i, '')
    .toLowerCase();
}

async function importOneLiquipediaBracket({ bracketUrl, name, date, location, prize_pool, participants_count, matches }) {
  if (!bracketUrl) throw new Error('bracketUrl is required');
  if (!Array.isArray(matches) || matches.length === 0) throw new Error('matches array is required');

  const liquipediaUrl = liquipediaUrlToSlug(bracketUrl);
  const completedAt   = date ? new Date(date).toISOString() : null;

  // ── Find or create tournament ──────────────────────────────────────────────
  // 1st: try exact liquipedia_url match
  // 2nd: try matching an existing offline record by name (links it to the bracket data)
  // 3rd: create new
  let tournament;

  const { rows: [byUrl] } = await db.query(
    `SELECT * FROM tournaments WHERE liquipedia_url = $1`, [liquipediaUrl]
  );

  if (byUrl) {
    // Update metadata and link
    const { rows: [updated] } = await db.query(
      `UPDATE tournaments SET
         name               = COALESCE($2, name),
         completed_at       = COALESCE($3, completed_at),
         location           = COALESCE($4, location),
         prize_pool         = COALESCE($5, prize_pool),
         participants_count = COALESCE($6, participants_count),
         is_offline         = TRUE
       WHERE id = $1 RETURNING *`,
      [byUrl.id, name || null, completedAt, location || null, prize_pool || null, participants_count || null]
    );
    tournament = updated;
  } else {
    // Try to find by name in offline records — link the bracket data to the existing record
    const { rows: [byName] } = name ? await db.query(
      `SELECT * FROM tournaments WHERE is_offline = TRUE AND name ILIKE $1 LIMIT 1`,
      [`%${name}%`]
    ) : { rows: [] };

    if (byName) {
      const { rows: [updated] } = await db.query(
        `UPDATE tournaments SET
           liquipedia_url     = $2,
           completed_at       = COALESCE($3, completed_at),
           location           = COALESCE($4, location),
           prize_pool         = COALESCE($5, prize_pool),
           participants_count = COALESCE($6, participants_count)
         WHERE id = $1 RETURNING *`,
        [byName.id, liquipediaUrl, completedAt, location || null, prize_pool || null, participants_count || null]
      );
      tournament = updated;
    } else {
      // Create new offline tournament record
      const { rows: [created] } = await db.query(
        `INSERT INTO tournaments
           (challonge_id, name, is_offline, location, prize_pool, participants_count,
            completed_at, started_at, source, liquipedia_url)
         VALUES (NULL, $1, TRUE, $2, $3, $4, $5, $5, 'offline', $6)
         RETURNING *`,
        [name || liquipediaUrl, location || null, prize_pool || null, participants_count || null, completedAt, liquipediaUrl]
      );
      tournament = created;
    }
  }

  // ── Upsert players ─────────────────────────────────────────────────────────
  const allNames = new Set();
  for (const m of matches) {
    if (m.p1) allNames.add(m.p1);
    if (m.p2) allNames.add(m.p2);
  }

  const playerMap = new Map(); // display name → player row
  for (const displayName of allNames) {
    let username = displayName.toLowerCase().replace(/\s+/g, '_');
    username = await resolveAlias(username);
    const { rows: [player] } = await db.query(
      `INSERT INTO players (challonge_username, display_name)
       VALUES ($1, $2)
       ON CONFLICT (challonge_username) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING *`,
      [username, displayName]
    );
    playerMap.set(displayName, player);
  }

  const totalParticipants = participants_count || allNames.size;

  // ── Upsert matches (sorted by weight for chronological ELO) ───────────────
  const sortedMatches = [...matches].sort((a, b) => (a.weight || 0) - (b.weight || 0));
  let importedMatches = 0;
  const insertedMatchIds = [];

  for (const m of sortedMatches) {
    const p1 = playerMap.get(m.p1);
    const p2 = playerMap.get(m.p2);
    if (!p1 || !p2) continue;

    const winnerId = m.winner === m.p1 ? p1.id : p2.id;
    // Use a deterministic match key: tournament_id + round + section + p1 + p2
    const matchKey = `liq_${tournament.id}_${m.round}_${m.section}_${m.p1}_${m.p2}`.substring(0, 191);

    const { rows: [inserted] } = await db.query(
      `INSERT INTO matches
         (tournament_id, challonge_match_id, player1_id, player2_id, winner_id,
          player1_score, player2_score, round, bracket_section, state, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'complete',$10)
       ON CONFLICT (tournament_id, challonge_match_id) DO NOTHING
       RETURNING id`,
      [tournament.id, matchKey, p1.id, p2.id, winnerId,
       m.p1Score, m.p2Score, m.round, m.section === 'W' ? 'winners' : 'losers',
       completedAt]
    );
    if (inserted) { insertedMatchIds.push(inserted.id); importedMatches++; }
  }

  // ── ELO computation ────────────────────────────────────────────────────────
  if (insertedMatchIds.length > 0) {
    const eloMap   = new Map();
    const gamesMap = new Map();
    for (const [, p] of playerMap) {
      eloMap.set(p.id,   p.elo_rating   || 1200);
      gamesMap.set(p.id, p.games_played || 0);
    }

    for (const m of sortedMatches) {
      const p1 = playerMap.get(m.p1);
      const p2 = playerMap.get(m.p2);
      if (!p1 || !p2) continue;

      const pAData = { elo: eloMap.get(p1.id) || 1200, games_played: gamesMap.get(p1.id) || 0 };
      const pBData = { elo: eloMap.get(p2.id) || 1200, games_played: gamesMap.get(p2.id) || 0 };
      const result = m.winner === m.p1 ? 1 : 0;
      const { playerA, playerB } = calculateNewRatings(pAData, pBData, result);

      eloMap.set(p1.id, playerA.newElo);
      eloMap.set(p2.id, playerB.newElo);
      gamesMap.set(p1.id, (gamesMap.get(p1.id) || 0) + 1);
      gamesMap.set(p2.id, (gamesMap.get(p2.id) || 0) + 1);
    }

    // Derive placements for placement bonuses (same weight-based algorithm as Tonamel)
    const playerRecord = new Map();
    for (const m of matches) {
      const update = (name, isWin) => {
        const cur = playerRecord.get(name);
        if (!cur || m.weight > cur.weight || (m.weight === cur.weight && isWin))
          playerRecord.set(name, { weight: m.weight, isWin });
      };
      update(m.winner, true);
      update(m.loser,  false);
    }
    const sorted = [...playerRecord.entries()].sort((a, b) => {
      if (a[1].isWin !== b[1].isWin) return a[1].isWin ? -1 : 1;
      return b[1].weight - a[1].weight;
    });
    let rank = 1, i = 0;
    const placements = new Map(); // display name → rank
    while (i < sorted.length) {
      const { weight: w, isWin } = sorted[i][1];
      let j = i;
      while (j < sorted.length && sorted[j][1].weight === w && sorted[j][1].isWin === isWin) j++;
      for (let k = i; k < j; k++) placements.set(sorted[k][0], rank);
      rank += (j - i); i = j;
    }

    // Apply placement bonuses
    for (const [name, rank] of placements) {
      const player = playerMap.get(name);
      if (!player) continue;
      const bonus = placementBonus(rank, totalParticipants);
      if (bonus > 0 && eloMap.has(player.id))
        eloMap.set(player.id, eloMap.get(player.id) + bonus);
    }

    // Persist ELO
    for (const [playerId, newElo] of eloMap) {
      const { rows: [cur] } = await db.query('SELECT elo_rating FROM players WHERE id = $1', [playerId]);
      const oldElo = cur?.elo_rating || 1200;
      await db.query(
        `UPDATE players SET elo_rating = $2, peak_elo = GREATEST(peak_elo, $2) WHERE id = $1`,
        [playerId, newElo]
      );
      if (newElo !== oldElo) {
        await db.query(
          `INSERT INTO elo_history (player_id, old_elo, new_elo, delta, reason) VALUES ($1,$2,$3,$4,$5)`,
          [playerId, oldElo, newElo, newElo - oldElo, `Tournament: ${tournament.name}`]
        );
      }
    }

    // ── Tournament placements & career points ────────────────────────────────
    for (const [name, rank] of placements) {
      const player = playerMap.get(name);
      if (!player) continue;
      const pts = careerPoints(rank, totalParticipants);
      await db.query(
        `INSERT INTO tournament_placements (tournament_id, player_id, final_rank, career_points)
         ON CONFLICT (tournament_id, player_id) DO UPDATE SET final_rank=$3, career_points=$4`,
        [tournament.id, player.id, rank, pts]
      );
    }

    // ── Update offline player stats ──────────────────────────────────────────
    for (const [, player] of playerMap) {
      const { rows: [stats] } = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE tp.final_rank = 1)  AS wins,
           COUNT(*) FILTER (WHERE tp.final_rank <= 2) AS top2
         FROM tournament_placements tp
         JOIN tournaments t ON tp.tournament_id = t.id
         WHERE tp.player_id = $1 AND t.is_offline = TRUE`,
        [player.id]
      );
      await db.query(
        `UPDATE players SET offline_wins = $2, offline_top2 = $3 WHERE id = $1`,
        [player.id, parseInt(stats.wins), parseInt(stats.top2)]
      );

      // Also run full stat update so games_played, win streaks, etc. are accurate
      await updatePlayerStats(player.id, tournament, playerMap, matches, null, totalParticipants);
    }
  }

  return {
    success: true,
    tournament: tournament.name,
    liquipedia_url: liquipediaUrl,
    participants: totalParticipants,
    matches_imported: importedMatches,
  };
}

// POST /api/tournaments/import-liquipedia-bracket
// Body: { bracketUrl, name, date, location, prize_pool, participants_count, matches: [...] }
router.post('/import-liquipedia-bracket', async (req, res) => {
  try {
    const result = await importOneLiquipediaBracket(req.body);
    res.json(result);
  } catch (err) {
    console.error('Liquipedia bracket import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.importOne                    = importOne;
module.exports.importOneStartgg             = importOneStartgg;
module.exports.importOneTonamel             = importOneTonamel;
module.exports.importOneOffline             = importOneOffline;
module.exports.importOneLiquipediaBracket   = importOneLiquipediaBracket;
