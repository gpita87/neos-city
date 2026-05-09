/**
 * check_offline_tiers.js
 *
 * Quick diagnostic: print every offline tournament grouped by tier so the
 * tier classification can be eyeballed at a glance. Run after a migration
 * change to confirm everything landed where you expected.
 *
 *   node check_offline_tiers.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TIER_ORDER = ['worlds', 'major', 'regional', 'other'];
const TIER_ICON  = { worlds: '🌍', major: '🏆', regional: '🎖️', other: '📍' };

async function main() {
  const { rows } = await pool.query(`
    SELECT
      t.id,
      t.name,
      t.completed_at::date AS date,
      COALESCE(t.series, 'NULL') AS tier,
      (SELECT p.display_name
         FROM tournament_placements tp
         JOIN players p ON p.id = tp.player_id
        WHERE tp.tournament_id = t.id AND tp.final_rank = 1
        LIMIT 1) AS winner
    FROM tournaments t
    WHERE t.is_offline = TRUE
    ORDER BY t.completed_at DESC NULLS LAST
  `);

  const buckets = {};
  for (const r of rows) {
    (buckets[r.tier] ||= []).push(r);
  }

  console.log('\n📊 Offline Tournament Tiers');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total offline tournaments: ${rows.length}\n`);

  console.log('Counts:');
  for (const tier of TIER_ORDER) {
    const n = (buckets[tier] || []).length;
    console.log(`  ${TIER_ICON[tier] || '  '} ${tier.padEnd(9)} ${n}`);
  }
  const unknownTiers = Object.keys(buckets).filter(t => !TIER_ORDER.includes(t));
  for (const t of unknownTiers) {
    console.log(`  ⚠️  ${t.padEnd(9)} ${buckets[t].length}  (unexpected tier)`);
  }

  for (const tier of [...TIER_ORDER, ...unknownTiers]) {
    const list = buckets[tier];
    if (!list || list.length === 0) continue;
    console.log(`\n${TIER_ICON[tier] || '  '} ${tier.toUpperCase()} (${list.length})`);
    console.log('───────────────────────────────────────────────────────────');
    for (const r of list) {
      const date   = r.date ? String(r.date) : '?'.padEnd(10);
      const winner = r.winner ? ` — won by ${r.winner}` : '';
      console.log(`  ${date}  ${r.name}${winner}`);
    }
  }

  console.log('');
  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
