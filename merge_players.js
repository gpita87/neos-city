/**
 * merge_players.js — Merge two player records into one.
 *
 * Reassigns all matches, placements, ELO history, achievements, and
 * defeated-opponent records from the OLD player to the CANONICAL player,
 * then deletes the old player record.
 *
 * After running this, run `node recalculate_elo.js` to rebuild all stats.
 *
 * Usage (from neos-city directory):
 *   node merge_players.js <old_username> <canonical_username>
 *
 * Example:
 *   node merge_players.js thankswalot jukem
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');

const oldUsername = process.argv[2];
const canonUsername = process.argv[3];

if (!oldUsername || !canonUsername) {
  console.error('Usage: node merge_players.js <old_username> <canonical_username>');
  console.error('Example: node merge_players.js thankswalot jukem');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function merge() {
  const client = await pool.connect();
  try {
    // Look up both players
    const { rows: oldRows } = await client.query(
      `SELECT id, challonge_username, display_name FROM players WHERE challonge_username = $1`,
      [oldUsername.toLowerCase()]
    );
    const { rows: canonRows } = await client.query(
      `SELECT id, challonge_username, display_name FROM players WHERE challonge_username = $1`,
      [canonUsername.toLowerCase()]
    );

    if (oldRows.length === 0) {
      console.error(`Player not found: "${oldUsername}"`);
      process.exit(1);
    }
    if (canonRows.length === 0) {
      console.error(`Player not found: "${canonUsername}"`);
      process.exit(1);
    }

    const oldId = oldRows[0].id;
    const canonId = canonRows[0].id;

    console.log(`Merging: "${oldRows[0].display_name}" (id=${oldId}) → "${canonRows[0].display_name}" (id=${canonId})`);

    await client.query('BEGIN');

    // 1. Reassign matches
    const r1 = await client.query(`UPDATE matches SET player1_id = $1 WHERE player1_id = $2`, [canonId, oldId]);
    const r2 = await client.query(`UPDATE matches SET player2_id = $1 WHERE player2_id = $2`, [canonId, oldId]);
    const r3 = await client.query(`UPDATE matches SET winner_id  = $1 WHERE winner_id  = $2`, [canonId, oldId]);
    console.log(`  matches: player1=${r1.rowCount}, player2=${r2.rowCount}, winner=${r3.rowCount} rows updated`);

    // 2. Reassign live_matches (if any)
    await client.query(`UPDATE live_matches SET player1_id = $1 WHERE player1_id = $2`, [canonId, oldId]);
    await client.query(`UPDATE live_matches SET player2_id = $1 WHERE player2_id = $2`, [canonId, oldId]);
    await client.query(`UPDATE live_matches SET winner_id  = $1 WHERE winner_id  = $2`, [canonId, oldId]);

    // 3. Reassign tournament_placements (handle potential duplicate tournament entries)
    //    If both players have a placement in the same tournament, keep the canonical one
    await client.query(`
      DELETE FROM tournament_placements
      WHERE player_id = $1
        AND tournament_id IN (SELECT tournament_id FROM tournament_placements WHERE player_id = $2)
    `, [oldId, canonId]);
    const r4 = await client.query(`UPDATE tournament_placements SET player_id = $1 WHERE player_id = $2`, [canonId, oldId]);
    console.log(`  tournament_placements: ${r4.rowCount} rows moved`);

    // 4. Reassign ELO history
    const r5 = await client.query(`UPDATE elo_history SET player_id = $1 WHERE player_id = $2`, [canonId, oldId]);
    console.log(`  elo_history: ${r5.rowCount} rows moved`);

    // 5. Merge achievements (skip duplicates, move unique ones)
    await client.query(`
      DELETE FROM player_achievements
      WHERE player_id = $1
        AND achievement_id IN (SELECT achievement_id FROM player_achievements WHERE player_id = $2)
    `, [oldId, canonId]);
    const r6 = await client.query(`UPDATE player_achievements SET player_id = $1 WHERE player_id = $2`, [canonId, oldId]);
    console.log(`  player_achievements: ${r6.rowCount} rows moved`);

    // 6. Merge defeated opponents tracking
    await client.query(`
      DELETE FROM achievement_defeated_opponents
      WHERE player_id = $1
        AND opponent_id IN (SELECT opponent_id FROM achievement_defeated_opponents WHERE player_id = $2)
    `, [oldId, canonId]);
    await client.query(`UPDATE achievement_defeated_opponents SET player_id = $1 WHERE player_id = $2`, [canonId, oldId]);
    await client.query(`UPDATE achievement_defeated_opponents SET opponent_id = $1 WHERE opponent_id = $2`, [canonId, oldId]);

    // 7. Delete old player record
    await client.query(`DELETE FROM players WHERE id = $1`, [oldId]);
    console.log(`  Deleted old player record (id=${oldId})`);

    await client.query('COMMIT');
    console.log('\nMerge complete! Now run: node recalculate_elo.js');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Merge failed, rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

merge();
