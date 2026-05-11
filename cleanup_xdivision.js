/**
 * cleanup_xdivision.js
 *
 * Deletes the junk "X-Division Championship" tournament that was imported
 * during an admin-gate test (challonge_id = 'x' happened to match a real
 * non-Pokkén event). 44 entrants, 43 matches per the May-10 deploy notes.
 *
 *   node cleanup_xdivision.js          # dry run (default)
 *   node cleanup_xdivision.js --apply  # actually delete
 *
 * Cascade behavior (from backend/src/db/schema.sql + add_achievement_metadata.sql):
 *   tournaments.id deleted
 *     → tournament_placements (ON DELETE CASCADE)    — gone
 *     → matches               (ON DELETE CASCADE)    — gone
 *         → elo_history.match_id (ON DELETE CASCADE) — gone with matches
 *     → player_achievements.tournament_id  (ON DELETE SET NULL) — kept, nulled
 *     → achievement_defeated_opponents.match_id (ON DELETE SET NULL via matches) — kept, nulled
 *
 * Player rows for the 44 X-Division-only entrants are deliberately NOT
 * touched. They're orphan players with no other matches; harmless. If a
 * future task wants to prune orphan players, that's a separate script.
 *
 * After --apply, run `node recalculate_elo.js` to rebuild ELO/stats with
 * the X-Division matches gone. Any player_achievements with the now-nulled
 * tournament_id stay in place; recalc re-derives them.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const APPLY = process.argv.includes('--apply');
const pool  = new Pool({ connectionString: process.env.DATABASE_URL });

const CHALLONGE_ID = 'x';

async function snapshot(client, header) {
  const { rows: tournaments } = await client.query(`
    SELECT id, name, challonge_id, challonge_url, series,
           participants_count, imported_at::date AS imported_on
    FROM tournaments
    WHERE challonge_id = $1
  `, [CHALLONGE_ID]);

  console.log(`\n── ${header} ──`);
  if (tournaments.length === 0) {
    console.log('  (no tournament with challonge_id = "x" — already cleaned up?)');
    return [];
  }

  for (const t of tournaments) {
    const { rows: [counts] } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM matches               WHERE tournament_id = $1)::int AS matches,
        (SELECT COUNT(*) FROM tournament_placements WHERE tournament_id = $1)::int AS placements,
        (SELECT COUNT(*) FROM player_achievements   WHERE tournament_id = $1)::int AS achievements_pinned,
        (SELECT COUNT(*) FROM elo_history h
           JOIN matches m ON m.id = h.match_id
          WHERE m.tournament_id = $1)::int AS elo_history_rows,
        (SELECT COUNT(*) FROM achievement_defeated_opponents ado
           JOIN matches m ON m.id = ado.match_id
          WHERE m.tournament_id = $1)::int AS ado_pinned
    `, [t.id]);

    console.log(`  id=${t.id}  challonge_id="${t.challonge_id}"  series=${t.series}`);
    console.log(`    name="${t.name}"`);
    console.log(`    url=${t.challonge_url || '-'}`);
    console.log(`    imported_on=${t.imported_on}  participants_count=${t.participants_count}`);
    console.log(`    matches=${counts.matches}  placements=${counts.placements}`);
    console.log(`    elo_history rows (will cascade)=${counts.elo_history_rows}`);
    console.log(`    player_achievements with tournament_id=${t.id} (will SET NULL)=${counts.achievements_pinned}`);
    console.log(`    achievement_defeated_opponents.match_id pinned (will SET NULL)=${counts.ado_pinned}`);
  }
  return tournaments;
}

async function main() {
  console.log(APPLY
    ? '🔧 APPLY mode — changes WILL be persisted.'
    : '🔍 DRY RUN — no changes will be made. Pass --apply to execute.');

  const client = await pool.connect();
  try {
    const before = await snapshot(client, 'BEFORE');
    if (before.length === 0) return;
    if (before.length > 1) {
      throw new Error(`Expected exactly one tournament with challonge_id='${CHALLONGE_ID}', found ${before.length}. Aborting.`);
    }

    if (!APPLY) {
      console.log('\nPlanned action:');
      console.log(`  · DELETE FROM tournaments WHERE challonge_id = '${CHALLONGE_ID}'`);
      console.log('\nRe-run with --apply to execute. Then run `node recalculate_elo.js` to rebuild stats.');
      return;
    }

    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `DELETE FROM tournaments WHERE challonge_id = $1`,
      [CHALLONGE_ID]
    );
    console.log(`\n  → DELETE  (${rowCount} tournament row removed)`);
    await client.query('COMMIT');

    await snapshot(client, 'AFTER');

    console.log('\n✅ Cleanup complete.');
    console.log('Next step: `node recalculate_elo.js` to rebuild ELO and stats without the X-Division matches.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
