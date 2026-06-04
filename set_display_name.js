#!/usr/bin/env node
/**
 * set_display_name.js — Update a player's display_name (and lock it against
 * import-time clobbering) by challonge_username.
 *
 * Background: the importers in backend/src/routes/tournaments.js used to
 * overwrite display_name unconditionally on ON CONFLICT DO UPDATE, so any
 * tournament where a participant's bracket name differed from what we had
 * on file would silently rename our row. After
 * `add_display_name_locked.sql`, the importers honor a per-row
 * `display_name_locked BOOLEAN`. This script renames the row AND sets that
 * flag, so the rename sticks across future imports.
 *
 * Usage (from neos-city directory):
 *   node set_display_name.js <challonge_username> "<new display name>"
 *   node set_display_name.js <challonge_username> "<new display name>" --no-lock
 *   node set_display_name.js <challonge_username> --unlock
 *
 * Examples:
 *   node set_display_name.js aldrakefgc Aldrake         # rename + lock
 *   node set_display_name.js aldrakefgc Aldrake --no-lock  # rename without lock
 *   node set_display_name.js aldrakefgc --unlock        # release the lock only
 *
 * Idempotent — re-running with the same name (and same lock state) is a no-op.
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');

// CLI: first positional is the handle. If the second positional is the
// sentinel `--unlock`, we only release the lock. Otherwise it's the new
// display name, and `--no-lock` (anywhere after) suppresses auto-locking.
const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith('-'));
const flags = new Set(argv.filter(a => a.startsWith('-')));

const username = positional[0];
const unlockOnly = flags.has('--unlock');
const newName = unlockOnly ? null : positional[1];
const suppressLock = flags.has('--no-lock');

if (!username || (!unlockOnly && !newName)) {
  console.error('Usage:');
  console.error('  node set_display_name.js <challonge_username> "<new display name>" [--no-lock]');
  console.error('  node set_display_name.js <challonge_username> --unlock');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    'SELECT id, display_name, display_name_locked FROM players WHERE challonge_username = $1',
    [username]
  );
  if (rows.length === 0) {
    console.error(`Player not found: @${username}`);
    await pool.end();
    process.exit(1);
  }
  const old = rows[0];

  if (unlockOnly) {
    if (!old.display_name_locked) {
      console.log(`No change: @${username} (id=${old.id}) is already unlocked.`);
      await pool.end();
      return;
    }
    await pool.query(
      'UPDATE players SET display_name_locked = FALSE WHERE challonge_username = $1',
      [username]
    );
    console.log(`@${username} (id=${old.id}): unlocked. Importers may now overwrite "${old.display_name}".`);
    await pool.end();
    return;
  }

  const nameChanging = old.display_name !== newName;
  const lockChanging = !suppressLock && !old.display_name_locked;

  if (!nameChanging && !lockChanging) {
    const lockState = old.display_name_locked ? ' (already locked)' : '';
    console.log(`No change: @${username} (id=${old.id}) already displays as "${newName}"${lockState}.`);
    await pool.end();
    return;
  }

  // One UPDATE handles both fields. CASE clauses leave the un-changed
  // field at its current value if only one is changing.
  await pool.query(
    `UPDATE players
       SET display_name        = $1,
           display_name_locked = CASE WHEN $3::boolean THEN players.display_name_locked ELSE TRUE END
     WHERE challonge_username  = $2`,
    [newName, username, suppressLock]
  );

  const parts = [];
  if (nameChanging) parts.push(`"${old.display_name}" → "${newName}"`);
  if (lockChanging) parts.push('locked');
  if (!nameChanging && suppressLock && old.display_name_locked) {
    parts.push('(left locked)');
  }
  console.log(`@${username} (id=${old.id}): ${parts.join(', ')}`);
  await pool.end();
})().catch(e => {
  console.error('set_display_name failed:', e.message);
  process.exit(1);
});
