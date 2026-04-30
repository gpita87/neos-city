/**
 * diagnose_no_dates.js
 *
 * Lists all remaining no-date tournaments with their challonge_id,
 * source, match count, and what dated neighbors exist for numbered series.
 *
 * Usage: node diagnose_no_dates.js
 */

require('dotenv').config({ path: './backend/.env' });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Get all no-date tournaments
  const { rows: noDate } = await pool.query(`
    SELECT t.id, t.name, t.challonge_id, t.source, t.is_offline, t.tonamel_id, t.startgg_slug,
           (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id)::int AS match_count
    FROM tournaments t
    WHERE started_at IS NULL AND completed_at IS NULL
    ORDER BY t.name
  `);

  console.log(`\n=== ${noDate.length} tournaments still have no date ===\n`);

  // For numbered series, show what neighbors ARE dated
  const seriesNames = ['Croissant Cup', 'RTG EU', 'Ferrum Fist', 'End of the Road', 'RTG Asia'];

  for (const s of seriesNames) {
    const { rows } = await pool.query(`
      SELECT name, COALESCE(completed_at, started_at) AS dt
      FROM tournaments
      WHERE name ILIKE $1
      ORDER BY COALESCE(completed_at, started_at) ASC NULLS LAST
    `, [`%${s}%`]);

    const dated = rows.filter(r => r.dt);
    const undated = rows.filter(r => !r.dt);

    if (undated.length > 0) {
      console.log(`\n--- ${s} ---`);
      console.log(`  Dated: ${dated.length} events (range: ${dated.length > 0 ? dated[0].dt?.toISOString().slice(0,10) + ' to ' + dated[dated.length-1].dt?.toISOString().slice(0,10) : 'none'})`);
      if (dated.length > 0) {
        // Show the dated ones with their numbers for reference
        console.log('  Dated events:');
        for (const d of dated.slice(-5)) {
          const num = d.name.match(/#(\d+)/)?.[1] || d.name.match(/\b(\d{1,3})\s*$/)?.[1] || '?';
          console.log(`    #${num}  ${d.dt.toISOString().slice(0,10)}  ${d.name}`);
        }
      }
      console.log(`  Undated: ${undated.length} events:`);
      for (const u of undated) {
        console.log(`    ${u.name}`);
      }
    }
  }

  console.log('\n\n=== FULL LIST ===\n');
  for (const t of noDate) {
    const slug = t.challonge_id || t.startgg_slug || t.tonamel_id || 'no-slug';
    console.log(`  [${String(t.match_count).padStart(3)} matches]  ${t.name}`);
    console.log(`              slug: ${slug}  source: ${t.source || 'unknown'}  offline: ${t.is_offline || false}`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
