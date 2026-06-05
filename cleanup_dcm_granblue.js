/**
 * cleanup_dcm_granblue.js
 *
 * Removes the Granblue Fantasy Versus Rising events that were mis-imported and
 * tagged series='dcm'. They're a different game and pollute ELO, DCM series
 * stats, and the player roster.
 *
 * What it deletes:
 *   - Tournaments whose name ILIKE '%granblue%' (their matches / placements /
 *     elo_history cascade automatically).
 *   - Players who appear ONLY in those tournaments (phantom non-Pokkén players).
 *
 * Targets are derived by query (not hardcoded ids), so the script is idempotent:
 * once the Granblue rows are gone a re-run finds nothing and no-ops.
 *
 * After --apply, run `node recalculate_elo.js` to rebuild ELO + aggregate stats
 * for the REAL players who also played these events.
 *
 * Usage:
 *   node cleanup_dcm_granblue.js          # dry run — shows what would change
 *   node cleanup_dcm_granblue.js --apply  # execute inside one transaction
 */
require('dotenv').config({ path: 'backend/.env' });
const db = require('./backend/src/db');

const APPLY = process.argv.includes('--apply');

(async () => {
  // 1. The mis-tagged tournaments.
  const t = await db.query(`
    SELECT id, name, series, started_at
    FROM tournaments
    WHERE name ILIKE '%granblue%'
    ORDER BY started_at
  `);
  const tIds = t.rows.map(r => r.id);

  if (!tIds.length) {
    console.log('No Granblue tournaments found — nothing to clean. (Already done?)');
    await db.end();
    return;
  }

  console.log(`Granblue tournaments to delete (${t.rows.length}):`);
  for (const r of t.rows) {
    console.log(`  id=${r.id}  series=${r.series}  ${r.started_at ? r.started_at.toISOString().slice(0,10) : '????'}  ${r.name.trim()}`);
  }

  const mc = await db.query(`SELECT COUNT(*) c FROM matches WHERE tournament_id = ANY($1)`, [tIds]);
  const pc = await db.query(`SELECT COUNT(*) c FROM tournament_placements WHERE tournament_id = ANY($1)`, [tIds]);
  console.log(`  → cascades ${mc.rows[0].c} matches and ${pc.rows[0].c} placements.`);

  // 2. Players who appear ONLY in these tournaments (safe to delete).
  const phantom = await db.query(`
    WITH gb_players AS (
      SELECT player1_id AS pid FROM matches WHERE tournament_id = ANY($1) AND player1_id IS NOT NULL
      UNION
      SELECT player2_id     FROM matches WHERE tournament_id = ANY($1) AND player2_id IS NOT NULL
    ),
    other_players AS (
      SELECT player1_id AS pid FROM matches WHERE tournament_id <> ALL($1) AND player1_id IS NOT NULL
      UNION
      SELECT player2_id     FROM matches WHERE tournament_id <> ALL($1) AND player2_id IS NOT NULL
    )
    SELECT pl.id, pl.display_name
    FROM gb_players g
    JOIN players pl ON pl.id = g.pid
    WHERE g.pid NOT IN (SELECT pid FROM other_players)
    ORDER BY pl.display_name
  `, [tIds]);
  const pIds = phantom.rows.map(r => r.id);

  console.log(`\nPhantom players appearing ONLY in Granblue events (${phantom.rows.length}):`);
  for (const r of phantom.rows) console.log(`  id=${r.id}  ${r.display_name}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply to execute.');
    await db.end();
    return;
  }

  // 3. Execute in one transaction. Tournaments first (cascades matches), then
  //    phantom players (now unreferenced by any match).
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const dt = await client.query(`DELETE FROM tournaments WHERE id = ANY($1)`, [tIds]);
    let dp = { rowCount: 0 };
    if (pIds.length) {
      dp = await client.query(`DELETE FROM players WHERE id = ANY($1)`, [pIds]);
    }
    await client.query('COMMIT');
    console.log(`\nAPPLIED: deleted ${dt.rowCount} tournaments and ${dp.rowCount} players.`);
    console.log('Next: run  node recalculate_elo.js  to rebuild ELO + aggregate stats.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK — no changes committed. Error:');
    throw e;
  } finally {
    client.release();
  }

  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
