require('dotenv').config({ path: 'backend/.env' });
const db = require('./backend/src/db');

(async () => {
  // The genuinely non-Pokkén rows: Granblue Fantasy Versus Rising
  const gb = await db.query(`
    SELECT id, name, started_at FROM tournaments
    WHERE name ILIKE '%granblue%' ORDER BY started_at
  `);
  const ids = gb.rows.map(r => r.id);
  console.log(`Granblue rows (${gb.rows.length}): ids = [${ids.join(', ')}]`);
  for (const r of gb.rows) console.log(`  id=${r.id} series-check  ${r.name.trim()}`);

  if (!ids.length) { await db.end(); return; }

  const m = await db.query(`SELECT COUNT(*) c FROM matches WHERE tournament_id = ANY($1)`, [ids]);
  const p = await db.query(`SELECT COUNT(*) c FROM tournament_placements WHERE tournament_id = ANY($1)`, [ids]);
  console.log(`\nGranblue rows pull in: ${m.rows[0].c} matches, ${p.rows[0].c} placements.`);

  // Players who appear ONLY in Granblue events (phantom Pokkén players)
  const phantom = await db.query(`
    WITH gb_players AS (
      SELECT player1_id AS pid FROM matches WHERE tournament_id = ANY($1) AND player1_id IS NOT NULL
      UNION
      SELECT player2_id FROM matches WHERE tournament_id = ANY($1) AND player2_id IS NOT NULL
    ),
    other_players AS (
      SELECT player1_id AS pid FROM matches WHERE tournament_id <> ALL($1) AND player1_id IS NOT NULL
      UNION
      SELECT player2_id FROM matches WHERE tournament_id <> ALL($1) AND player2_id IS NOT NULL
    )
    SELECT pl.id, pl.display_name
    FROM gb_players g
    JOIN players pl ON pl.id = g.pid
    WHERE g.pid NOT IN (SELECT pid FROM other_players)
    ORDER BY pl.display_name
  `, [ids]);
  console.log(`\nPlayers appearing ONLY in Granblue events (${phantom.rows.length}):`);
  for (const r of phantom.rows) console.log(`  id=${r.id}  ${r.display_name}`);

  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
