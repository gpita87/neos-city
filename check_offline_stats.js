#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Neos City — Offline Stats Diagnostic
// Run from the neos-city directory:  node check_offline_stats.js
//
// Works both before and after the add_offline_tier_stats migration.
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const db = require('./backend/src/db');

(async () => {
  console.log('🏆  Neos City — Offline Stats Diagnostic');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 1. Offline tournaments by tier ──────────────────────────────────────
  const { rows: tiers } = await db.query(`
    SELECT series, COUNT(*) AS count
    FROM tournaments
    WHERE is_offline = TRUE
    GROUP BY series
    ORDER BY count DESC
  `);
  console.log('📊  Offline tournaments by tier:');
  for (const t of tiers) {
    console.log(`    ${(t.series || 'NULL').padEnd(12)} ${t.count}`);
  }
  console.log(`    ${'TOTAL'.padEnd(12)} ${tiers.reduce((a, t) => a + parseInt(t.count), 0)}\n`);

  // ── 2. Bracket import status ────────────────────────────────────────────
  const { rows: [imp] } = await db.query(`
    SELECT
      COUNT(*)                    AS total_offline,
      COUNT(liquipedia_url)       AS with_liquipedia_url,
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
  console.log('📦  Bracket import status:');
  console.log(`    Total offline tournaments:    ${imp.total_offline}`);
  console.log(`    Linked to Liquipedia URL:     ${imp.with_liquipedia_url}`);
  console.log(`    With bracket match data:      ${imp.with_matches} tournaments (${imp.total_offline_matches} matches)`);
  console.log(`    Metadata only (no matches):   ${imp.total_offline - imp.with_matches}\n`);

  // ── 3. Placement data coverage ──────────────────────────────────────────
  const { rows: [coverage] } = await db.query(`
    SELECT
      COUNT(DISTINCT tp.tournament_id) AS tournaments_with_placements,
      COUNT(*) AS total_placements,
      COUNT(*) FILTER (WHERE tp.final_rank = 1) AS first_place,
      COUNT(*) FILTER (WHERE tp.final_rank = 2) AS second_place,
      COUNT(*) FILTER (WHERE tp.final_rank <= 4 AND tp.final_rank > 2) AS top4_only,
      COUNT(*) FILTER (WHERE tp.final_rank <= 8 AND tp.final_rank > 4) AS top8_only
    FROM tournament_placements tp
    JOIN tournaments t ON tp.tournament_id = t.id
    WHERE t.is_offline = TRUE
  `);
  console.log('📈  Offline placement data coverage:');
  console.log(`    Tournaments with placements:  ${coverage.tournaments_with_placements}`);
  console.log(`    Total placement records:      ${coverage.total_placements}`);
  console.log(`    1st place records:            ${coverage.first_place}`);
  console.log(`    2nd place records:            ${coverage.second_place}`);
  console.log(`    3rd-4th place records:        ${coverage.top4_only}`);
  console.log(`    5th-8th place records:        ${coverage.top8_only}\n`);

  // ── 4. Check if per-tier columns exist (migration status) ───────────────
  const { rows: cols } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'players' AND column_name LIKE 'offline_%'
    ORDER BY column_name
  `);
  const colNames = cols.map(c => c.column_name);
  const hasTierCols = colNames.includes('offline_worlds_wins');

  console.log(`📋  Offline columns in players table (${cols.length}):`);
  if (!hasTierCols) {
    console.log('    ⚠️  Per-tier columns NOT found. Run the migration first:');
    console.log('       node run_migration.js backend/src/db/migrations/add_offline_tier_stats.sql');
    console.log('    Currently only have: ' + colNames.join(', '));
  } else {
    console.log('    ✅  Per-tier columns present (' + colNames.length + ' columns)');

    // ── 5. Top 10 by offline_score ─────────────────────────────────────────
    const { rows: top10 } = await db.query(`
      SELECT display_name, offline_score,
             offline_worlds_wins, offline_worlds_runner_up, offline_worlds_top4, offline_worlds_top8,
             offline_major_wins, offline_major_runner_up, offline_major_top4, offline_major_top8,
             offline_regional_wins, offline_regional_runner_up, offline_regional_top4, offline_regional_top8,
             offline_other_wins, offline_other_runner_up, offline_other_top4, offline_other_top8,
             offline_wins, offline_top2
      FROM players
      WHERE offline_score > 0
      ORDER BY offline_score DESC
      LIMIT 15
    `);

    if (top10.length === 0) {
      console.log('\n    ⚠️  No players have offline_score > 0 yet.');
      console.log('       Run: node recalculate_elo.js   (rebuilds offline stats in Step 5b)');
    } else {
      console.log(`\n🥇  Top ${top10.length} players by offline score:\n`);
      console.log('    Name                     Score  Worlds       Majors       Regionals    Locals');
      console.log('    ' + '─'.repeat(90));

      for (const p of top10) {
        const fmt = (key) => {
          const w = p[`offline_${key}_wins`] || 0;
          const r = p[`offline_${key}_runner_up`] || 0;
          const t4 = p[`offline_${key}_top4`] || 0;
          const t8 = p[`offline_${key}_top8`] || 0;
          if (w + r + t4 + t8 === 0) return '—'.padEnd(12);
          return `${w}W ${r}R ${t4}T4 ${t8}T8`.padEnd(12);
        };
        console.log(
          `    ${p.display_name.slice(0, 25).padEnd(25)} ${String(p.offline_score).padStart(5)}  ` +
          `${fmt('worlds')} ${fmt('major')} ${fmt('regional')} ${fmt('other')}`
        );
      }
    }
  }

  // ── 6. Recent offline tournaments ───────────────────────────────────────
  const { rows: recent } = await db.query(`
    SELECT t.name, t.series, t.completed_at::date AS date,
           COUNT(m.id) AS match_count
    FROM tournaments t
    LEFT JOIN matches m ON m.tournament_id = t.id
    WHERE t.is_offline = TRUE
    GROUP BY t.id
    ORDER BY t.completed_at DESC NULLS LAST
    LIMIT 10
  `);
  console.log('\n🗓️   Recent offline tournaments:');
  for (const r of recent) {
    const tier = (r.series || '?').padEnd(10);
    const status = r.match_count > 0 ? `✅ ${String(r.match_count).padStart(3)} matches` : '⏭️   metadata only';
    console.log(`    ${r.date || 'no date'}  ${tier}  ${status}  ${r.name}`);
  }

  console.log('\n✨  Done!');
  await db.end?.();
  process.exit(0);
})().catch(err => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});
