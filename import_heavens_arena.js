#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Batch-import the Heaven's Arena start.gg series.
//
// HEAVENS_ARENA below holds the verified phase-group IDs for events whose
// "main bracket" was identified manually. NEW_EVENT_SLUGS holds events that
// are added by slug only — the script looks up each slug at runtime, picks
// the phase with the highest seed count (excluding "Bracket Of The Fallen"),
// and imports that one. To add a new event, just append its slug.
//
// Re-running is safe: matches use ON CONFLICT DO NOTHING (no double-counting
// or ELO double-application) and placements upsert (overwriting any stale
// rows from a prior buggy import). After re-importing, run recalculate_elo.js
// to refresh ELO if any placement-derived bonuses changed.
//
// Usage:
//   node import_heavens_arena.js
//
// Requires: STARTGG_TOKEN and DATABASE_URL in backend/.env
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: __dirname + '/backend/.env' });
const { importOneStartgg } = require('./backend/src/routes/tournaments');
const startgg = require('./backend/src/services/startgg');

// ─────────────────────────────────────────────────────────────────────────────
// Known events with verified main-bracket phase-group IDs.
//
// These were resolved manually on 2026-03-29 — events #1–#8 had multiple
// phaseGroups (main bracket + "Bracket Of The Fallen") and the right pgId was
// picked by hand. Don't auto-rediscover these; the verified mapping below is
// the source of truth.
//
// Slug patterns of the main-bracket phaseGroup (for reference):
//   #1  = heaven-s-arena-1-1     #7  = heaven-s-arena-7-1
//   #2  = heaven-s-arena-2-2     #8  = heaven-s-arena-8-1
//   #3  = heaven-s-arena-3-1     #9+ = heaven-s-arena-{N}
//   #4  = heaven-s-arena-4-2
//   #5  = heaven-s-arena-5-2
//   #6  = heaven-s-arena-6-2
// ─────────────────────────────────────────────────────────────────────────────
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
];

// ─────────────────────────────────────────────────────────────────────────────
// New events that haven't been mapped yet — slug only. The script will look up
// each one via the start.gg API at runtime to find its main bracket.
//
// To add HA #N, just append `'heaven-s-arena-N'` (the event slug — same format
// as the URL fragment between `tournament/` and `/event/`). For #9 onward each
// event has only one phase, so auto-resolution is reliable. If a future event
// adds multiple phases (consolation bracket etc.), spot-check the resolved
// pgId in the log output before trusting the import — or hard-code it into
// HEAVENS_ARENA above.
// ─────────────────────────────────────────────────────────────────────────────
const NEW_EVENT_SLUGS = [
  'heaven-s-arena-29',
  'heaven-s-arena-30',
];

// Resolve `heaven-s-arena-N` → { num, pgId, entrants } via start.gg.
// Picks the phase with the highest numSeeds, excluding any phase whose name
// contains "fallen" (Bracket Of The Fallen). Returns null on miss.
async function resolveEventSlug(slug) {
  const fullSlug = `tournament/${slug}/event/${slug}`;
  let event;
  try {
    event = await startgg.getEventBySlug(fullSlug);
  } catch (err) {
    console.error(`  ⚠️  start.gg lookup failed for ${slug}: ${err.message}`);
    return null;
  }
  if (!event) return null;

  const numMatch = slug.match(/(\d+)$/);
  const num = numMatch ? parseInt(numMatch[1], 10) : null;

  const phases = (event.phases || []).filter(p => !/fallen/i.test(p.name || ''));
  if (!phases.length) return null;
  const mainPhase = [...phases].sort((a, b) => (b.numSeeds || 0) - (a.numSeeds || 0))[0];
  const pg = mainPhase.phaseGroups?.nodes?.[0];
  if (!pg) return null;

  return {
    num,
    pgId: String(pg.id),
    entrants: mainPhase.numSeeds || event.numEntrants || null,
    phaseName: mainPhase.name,
    pgIdentifier: pg.displayIdentifier,
  };
}

async function main() {
  // ── Resolve any unmapped slugs to phase-group IDs ──────────────────────────
  if (NEW_EVENT_SLUGS.length > 0) {
    console.log(`\n🔍  Resolving ${NEW_EVENT_SLUGS.length} new event slug${NEW_EVENT_SLUGS.length === 1 ? '' : 's'} via start.gg…\n`);
    for (const slug of NEW_EVENT_SLUGS) {
      const resolved = await resolveEventSlug(slug);
      if (!resolved) {
        console.error(`  ❌ ${slug}: could not resolve a main bracket (event missing or not yet started?)`);
        continue;
      }
      // Skip if this pgId is already in HEAVENS_ARENA (avoid duplicate imports).
      if (HEAVENS_ARENA.some(h => h.pgId === resolved.pgId)) {
        console.log(`  ⏭️  ${slug}: pgId ${resolved.pgId} already in HEAVENS_ARENA — skipping`);
        continue;
      }
      const phaseLabel = resolved.phaseName ? ` (phase "${resolved.phaseName}")` : '';
      console.log(`  ✅ ${slug} → pgId ${resolved.pgId}${phaseLabel}, ${resolved.entrants ?? '?'} entrants`);
      HEAVENS_ARENA.push({ num: resolved.num, pgId: resolved.pgId, entrants: resolved.entrants });
      // Be polite to start.gg between lookups
      await new Promise(r => setTimeout(r, 500));
    }
    HEAVENS_ARENA.sort((a, b) => (a.num || 0) - (b.num || 0));
  }

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
