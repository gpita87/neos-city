/**
 * verify_merge_winners.js
 *
 * Read-only safety check before running `merge_offline_duplicates.js --apply`.
 *
 * For each queued KEEP↔DROP pair, prints rank=1 and rank=2 player names from
 * BOTH rows side by side. The merge will DELETE KEEP's placements and replace
 * them with DROP's whenever DROP has any placements, so a mismatch on rank=1
 * means we'd lose KEEP's authoritative offline_import winner.
 *
 *   ✅ — KEEP and DROP agree on rank=1 + rank=2 → safe to merge
 *   ⚠️  — they disagree somewhere → eyeball before --apply
 *
 *   node verify_merge_winners.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Pairs from the dry-run output of merge_offline_duplicates.js (2026-05-09).
// [keepId, dropId]. Re-run the dry-run if topology may have changed.
const PAIRS = [
  [555, 637], [558, 636], [562, 635], [563, 642], [569, 641], [574, 638],
  [580, 783], [587, 789], [597, 788], [599, 647], [606, 785], [607, 786],
  [613, 646], [615, 634], [617, 787], [620, 784], [628, 645], [630, 643],
];

async function main() {
  let okCount = 0;
  let warnCount = 0;

  console.log('\n🔍 Verifying merge safety — comparing KEEP vs DROP top-2 placements\n');

  for (const [keep, drop] of PAIRS) {
    const { rows } = await pool.query(`
      SELECT t.id, t.name, tp.final_rank, p.display_name,
             (SELECT COUNT(*) FROM matches WHERE tournament_id = t.id) AS match_count,
             (SELECT COUNT(*) FROM tournament_placements WHERE tournament_id = t.id) AS placement_count
      FROM tournaments t
      LEFT JOIN tournament_placements tp ON tp.tournament_id = t.id AND tp.final_rank IN (1, 2)
      LEFT JOIN players p ON p.id = tp.player_id
      WHERE t.id = ANY($1)
      ORDER BY t.id, tp.final_rank
    `, [[keep, drop]]);

    const name = rows[0]?.name || '?';
    const k1 = rows.find(r => r.id === keep && r.final_rank === 1)?.display_name || '—';
    const k2 = rows.find(r => r.id === keep && r.final_rank === 2)?.display_name || '—';
    const d1 = rows.find(r => r.id === drop && r.final_rank === 1)?.display_name || '—';
    const d2 = rows.find(r => r.id === drop && r.final_rank === 2)?.display_name || '—';
    const dropMatches = rows.find(r => r.id === drop)?.match_count ?? 0;
    const dropPlacements = rows.find(r => r.id === drop)?.placement_count ?? 0;

    const matches1 = k1 === d1;
    const matches2 = k2 === d2;
    const ok = matches1 && matches2;
    if (ok) okCount++; else warnCount++;

    const mark = ok ? '✅' : '⚠️ ';
    const dropMeta = `(drop: ${dropMatches}m/${dropPlacements}p)`;

    console.log(`${mark} ${String(keep).padStart(3)}→${String(drop).padStart(3)}  ${name.padEnd(28)}  ${dropMeta.padEnd(18)}`);
    console.log(`           KEEP rank1: ${k1.padEnd(20)} rank2: ${k2}`);
    console.log(`           DROP rank1: ${d1.padEnd(20)} rank2: ${d2}`);
    if (!ok) {
      const issues = [];
      if (!matches1) issues.push('rank1 differs');
      if (!matches2) issues.push('rank2 differs');
      console.log(`           ⚠️  ${issues.join(', ')} — KEEP is canonical (offline_import from Liquipedia)`);
    }
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────');
  console.log(`Pairs OK:    ${okCount}/${PAIRS.length}`);
  console.log(`Pairs WARN:  ${warnCount}/${PAIRS.length}`);
  if (warnCount === 0) {
    console.log('\nAll clear. Safe to run: node merge_offline_duplicates.js --apply');
  } else {
    console.log('\nReview the ⚠️  pairs before --apply. KEEP\'s rank-1/rank-2 will be');
    console.log('overwritten by DROP\'s — confirm DROP\'s placements are trustworthy');
    console.log('for those events, or skip them in the merge script.');
  }

  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
