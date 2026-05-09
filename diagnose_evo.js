/**
 * diagnose_evo.js
 *
 * Print every offline tournament whose name contains "EVO" in detail —
 * raw name + hex bytes, liquipedia_url, liquipedia_slug, source, series,
 * counts of matches and placements. Confirms whether duplicates are
 * separate events (different bracket / side tournament) or just stray
 * inserts that should be merged.
 *
 *   node diagnose_evo.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT
      t.id, t.name,
      encode(convert_to(t.name, 'UTF8'), 'hex')   AS name_hex,
      t.completed_at::date                         AS date,
      t.series, t.source,
      t.liquipedia_slug, t.liquipedia_url,
      t.participants_count, t.prize_pool,
      (SELECT COUNT(*) FROM matches m              WHERE m.tournament_id = t.id) AS match_count,
      (SELECT COUNT(*) FROM tournament_placements WHERE tournament_id = t.id) AS placement_count,
      (SELECT p.display_name FROM tournament_placements tp
         JOIN players p ON p.id = tp.player_id
        WHERE tp.tournament_id = t.id AND tp.final_rank = 1 LIMIT 1) AS winner
    FROM tournaments t
    WHERE t.is_offline = TRUE AND UPPER(t.name) LIKE '%EVO%'
    ORDER BY t.completed_at DESC NULLS LAST, t.id
  `);

  console.log(`\n🔍 EVO rows in offline tournaments (${rows.length} total)\n`);
  for (const r of rows) {
    const date = r.date ? new Date(r.date).toISOString().slice(0, 10) : '?';
    console.log(`──── id=${r.id} | ${date} | ${r.series} ────`);
    console.log(`  name:        "${r.name}"`);
    console.log(`  name_hex:    ${r.name_hex}`);
    console.log(`  source:      ${r.source}`);
    console.log(`  liq_slug:    ${r.liquipedia_slug || '(none)'}`);
    console.log(`  liq_url:     ${r.liquipedia_url  || '(none)'}`);
    console.log(`  participants:${r.participants_count ?? '?'}   prize: ${r.prize_pool || '(none)'}`);
    console.log(`  matches:     ${r.match_count}     placements: ${r.placement_count}`);
    console.log(`  winner:      ${r.winner || '(none)'}`);
    console.log('');
  }

  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
