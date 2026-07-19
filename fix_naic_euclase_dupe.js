#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — Undo the NAIC-2022 duplicate created for "MACS | Euclase"
// Run from the neos-city directory:
//   node fix_naic_euclase_dupe.js            (dry-run — prints, writes nothing)
//   node fix_naic_euclase_dupe.js --apply    (performs the cleanup)
//
// WHY: the NAIC standings backfill (tournament id 568) couldn't match the
// Challonge standings row "MACS | Euclase" (rank 7, team-prefixed name) to the
// existing Liquipedia-imported player, so it created a fresh player + a second
// rank-7 placement row. merge_players.js can't repair this — its same-event
// guard skips any pair that placed in the same tournament, which these two
// now do. This script instead:
//   1. deletes the duplicate rank-7 placement row (the new player's),
//   2. deletes the new player row (only if it owns nothing else — no matches,
//      no other placements, no ELO history, no achievements),
//   3. writes player_aliases rows (new player's username key + lowercased
//      display name → canonical username) so every future import of
//      "MACS | Euclase" resolves to the canonical player.
// The canonical player is self-derived: the OTHER rank-7 placement on 568.
//
// After --apply, run `node recalculate_elo.js` (the recalc that already ran
// counted the phantom player's attendance).
// ===========================================================================

require('dotenv').config({ path: './backend/.env' });

const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const TOURNAMENT_ID = 568;                 // NAIC 2022
const DUPE_DISPLAY_NAME = 'MACS | Euclase';
const DUPE_RANK = 7;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set in backend/.env');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // The two rank-7 rows: the dupe (by display name) and the canonical.
    const { rows: rank7 } = await client.query(
      `SELECT tp.player_id, tp.final_rank, p.display_name, p.challonge_username
         FROM tournament_placements tp JOIN players p ON p.id = tp.player_id
        WHERE tp.tournament_id = $1 AND tp.final_rank = $2
        ORDER BY tp.player_id`, [TOURNAMENT_ID, DUPE_RANK]);

    const dupe = rank7.find(r => r.display_name === DUPE_DISPLAY_NAME);
    const canonical = rank7.find(r => r.display_name !== DUPE_DISPLAY_NAME);
    if (!dupe) {
      console.log(`No rank-${DUPE_RANK} placement for "${DUPE_DISPLAY_NAME}" on tournament ${TOURNAMENT_ID} — nothing to fix.`);
      console.log('Rank-7 rows found:', rank7);
      return;
    }
    if (!canonical) {
      console.error(`❌ Only the dupe holds rank ${DUPE_RANK} — expected the canonical player to hold it too. Aborting; investigate manually.`);
      console.error('Rank-7 rows found:', rank7);
      process.exit(1);
    }

    // Safety: the dupe player must own nothing beyond this one placement row.
    const owns = async (sql) => (await client.query(sql, [dupe.player_id])).rows[0].n;
    const nMatches = await owns(`SELECT COUNT(*)::int AS n FROM matches WHERE player1_id = $1 OR player2_id = $1`);
    const nPlacements = await owns(`SELECT COUNT(*)::int AS n FROM tournament_placements WHERE player_id = $1`);
    const nElo = await owns(`SELECT COUNT(*)::int AS n FROM elo_history WHERE player_id = $1`);
    const nAch = await owns(`SELECT COUNT(*)::int AS n FROM player_achievements WHERE player_id = $1`);

    console.log(`Dupe:      player ${dupe.player_id} "${dupe.display_name}" (username "${dupe.challonge_username}")`);
    console.log(`           owns: ${nMatches} matches, ${nPlacements} placement(s), ${nElo} elo_history, ${nAch} achievements`);
    console.log(`Canonical: player ${canonical.player_id} "${canonical.display_name}" (username "${canonical.challonge_username}")`);

    if (nMatches > 0 || nPlacements !== 1 || nAch > 0) {
      console.error(`\n❌ Dupe player owns more than the one backfill placement — this script only handles the clean undo case.`);
      console.error('   Investigate manually (or extend the script) before deleting anything.');
      process.exit(1);
    }

    const aliases = [...new Set([
      String(dupe.challonge_username),
      DUPE_DISPLAY_NAME.toLowerCase(),
    ])].filter(a => a !== canonical.challonge_username);

    console.log(`\nPlan:`);
    console.log(`  1. DELETE placement (tournament ${TOURNAMENT_ID}, player ${dupe.player_id}, rank ${DUPE_RANK})`);
    console.log(`  2. DELETE elo_history rows for player ${dupe.player_id} (${nElo})`);
    console.log(`  3. DELETE player ${dupe.player_id}`);
    console.log(`  4. Alias ${aliases.map(a => JSON.stringify(a)).join(', ')} → "${canonical.challonge_username}"`);

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to perform the cleanup.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `DELETE FROM tournament_placements WHERE tournament_id = $1 AND player_id = $2`,
      [TOURNAMENT_ID, dupe.player_id]);
    await client.query(`DELETE FROM elo_history WHERE player_id = $1`, [dupe.player_id]);
    await client.query(`DELETE FROM players WHERE id = $1`, [dupe.player_id]);
    for (const alias of aliases) {
      await client.query(
        `INSERT INTO player_aliases (alias_username, canonical_username)
         VALUES ($1, $2)
         ON CONFLICT (alias_username) DO UPDATE SET canonical_username = EXCLUDED.canonical_username`,
        [alias, canonical.challonge_username]);
    }
    await client.query('COMMIT');
    console.log(`\n✅ Cleaned up. "${DUPE_DISPLAY_NAME}" now resolves to "${canonical.challonge_username}".`);
    console.log('Next: node recalculate_elo.js (the earlier recalc counted the phantom player).');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
