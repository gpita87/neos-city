#!/usr/bin/env node
// ===========================================================================
// NEOS CITY - Harvest new tournament URLs from known organizers
// Run from the neos-city directory:  node harvest_new.js
//
// Walks each Pokkén organizer's Challonge profile (via discoverUserTournaments),
// dedupes against harvested_tournaments.txt and against the tournaments table,
// validates the genuinely new slugs against the Pokkén keyword allow-list,
// and appends them to harvested_tournaments.txt.
//
// After this finishes, run `node pull_new.js` to import the new URLs.
//
// Notes:
// - start.gg URLs are NOT auto-discovered (no public list-by-organizer API);
//   add those to harvested_tournaments.txt by hand.
// - Tonamel and Liquipedia events live on separate pipelines and are
//   unaffected by this script.
// - Backend doesn't need to be running. The script uses the Challonge service
//   directly and reads the DB through the same connection string.
// ===========================================================================

require('dotenv').config({ path: './backend/.env' });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
const challonge = require('./backend/src/services/challonge');

// Per seed_organizers.sql / AGENT_CONTEXT.md community section
const ORGANIZERS = [
  { username: 'wise_',          series: 'FFC' },
  { username: 'rickythe3rd',    series: 'FFC' },
  { username: 'shean96',        series: 'RTG NA' },
  { username: 'rigz_',          series: 'RTG NA' },
  { username: '__chepestoopid', series: 'RTG EU' },
  { username: 'devlinhartfgc',  series: 'DCM' },
  { username: '__auradiance',   series: 'TCC' },
];

const HARVESTED_FILE = path.join(__dirname, 'harvested_tournaments.txt');

(async () => {
  console.log('Harvesting new Challonge tournaments...\n');

  // ── 1. Build a set of already-known slugs ──────────────────────────────
  const existingLines = fs.existsSync(HARVESTED_FILE)
    ? fs.readFileSync(HARVESTED_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
    : [];

  const fileSlugs = new Set(
    existingLines
      .filter(l => l.startsWith('http') && !l.includes('start.gg'))
      .map(l => challonge.extractSlugFromUrl(l))
      .filter(Boolean)
  );
  console.log(`harvested_tournaments.txt: ${fileSlugs.size} Challonge slugs already listed`);

  let dbSlugs = new Set();
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows } = await pool.query(
        "SELECT challonge_id FROM tournaments WHERE challonge_id IS NOT NULL"
      );
      dbSlugs = new Set(rows.map(r => r.challonge_id));
      console.log(`tournaments table: ${dbSlugs.size} Challonge tournaments already imported`);
    } catch (err) {
      console.warn(`  WARN: DB lookup failed (${err.message}) - continuing with file-only dedup`);
    } finally {
      await pool.end();
    }
  } else {
    console.warn('  WARN: DATABASE_URL not set in backend/.env - dedup will only check the file');
  }

  const known = new Set([...fileSlugs, ...dbSlugs]);
  console.log(`Combined known slugs: ${known.size}\n`);

  // ── 2. For each organizer, scrape -> filter -> validate new ones ───────
  const newSlugsByOrg = {};
  let totalNew = 0;
  let totalErrors = 0;

  for (const { username, series } of ORGANIZERS) {
    console.log(`[${series}] ${username}`);
    try {
      // First pass: scrape without validation (fast)
      const allScraped = await challonge.discoverUserTournaments(username, {
        pages: 5,
        validate: false,
      });
      console.log(`  Scraped ${allScraped.length} slugs`);

      const candidates = allScraped.filter(s => !known.has(s));
      if (candidates.length === 0) {
        console.log('  Nothing new since last harvest');
        newSlugsByOrg[username] = { slugs: [], series };
        continue;
      }
      console.log(`  ${candidates.length} candidate(s) not yet in file or DB - validating...`);

      // Second pass: validate ONLY the new candidates against the Pokkén keyword list
      const validated = await challonge.validatePokkenSlugs(candidates);
      newSlugsByOrg[username] = { slugs: validated, series };
      totalNew += validated.length;
      validated.forEach(s => known.add(s)); // prevent cross-organizer duplicates
      console.log(`  ${validated.length} new validated slug(s)`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      newSlugsByOrg[username] = { slugs: [], series, error: err.message };
      totalErrors++;
    }
    console.log('');
  }

  // ── 3. Append the new URLs to harvested_tournaments.txt ───────────────
  if (totalNew === 0) {
    console.log('===========================================================');
    console.log(`No new tournaments found. (errors: ${totalErrors})`);
    console.log('harvested_tournaments.txt is up to date.');
    return;
  }

  const lines = [];
  // Ensure separation from any prior content - prepend a blank line if the
  // file doesn't already end with one
  const fileContent = fs.existsSync(HARVESTED_FILE) ? fs.readFileSync(HARVESTED_FILE, 'utf8') : '';
  if (fileContent && !fileContent.endsWith('\n')) lines.push('');

  lines.push(`# Appended by harvest_new.js on ${new Date().toISOString().slice(0, 10)}`);
  for (const [username, { slugs, series }] of Object.entries(newSlugsByOrg)) {
    if (slugs.length === 0) continue;
    lines.push(`# ${series} / ${username} (${slugs.length} new)`);
    for (const slug of slugs) {
      lines.push(`https://challonge.com/${username}/${slug}`);
    }
  }
  lines.push(''); // trailing newline

  fs.appendFileSync(HARVESTED_FILE, lines.join('\n'));

  console.log('===========================================================');
  console.log(`Appended ${totalNew} new URL(s) to harvested_tournaments.txt`);
  if (totalErrors > 0) console.log(`(${totalErrors} organizer(s) failed - see errors above)`);
  console.log('\nNext step: node pull_new.js');
})().catch(err => {
  console.error('\nFatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
