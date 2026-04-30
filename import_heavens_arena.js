#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Batch-import the Heaven's Arena start.gg series (1 – 28, completed events).
//
// Usage:
//   node import_heavens_arena.js
//
// Requires: STARTGG_TOKEN and DATABASE_URL in backend/.env
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: __dirname + '/backend/.env' });
const { importOneStartgg } = require('./backend/src/routes/tournaments');

// Phase-group IDs for the main "Heaven's Arena" bracket (excluding "Bracket Of The Fallen").
// Resolved via the start.gg GraphQL API on 2026-03-29.
//
// Slug patterns vary across the series:
//   #1  = heaven-s-arena-1-1     #7  = heaven-s-arena-7-1
//   #2  = heaven-s-arena-2-2     #8  = heaven-s-arena-8-1
//   #3  = heaven-s-arena-3-1     #9+ = heaven-s-arena-{N}
//   #4  = heaven-s-arena-4-2
//   #5  = heaven-s-arena-5-2
//   #6  = heaven-s-arena-6-2
const HEAVENS_ARENA = [
  { num:  1, pgId: '2659659', entrants: 13, date: '2024-11-06' },
  { num:  2, pgId: '2686783', entrants: 11, date: '2024-11-20' },
  { num:  3, pgId: '2706536', entrants: 13, date: '2024-12-08' },
  { num:  4, pgId: '2753095', entrants: 14, date: '2025-01-22' },
  { num:  5, pgId: '2771079', entrants: 10, date: '2025-02-05' },
  { num:  6, pgId: '2785807', entrants: 17, date: '2025-03-05' },
  { num:  7, pgId: '2830680', entrants:  8, date: '2025-03-25' },
  { num:  8, pgId: '2845971', entrants:  8, date: '2025-04-08' },
  { num:  9, pgId: '2866484', entrants:  8, date: '2025-04-22' },
  { num: 10, pgId: '2894789', entrants: 10, date: '2025-05-20' },
  { num: 11, pgId: '2916710', entrants: 10, date: '2025-06-10' },
  { num: 12, pgId: '2945509', entrants:  9, date: '2025-07-08' },
  { num: 13, pgId: '2979505', entrants: 10, date: '2025-08-05' },
  { num: 14, pgId: '2997557', entrants: 13, date: '2025-08-19' },
  { num: 15, pgId: '3016043', entrants: 10, date: '2025-09-02' },
  { num: 16, pgId: '3033626', entrants:  9, date: '2025-09-16' },
  { num: 17, pgId: '3050284', entrants: 10, date: '2025-09-30' },
  { num: 18, pgId: '3064300', entrants:  9, date: '2025-10-14' },
  { num: 19, pgId: '3088464', entrants: 13, date: '2025-10-28' },
  { num: 20, pgId: '3113734', entrants:  9, date: '2025-11-18' },
  { num: 21, pgId: '3132431', entrants: 12, date: '2025-12-02' },
  { num: 22, pgId: '3139983', entrants:  9, date: '2025-12-16' },
  { num: 23, pgId: '3149259', entrants: 15, date: '2026-01-06' },
  { num: 24, pgId: '3168230', entrants: 13, date: '2026-01-20' },
  { num: 25, pgId: '3176543', entrants: 16, date: '2026-02-03' },
  { num: 26, pgId: '3206421', entrants: 12, date: '2026-02-17' },
  { num: 27, pgId: '3216752', entrants: 11, date: '2026-03-03' },
  { num: 28, pgId: '3237094', entrants: 11, date: '2026-03-17' },
  // #29 is CREATED but not yet completed — skip for now
];

async function main() {
  console.log(`\n🏟️  Heaven's Arena batch import — ${HEAVENS_ARENA.length} tournaments\n`);

  const results = { ok: [], fail: [] };

  for (const ha of HEAVENS_ARENA) {
    const label = `Heaven's Arena #${ha.num}`;
    try {
      console.log(`⏳ Importing ${label} (pgId ${ha.pgId}, ${ha.entrants} entrants)…`);
      const result = await importOneStartgg(ha.pgId);
      console.log(`  ✅ ${result.tournament} — ${result.matches_imported} matches imported`);
      results.ok.push({ num: ha.num, ...result });
    } catch (err) {
      console.error(`  ❌ ${label}: ${err.message}`);
      results.fail.push({ num: ha.num, error: err.message });
    }

    // Respect start.gg rate limits (~80 req/min) — pause between tournaments
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n── Summary ──────────────────────────────────────────────');
  console.log(`  Imported: ${results.ok.length}`);
  console.log(`  Failed:   ${results.fail.length}`);
  if (results.fail.length) {
    console.log('  Failures:');
    for (const f of results.fail) console.log(`    #${f.num}: ${f.error}`);
  }
  console.log('');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
