// Run: node db_audit.js
// Produces a full data inventory of all tables by source

require('dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  console.log('\n========================================');
  console.log('  NEOS CITY — DATABASE AUDIT');
  console.log('========================================\n');

  // 1. Tournaments by source
  const sources = await pool.query(`
    SELECT source, COUNT(*) as count,
      COUNT(CASE WHEN is_offline THEN 1 END) as offline,
      MIN(started_at)::date::text as earliest,
      MAX(started_at)::date::text as latest
    FROM tournaments GROUP BY source ORDER BY count DESC
  `);
  console.log('--- TOURNAMENTS BY SOURCE ---');
  console.table(sources.rows);

  // 2. Tournaments by series + source
  const series = await pool.query(`
    SELECT series, source, COUNT(*) as count
    FROM tournaments GROUP BY series, source ORDER BY series, source
  `);
  console.log('--- TOURNAMENTS BY SERIES & SOURCE ---');
  console.table(series.rows);

  // 3. Player overview
  const players = await pool.query(`
    SELECT COUNT(*) as total_players,
      COUNT(CASE WHEN games_played > 0 THEN 1 END) as with_matches,
      COUNT(CASE WHEN games_played = 0 THEN 1 END) as no_matches,
      COUNT(CASE WHEN elo_rating != 1200 THEN 1 END) as elo_changed,
      ROUND(AVG(games_played)::numeric, 1) as avg_games,
      MAX(games_played) as max_games,
      COUNT(CASE WHEN region IS NOT NULL THEN 1 END) as with_region
    FROM players
  `);
  console.log('--- PLAYER OVERVIEW ---');
  console.table(players.rows);

  // 4. Matches by source
  const matches = await pool.query(`
    SELECT t.source, COUNT(m.id) as match_count,
      COUNT(CASE WHEN m.player1_score IS NOT NULL AND m.player2_score IS NOT NULL THEN 1 END) as with_scores,
      COUNT(CASE WHEN m.winner_id IS NOT NULL THEN 1 END) as with_winner
    FROM matches m JOIN tournaments t ON m.tournament_id = t.id
    GROUP BY t.source ORDER BY match_count DESC
  `);
  console.log('--- MATCHES BY SOURCE ---');
  console.table(matches.rows);

  // 5. Placements by source
  const placements = await pool.query(`
    SELECT t.source, COUNT(tp.id) as placement_count,
      COUNT(CASE WHEN tp.final_rank IS NOT NULL THEN 1 END) as with_rank
    FROM tournament_placements tp JOIN tournaments t ON tp.tournament_id = t.id
    GROUP BY t.source ORDER BY placement_count DESC
  `);
  console.log('--- PLACEMENTS BY SOURCE ---');
  console.table(placements.rows);

  // 6. Data gaps: tournaments with zero matches
  const noMatches = await pool.query(`
    SELECT t.source, COUNT(*) as tournaments_without_matches
    FROM tournaments t
    WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.tournament_id = t.id)
    GROUP BY t.source ORDER BY tournaments_without_matches DESC
  `);
  console.log('--- TOURNAMENTS WITH ZERO MATCHES (gap!) ---');
  console.table(noMatches.rows);

  // 7. Data gaps: tournaments with zero placements
  const noPlacements = await pool.query(`
    SELECT t.source, COUNT(*) as tournaments_without_placements
    FROM tournaments t
    WHERE NOT EXISTS (SELECT 1 FROM tournament_placements tp WHERE tp.tournament_id = t.id)
    GROUP BY t.source ORDER BY tournaments_without_placements DESC
  `);
  console.log('--- TOURNAMENTS WITH ZERO PLACEMENTS (gap!) ---');
  console.table(noPlacements.rows);

  // 8. List of gap tournaments (no matches)
  const gapList = await pool.query(`
    SELECT t.name, t.source, t.series, t.started_at::date::text as date, t.participants_count,
      (SELECT COUNT(*) FROM tournament_placements tp WHERE tp.tournament_id = t.id) as placements
    FROM tournaments t
    WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.tournament_id = t.id)
    ORDER BY t.source, t.started_at DESC
  `);
  console.log('--- ALL TOURNAMENTS MISSING MATCH DATA ---');
  console.table(gapList.rows);

  // 9. Offline tournaments detail
  const offline = await pool.query(`
    SELECT t.name, t.source, t.participants_count, t.started_at::date::text as date,
      t.location, t.prize_pool,
      (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) as matches,
      (SELECT COUNT(*) FROM tournament_placements tp WHERE tp.tournament_id = t.id) as placements
    FROM tournaments t WHERE t.is_offline = true
    ORDER BY t.started_at DESC
  `);
  console.log('--- ALL OFFLINE TOURNAMENTS ---');
  console.table(offline.rows);

  // 10. start.gg tournaments detail
  const startgg = await pool.query(`
    SELECT t.name, t.started_at::date::text as date, t.participants_count, t.series,
      (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) as matches,
      (SELECT COUNT(*) FROM tournament_placements tp WHERE tp.tournament_id = t.id) as placements
    FROM tournaments t WHERE t.source = 'startgg'
    ORDER BY t.started_at DESC
  `);
  console.log('--- ALL START.GG TOURNAMENTS ---');
  console.table(startgg.rows);

  // 11. ELO & achievements summary
  const elo = await pool.query('SELECT COUNT(*) as records FROM elo_history');
  const achiev = await pool.query(`
    SELECT (SELECT COUNT(*) FROM achievements) as defined,
           (SELECT COUNT(*) FROM player_achievements) as unlocked,
           (SELECT COUNT(DISTINCT player_id) FROM player_achievements) as players_with
  `);
  console.log('--- ELO HISTORY: ' + elo.rows[0].records + ' records ---');
  console.log('--- ACHIEVEMENTS: ' + achiev.rows[0].defined + ' defined, ' + achiev.rows[0].unlocked + ' unlocked by ' + achiev.rows[0].players_with + ' players ---');

  // 12. Organizers (slug_patterns may not exist if migration wasn't applied)
  try {
    const orgs = await pool.query(`SELECT challonge_username, display_name, challonge_subdomain, slug_patterns FROM organizers`);
    console.log('--- ORGANIZERS ---');
    console.table(orgs.rows);
  } catch (e) {
    const orgs = await pool.query(`SELECT challonge_username, display_name, challonge_subdomain FROM organizers`);
    console.log('--- ORGANIZERS (slug_patterns column missing — migration not applied) ---');
    console.table(orgs.rows);
  }

  // 13. Top players by ELO
  const topPlayers = await pool.query(`
    SELECT display_name, elo_rating, games_played, total_match_wins, total_match_losses,
      tournaments_entered, tournament_wins, region
    FROM players ORDER BY elo_rating DESC LIMIT 15
  `);
  console.log('--- TOP 15 PLAYERS BY ELO ---');
  console.table(topPlayers.rows);

  console.log('\n========================================');
  console.log('  AUDIT COMPLETE');
  console.log('========================================\n');

  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
