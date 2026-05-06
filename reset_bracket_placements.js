#!/usr/bin/env node
/**
 * reset_bracket_placements.js — Wipe distorted bracket-derived placements
 * before re-importing with the fixed algorithm.
 *
 * Background: until 2026-05-02, importOneLiquipediaBracket() in
 * backend/src/routes/tournaments.js (a) had a SQL bug that prevented
 * placement writes from landing AND (b) used a "highest-weight match,
 * prefer wins on ties" placement algorithm that interacted badly with
 * the per-column weight scheme of the Liquipedia parser. Brackets that
 * DID land in the DB before the SQL bug was introduced have distorted
 * ranks (multiple players tied at rank 1, 2, 3, ... from same-column
 * winner promotion).
 *
 * Update 2026-05-04: this script used to preserve rank ≤ 2 on the
 * assumption that offline_import.js had written the canonical
 * winner/runner-up. That assumption broke down: the buggy bracket
 * parser wrote ITS OWN rank-1/rank-2 rows for different player_ids on
 * the same tournament, and the (tournament_id, player_id) upsert never
 * removed them — so post-reset tournaments still surfaced two players
 * at 1st and two at 2nd (e.g. Frosty Faustings XVIII showing both
 * Jukem AND Twixxie at rank 1). We now wipe EVERY placement on the
 * candidate tournaments and rely on the post-reset workflow to rebuild
 * them cleanly.
 *
 * Workflow (run in this order):
 *   1. node reset_bracket_placements.js          ← this script (wipes all)
 *   2. node offline_import.js                    ← restores rank-1/2 for
 *                                                   every offline event from
 *                                                   the canonical winner /
 *                                                   runner-up list
 *   3. Re-paste liquipedia_import_console.js     ← repopulates full
 *      from a liquipedia.net DevTools console      bracket-derived
 *      with FORCE_REIMPORT = true                  placements (ranks 3-N
 *                                                   plus authoritative
 *                                                   ranks 1-2 for events
 *                                                   that have a bracket).
 *
 * importOneLiquipediaBracket itself now DELETEs all placements for the
 * tournament before re-inserting, so step 3 is self-cleaning even if
 * step 1 is skipped on subsequent runs. importOneLiquipediaBracket also
 * calls refreshOfflineStats() per affected player, so per-tier offline
 * counts and the offline_score column rebuild automatically.
 *
 * Usage:
 *   node reset_bracket_placements.js              # interactive
 *   node reset_bracket_placements.js --list       # show, do nothing
 *   node reset_bracket_placements.js --yes        # skip confirm
 *   node reset_bracket_placements.js --tournament 554     # one specific tournament_id
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');
const readline = require('readline');

const args = process.argv.slice(2);
const skipConfirm = args.includes('--yes') || args.includes('-y');
const listOnly = args.includes('--list');
let oneTournamentId = null;
{
  const i = args.findIndex(a => a === '--tournament' || a === '-t');
  if (i !== -1 && args[i + 1] != null) oneTournamentId = parseInt(args[i + 1], 10);
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, ans => resolve(ans.trim())));
}

async function refreshOfflineStatsFor(client, playerId) {
  const OFFLINE_TIERS = ['worlds', 'major', 'regional', 'other'];
  const OFFLINE_WEIGHTS = {
    worlds:   { wins: 100, runner_up: 60, top4: 35, top8: 20 },
    major:    { wins: 50,  runner_up: 30, top4: 18, top8: 10 },
    regional: { wins: 25,  runner_up: 15, top4: 9,  top8: 5 },
    other:    { wins: 10,  runner_up: 6,  top4: 3,  top8: 2 },
  };
  const { rows: [s] } = await client.query(`
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

  let score = 0;
  for (const tier of OFFLINE_TIERS) {
    const w = OFFLINE_WEIGHTS[tier];
    const wins = parseInt(s[`${tier}_wins`]) || 0;
    const ru   = parseInt(s[`${tier}_runner_up`]) || 0;
    const top4 = parseInt(s[`${tier}_top4`]) || 0;
    const top8 = parseInt(s[`${tier}_top8`]) || 0;
    const pure_top4 = Math.max(0, top4 - wins - ru);
    const pure_top8 = Math.max(0, top8 - top4);
    score += wins * w.wins + ru * w.runner_up + pure_top4 * w.top4 + pure_top8 * w.top8;
  }

  await client.query(`
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

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let inTx = false;
  let rl = null;

  try {
    // Find candidate tournaments
    const candidateSql = oneTournamentId
      ? `SELECT t.id, t.name, t.liquipedia_url, t.completed_at,
                COUNT(tp.id)::int AS placements
         FROM tournaments t
         LEFT JOIN tournament_placements tp ON tp.tournament_id = t.id
         WHERE t.id = $1
         GROUP BY t.id`
      : `SELECT t.id, t.name, t.liquipedia_url, t.completed_at,
                COUNT(tp.id)::int AS placements
         FROM tournaments t
         LEFT JOIN tournament_placements tp ON tp.tournament_id = t.id
         WHERE t.is_offline = TRUE
           AND t.liquipedia_url IS NOT NULL
         GROUP BY t.id
         HAVING COUNT(tp.id) > 2
         ORDER BY t.completed_at DESC NULLS LAST`;

    const { rows } = await client.query(candidateSql, oneTournamentId ? [oneTournamentId] : []);

    if (rows.length === 0) {
      console.log(oneTournamentId
        ? `No tournament with id=${oneTournamentId} found.`
        : 'No bracket-imported tournaments with > 2 placements found. Nothing to clean.');
      return;
    }

    console.log(`\nFound ${rows.length} tournament${rows.length === 1 ? '' : 's'} with bracket-derived placements:`);
    console.log('');
    for (const r of rows) {
      const date = r.completed_at ? new Date(r.completed_at).toISOString().slice(0, 10) : '----------';
      console.log(`  id=${String(r.id).padStart(4)}  ${date}  placements=${String(r.placements).padStart(3)}  ${r.name}`);
    }

    if (listOnly) {
      console.log('\n(--list only — no changes will be made.)');
      return;
    }

    console.log('\nFor each tournament above, this will:');
    console.log('  • DELETE FROM tournament_placements WHERE tournament_id = ?  (all ranks)');
    console.log('  • Refresh offline tier counts and offline_score for every affected player.');
    console.log('');
    console.log('All ranks are wiped, including rank 1 and 2. After this script:');
    console.log('  1. node offline_import.js   ← restores canonical winner/runner-up');
    console.log('  2. Paste liquipedia_import_console.js (FORCE_REIMPORT = true) on');
    console.log('     liquipedia.net DevTools to rebuild full bracket placements.');

    if (!skipConfirm) {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await prompt(rl, '\nProceed? [y/N] ');
      rl.close();
      rl = null;
      if (!/^y/i.test(ans)) {
        console.log('Aborted.');
        return;
      }
    }

    await client.query('BEGIN');
    inTx = true;

    // Collect affected players BEFORE deleting (so we can refresh their stats)
    const affectedPlayers = new Set();
    const tournamentIds = rows.map(r => r.id);
    const { rows: playerRows } = await client.query(
      `SELECT DISTINCT player_id
       FROM tournament_placements
       WHERE tournament_id = ANY($1)`,
      [tournamentIds]
    );
    for (const p of playerRows) affectedPlayers.add(p.player_id);

    // Delete every placement on these tournaments (rank 1 and 2 included —
    // see the header comment for why preserving them was a footgun).
    const del = await client.query(
      `DELETE FROM tournament_placements
       WHERE tournament_id = ANY($1)`,
      [tournamentIds]
    );
    console.log(`\n  Deleted ${del.rowCount} placement row${del.rowCount === 1 ? '' : 's'}.`);

    // Refresh per-tier offline stats for every affected player
    let refreshed = 0;
    for (const pid of affectedPlayers) {
      await refreshOfflineStatsFor(client, pid);
      refreshed++;
    }
    console.log(`  Refreshed offline stats for ${refreshed} player${refreshed === 1 ? '' : 's'}.`);

    await client.query('COMMIT');
    inTx = false;
    console.log('\n✅  Cleanup complete. Next steps:');
    console.log('   1. node offline_import.js   ← restores canonical winner/runner-up');
    console.log('   2. Paste liquipedia_import_console.js (FORCE_REIMPORT = true) on');
    console.log('      liquipedia.net DevTools to rebuild full bracket placements.');
  } catch (err) {
    if (inTx) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    }
    console.error('\n❌  Cleanup failed, transaction rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    if (rl) { try { rl.close(); } catch { /* ignore */ } }
    client.release();
    await pool.end();
  }
}

run();
