/**
 * merge_players.js — Merge two player records into one.
 *
 * Reassigns all matches, placements, ELO history, achievements, and
 * defeated-opponent records from the OLD player to the CANONICAL player,
 * deletes the old player record, AND writes a row to player_aliases so
 * future tournament imports of the dead handle route directly to the
 * canonical row instead of creating a fresh fallback.
 *
 * Closes the re-emergence loop: start.gg / offline imports that
 * slugify a participant's display_name into a `challonge_username` key
 * matching a previously-merged handle now hit `resolveAlias()` in
 * tournaments.js and land on the canonical row, leaving no breadcrumb
 * to re-merge later. Existing aliases that pointed AT the dead handle
 * are also forwarded to the new canonical, so chained merges stay
 * consistent.
 *
 * After running, run `node recalculate_elo.js` to rebuild all stats.
 *
 * Usage (from neos-city directory):
 *   node merge_players.js <old_username> <canonical_username>
 *
 * Example:
 *   node merge_players.js thankswalot jukem
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');

// Defensive — link_offline_player.js also creates this table; the merge
// script doesn't want to crash if it's run before that has happened.
async function ensureAliasTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS player_aliases (
      id                 SERIAL PRIMARY KEY,
      alias_username     TEXT UNIQUE NOT NULL,
      canonical_username TEXT NOT NULL,
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_player_aliases_alias ON player_aliases (alias_username)
  `);
}

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
    await ensureAliasTable(client);

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

    // 6. Merge defeated opponents tracking.
    // PK = (player_id, achievement_id, opponent_id). Both columns can collide
    // during the merge, so dedup on the full conflict key before each UPDATE
    // and clean self-rows after. (Earlier versions of this block keyed only
    // on opponent_id, which both over-deleted on the first step and missed
    // collisions on the second — triggering PK violations on opponent_id
    // rewrite. See link_offline_player.js for the parallel logic.)
    await client.query(`
      DELETE FROM achievement_defeated_opponents
      WHERE player_id = $1
        AND (achievement_id, opponent_id) IN (
          SELECT achievement_id, opponent_id
          FROM achievement_defeated_opponents WHERE player_id = $2
        )
    `, [oldId, canonId]);
    await client.query(`UPDATE achievement_defeated_opponents SET player_id  = $1 WHERE player_id  = $2`, [canonId, oldId]);
    await client.query(`
      DELETE FROM achievement_defeated_opponents
      WHERE opponent_id = $1
        AND (player_id, achievement_id) IN (
          SELECT player_id, achievement_id
          FROM achievement_defeated_opponents WHERE opponent_id = $2
        )
    `, [oldId, canonId]);
    await client.query(`UPDATE achievement_defeated_opponents SET opponent_id = $1 WHERE opponent_id = $2`, [canonId, oldId]);
    await client.query(
      `DELETE FROM achievement_defeated_opponents WHERE player_id = $1 AND opponent_id = $1`,
      [canonId]
    );

    // 6b. Re-point any account claim from the old player to the canonical one.
    // Without this, ON DELETE SET NULL on users.player_id would silently orphan
    // a user's claim when their player gets merged away. Guarded with to_regclass
    // so this still works on DBs predating the users table.
    const { rows: [reg] } = await client.query(`SELECT to_regclass('public.users') AS t`);
    if (reg.t) {
      // Re-point loser → canonical, but only if the canonical player isn't
      // already claimed (the one-user-per-player unique index forbids two).
      const repointed = await client.query(
        `UPDATE users SET player_id = $1, updated_at = NOW()
         WHERE player_id = $2
           AND NOT EXISTS (SELECT 1 FROM users WHERE player_id = $1)`,
        [canonId, oldId]
      );
      // Edge case — both duplicates were claimed: release whoever still points
      // at the loser rather than violate the unique index. Warn so it's visible.
      const released = await client.query(
        `UPDATE users SET player_id = NULL, updated_at = NOW() WHERE player_id = $1`,
        [oldId]
      );
      if (repointed.rowCount) console.log(`  users: re-pointed ${repointed.rowCount} account claim(s) to canonical`);
      if (released.rowCount) console.warn(`  users: released ${released.rowCount} claim(s) — canonical player was already claimed`);
    }

    // 7. Delete old player record
    await client.query(`DELETE FROM players WHERE id = $1`, [oldId]);
    console.log(`  Deleted old player record (id=${oldId})`);

    // 8. Write player_aliases so future imports route the dead handle to the
    //    canonical row instead of recreating a fallback. Two steps:
    //    a. Any existing aliases that pointed AT oldUsername (because some
    //       earlier merge made it canonical) get re-pointed to canonUsername.
    //    b. oldUsername itself becomes an alias for canonUsername. ON CONFLICT
    //       handles the case where an older alias row already exists for it.
    //
    //    The alias key is oldRows[0].challonge_username verbatim (no
    //    normalization). resolveAlias() in tournaments.js does an exact map
    //    lookup keyed on the lowercased participant slug, which is exactly
    //    what's stored in players.challonge_username — normalizing here would
    //    silently miss handles with spaces (e.g. "neo sinanju" from start.gg).
    const oldKey = oldRows[0].challonge_username;
    const canonKey = canonRows[0].challonge_username;
    const r7 = await client.query(
      `UPDATE player_aliases SET canonical_username = $1 WHERE canonical_username = $2`,
      [canonKey, oldKey]
    );
    if (r7.rowCount > 0) {
      console.log(`  player_aliases: re-routed ${r7.rowCount} existing alias(es) "${oldKey}" → "${canonKey}"`);
    }
    await client.query(
      `INSERT INTO player_aliases (alias_username, canonical_username)
       VALUES ($1, $2)
       ON CONFLICT (alias_username) DO UPDATE SET canonical_username = EXCLUDED.canonical_username`,
      [oldKey, canonKey]
    );
    console.log(`  player_aliases: ${oldKey} → ${canonKey}`);

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
