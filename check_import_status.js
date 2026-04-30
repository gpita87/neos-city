/**
 * check_import_status.js
 *
 * Quick diagnostic: how many offline tournaments have bracket match data?
 * Run from the neos-city directory:
 *   node check_import_status.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows: [counts] } = await pool.query(`
    SELECT
      COUNT(*)                    AS total_offline,
      COUNT(liquipedia_url)       AS with_liquipedia_url,
      COUNT(liquipedia_slug)      AS with_liquipedia_slug,
      (SELECT COUNT(DISTINCT tournament_id)
       FROM matches m
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE t.is_offline = TRUE) AS with_matches,
      (SELECT COUNT(*)
       FROM matches m
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE t.is_offline = TRUE) AS total_offline_matches
    FROM tournaments
    WHERE is_offline = TRUE
  `);

  console.log('\n📊 Offline Tournament Import Status');
  console.log('────────────────────────────────────');
  console.log(`Total offline tournaments:  ${counts.total_offline}`);
  console.log(`With liquipedia_slug:       ${counts.with_liquipedia_slug}`);
  console.log(`With liquipedia_url:        ${counts.with_liquipedia_url} (bracket import linked)`);
  console.log(`With match data:            ${counts.with_matches} tournaments`);
  console.log(`Total offline matches:      ${counts.total_offline_matches}`);
  console.log('');

  // Show a few recent imports with match counts
  const { rows: recent } = await pool.query(`
    SELECT t.name, t.completed_at::date AS date,
           COUNT(m.id) AS match_count,
           t.liquipedia_url
    FROM tournaments t
    LEFT JOIN matches m ON m.tournament_id = t.id
    WHERE t.is_offline = TRUE
    GROUP BY t.id
    ORDER BY t.completed_at DESC NULLS LAST
    LIMIT 10
  `);

  console.log('Recent offline tournaments:');
  for (const r of recent) {
    const status = r.match_count > 0 ? `✅ ${r.match_count} matches` : '⏭️  metadata only';
    console.log(`  ${r.date || 'no date'} | ${status} | ${r.name}`);
  }
  console.log('');

  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
