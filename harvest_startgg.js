#!/usr/bin/env node
// ===========================================================================
// NEOS CITY - Harvest new Pokkén start.gg tournaments
// Run from the neos-city directory:  node harvest_startgg.js
//
// Queries start.gg's GraphQL `tournaments` endpoint for past Pokkén
// (videogameId 447) tournaments in the last N days, dedupes against
// harvested_tournaments.txt and the tournaments table (startgg_phase_group_id),
// and appends new bracket URLs to the harvested file.
//
// After this finishes, run `node pull_new.js` to import the new URLs (or it'll
// run as part of pull_new.js Step 2).
//
// Notes:
// - Counterpart to harvest_new.js (Challonge organizers). They share
//   harvested_tournaments.txt as the destination.
// - One URL per phase group on each Pokkén event's LAST phase. If a tournament
//   has Pools + Top 8, only the Top 8 phase group(s) are emitted.
// - Backend doesn't need to be running. The script uses the start.gg service
//   directly and reads the DB through the same connection string.
// - Optional CLI flag:  --since-days N   (default 90)
// ===========================================================================

require('dotenv').config({ path: './backend/.env' });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
const startgg = require('./backend/src/services/startgg');

const HARVESTED_FILE = path.join(__dirname, 'harvested_tournaments.txt');

// Locals threshold — events with fewer entrants are skipped at harvest time.
// 8 keeps the floor at "at least a top 8 worth of bracket" and drops the long
// tail of 2–6 entrant weekly micro-events that would otherwise pollute stats.
const MIN_ENTRANTS = 8;

// Series allowlist — events whose tournament/event name doesn't match any
// of these patterns are skipped. Mirrors harvest_new.js's per-organizer model
// for Challonge: start.gg has no central "series" organizer, so we curate by
// name. Add more patterns as new series get blessed for inclusion. Set to []
// to disable the filter entirely.
const SERIES_PATTERNS = [
  /heaven'?s arena/i,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { sinceDays: 90 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since-days' && args[i + 1]) {
      out.sinceDays = parseInt(args[i + 1], 10) || 90;
      i++;
    }
  }
  return out;
}

(async () => {
  if (!process.env.STARTGG_TOKEN) {
    console.error('STARTGG_TOKEN is not set in backend/.env - cannot query start.gg');
    process.exit(1);
  }

  const { sinceDays } = parseArgs();
  console.log(`Harvesting new start.gg Pokkén tournaments (last ${sinceDays} days)...\n`);

  // ── 1. Build sets of already-known phase group IDs ─────────────────────
  const existingLines = fs.existsSync(HARVESTED_FILE)
    ? fs.readFileSync(HARVESTED_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
    : [];

  const filePhaseGroupIds = new Set();
  for (const line of existingLines) {
    if (!line.startsWith('http') || !line.includes('start.gg')) continue;
    const parsed = startgg.parseStartggUrl(line);
    if (parsed?.phaseGroupId) filePhaseGroupIds.add(parsed.phaseGroupId);
  }
  console.log(`harvested_tournaments.txt: ${filePhaseGroupIds.size} start.gg phase groups already listed`);

  let dbPhaseGroupIds = new Set();
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows } = await pool.query(
        "SELECT startgg_phase_group_id FROM tournaments WHERE startgg_phase_group_id IS NOT NULL"
      );
      dbPhaseGroupIds = new Set(rows.map(r => r.startgg_phase_group_id));
      console.log(`tournaments table: ${dbPhaseGroupIds.size} start.gg tournaments already imported`);
    } catch (err) {
      console.warn(`  WARN: DB lookup failed (${err.message}) - continuing with file-only dedup`);
    } finally {
      await pool.end();
    }
  } else {
    console.warn('  WARN: DATABASE_URL not set - dedup will only check the file');
  }

  const known = new Set([...filePhaseGroupIds, ...dbPhaseGroupIds]);
  console.log(`Combined known phase groups: ${known.size}\n`);

  // ── 2. Query start.gg ─────────────────────────────────────────────────
  let discovered = [];
  try {
    discovered = await startgg.discoverPokkenTournaments({ sinceDays });
  } catch (err) {
    console.error(`start.gg query failed: ${err.message}`);
    console.error('Skipping start.gg harvest - existing harvested_tournaments.txt is unchanged.');
    process.exit(0);
  }

  console.log(`Discovered ${discovered.length} phase group(s) across all Pokkén tournaments`);

  // ── 3. Filter to genuinely new ones ────────────────────────────────────
  const seen = new Set();
  const fresh = [];
  for (const item of discovered) {
    if (known.has(item.phaseGroupId)) continue;
    if (seen.has(item.phaseGroupId)) continue; // de-dupe within this run
    seen.add(item.phaseGroupId);
    fresh.push(item);
  }

  if (fresh.length === 0) {
    console.log('===========================================================');
    console.log('No new start.gg tournaments found.');
    console.log('harvested_tournaments.txt is up to date.');
    return;
  }

  // Sort newest-first so the file reads chronologically when scanned by eye
  fresh.sort((a, b) => (b.startAt || 0) - (a.startAt || 0));

  console.log(`\n${fresh.length} new phase group(s) to add:`);
  for (const item of fresh) {
    const date = item.startAt
      ? new Date(item.startAt * 1000).toISOString().slice(0, 10)
      : '????-??-??';
    console.log(`  ${date}  ${item.name}  [${item.numEntrants ?? '?'} entrants]`);
  }

  // ── 4. Append to harvested_tournaments.txt ─────────────────────────────
  const lines = [];
  const fileContent = fs.existsSync(HARVESTED_FILE) ? fs.readFileSync(HARVESTED_FILE, 'utf8') : '';
  if (fileContent && !fileContent.endsWith('\n')) lines.push('');

  lines.push(`# Appended by harvest_startgg.js on ${new Date().toISOString().slice(0, 10)} (last ${sinceDays}d)`);
  for (const item of fresh) {
    const date = item.startAt
      ? new Date(item.startAt * 1000).toISOString().slice(0, 10)
      : '????-??-??';
    lines.push(`# ${date} - ${item.name}`);
    lines.push(item.url);
  }
  lines.push('');

  fs.appendFileSync(HARVESTED_FILE, lines.join('\n'));

  console.log('===========================================================');
  console.log(`Appended ${fresh.length} new URL(s) to harvested_tournaments.txt`);
  console.log('\nNext step: node pull_new.js (or it runs automatically as Step 3)');
})().catch(err => {
  console.error('\nFatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
