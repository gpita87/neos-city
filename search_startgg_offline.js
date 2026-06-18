#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — start.gg PAST Pokkén tournament search (READ-ONLY, network)
//
//   node search_startgg_offline.js
//
// Lists every PAST Pokkén (videogame id 447) tournament start.gg knows about
// back to 2017, one line per event with its tournament slug + last-phase
// phaseGroupId + ready bracket URL. Used to map the offline CSV's SmashGG
// majors/regionals to concrete import URLs.
//
// NO DB writes. Hits only start.gg (needs STARTGG_TOKEN in backend/.env).
// Must run on MAIN — worktrees forbid network calls.
// ===========================================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
const startgg = require('./backend/src/services/startgg');

// ~since 2017-01-01. 3600 days back from mid-2026 reaches early 2016.
const SINCE_DAYS = 3600;

(async () => {
  if (!process.env.STARTGG_TOKEN) {
    console.error('STARTGG_TOKEN is not set in backend/.env');
    process.exit(1);
  }
  console.log(`Searching start.gg for past Pokkén tournaments (last ${SINCE_DAYS} days)…\n`);

  const events = await startgg.discoverPokkenTournaments({
    sinceDays: SINCE_DAYS,
    perPage: 15,
    maxPages: 80,
    sleepMs: 700,
  });

  // De-dupe by tournament slug, keep the largest-entrant phase group per event.
  events.sort((a, b) => (a.startAt || 0) - (b.startAt || 0));

  console.log(`Found ${events.length} Pokkén phase-group entries.\n`);
  console.log('DATE       | ENTR | TOURNAMENT SLUG / EVENT  →  BRACKET URL');
  console.log('─'.repeat(100));
  for (const e of events) {
    const d = e.startAt ? new Date(e.startAt * 1000).toISOString().slice(0, 10) : 'no-date  ';
    const entr = String(e.numEntrants ?? '?').padStart(4);
    console.log(`${d} | ${entr} | ${e.name} || ${e.url}`);
  }
  console.log('─'.repeat(100));
  console.log(`Done. ${events.length} entries. Match these against the SmashGG CSV candidates.`);
})().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
