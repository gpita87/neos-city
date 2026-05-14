#!/usr/bin/env node
/**
 * set_display_name.js — Update a player's display_name by challonge_username.
 *
 * After merging two players you sometimes want the surviving row's
 * display_name to differ from what the merge left in place (e.g. you
 * merged into the longer "fgc"-suffixed handle but want the in-app
 * display to show the cleaner name). merge_players.js doesn't expose
 * a --display-name flag, so use this.
 *
 * Read-only on rows that don't match; idempotent if the value already
 * equals the requested name.
 *
 * Usage (from neos-city directory):
 *   node set_display_name.js <challonge_username> "<new display name>"
 *
 * Example:
 *   node set_display_name.js aldrakefgc Aldrake
 *   node set_display_name.js utahvgc Utah
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');

const username = process.argv[2];
const newName  = process.argv[3];

if (!username || !newName) {
  console.error('Usage: node set_display_name.js <challonge_username> "<new display name>"');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    'SELECT id, display_name FROM players WHERE challonge_username = $1',
    [username]
  );
  if (rows.length === 0) {
    console.error(`Player not found: @${username}`);
    await pool.end();
    process.exit(1);
  }
  const old = rows[0];
  if (old.display_name === newName) {
    console.log(`No change: @${username} (id=${old.id}) already displays as "${newName}".`);
    await pool.end();
    return;
  }
  await pool.query(
    'UPDATE players SET display_name = $1 WHERE challonge_username = $2',
    [newName, username]
  );
  console.log(`@${username} (id=${old.id}): "${old.display_name}" → "${newName}"`);
  await pool.end();
})().catch(e => {
  console.error('set_display_name failed:', e.message);
  process.exit(1);
});
