#!/usr/bin/env node
/**
 * diagnose_tournament.js — quick read-only inspection of an offline tournament
 *
 * Usage:
 *   node diagnose_tournament.js <tournament_id>
 *   node diagnose_tournament.js 554           # Frosty Faustings XVIII
 *
 * Prints: tournament metadata, placement count + rows, match count + a sample
 * of high-round matches. No writes; safe to run any time.
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');

const id = parseInt(process.argv[2], 10);
if (!id) {
  console.error('Usage: node diagnose_tournament.js <tournament_id>');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: [t] } = await pool.query(
      `SELECT id, name, is_offline, series, completed_at,
              participants_count, liquipedia_slug, liquipedia_url
       FROM tournaments WHERE id = $1`, [id]
    );
    if (!t) { console.log(`No tournament with id=${id}.`); return; }
    console.log('── tournament row ──');
    console.log(t);

    const { rows: ps } = await pool.query(
      `SELECT tp.final_rank, tp.career_points, p.display_name, p.id AS player_id
       FROM tournament_placements tp
       JOIN players p ON p.id = tp.player_id
       WHERE tp.tournament_id = $1
       ORDER BY tp.final_rank ASC NULLS LAST, p.display_name ASC`, [id]
    );
    console.log(`\n── placements (${ps.length}) ──`);
    for (const r of ps) {
      console.log(`  rank=${String(r.final_rank).padStart(3)}  pts=${String(r.career_points).padStart(2)}  ${r.display_name} (id=${r.player_id})`);
    }

    const { rows: [{ count: matchCount }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM matches WHERE tournament_id = $1`, [id]
    );
    console.log(`\n── match count: ${matchCount} ──`);

    const { rows: highMatches } = await pool.query(
      `SELECT m.round, m.bracket_section, m.challonge_match_id,
              p1.display_name AS p1, p2.display_name AS p2,
              w.display_name  AS winner,
              m.player1_score, m.player2_score
       FROM matches m
       JOIN players p1 ON p1.id = m.player1_id
       JOIN players p2 ON p2.id = m.player2_id
       JOIN players w  ON w.id  = m.winner_id
       WHERE m.tournament_id = $1
       ORDER BY m.round DESC NULLS LAST, m.id DESC
       LIMIT 12`, [id]
    );
    console.log('── last 12 matches (by round desc) ──');
    for (const m of highMatches) {
      console.log(`  r=${m.round}  ${m.bracket_section}  ${m.p1} ${m.player1_score ?? '-'}-${m.player2_score ?? '-'} ${m.p2}   winner=${m.winner}   key=${m.challonge_match_id}`);
    }
  } finally {
    await pool.end();
  }
})();
