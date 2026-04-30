/**
 * harvest_new.js
 *
 * Re-harvest Challonge tournament URLs from the known organizers and
 * append any new entries to harvested_tournaments.txt.
 *
 * What it does:
 *   1. Reads existing harvested_tournaments.txt; extracts every slug for dedup.
 *   2. Connects to Supabase; reads every `challonge_id` already in the DB
 *      (these are slugs too) for a second dedup layer.
 *   3. Loops over the seven known organizers from seed_organizers.sql, calling
 *      challonge.discoverUserTournaments(username) — which now runs
 *      validatePokkenSlugs() by default, so non-Pokkén tournaments are filtered
 *      out before we even consider them.
 *   4. Writes only the genuinely new slugs to the bottom of the harvested file
 *      as `https://challonge.com/{slug}` (root-namespace form, matching the
 *      existing 495 root entries in the file).
 *   5. Prints a per-organizer summary plus the new total line count.
 *
 * Idempotent — re-running it after a fresh harvest should append zero new
 * lines (assuming no new tournaments have been published in the meantime).
 *
 * Usage (from the neos-city directory):
 *   node harvest_new.js
 *
 * After this completes, run `node pull_new.js` to import the new URLs.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const challonge = require(path.join(__dirname, 'backend', 'src', 'services', 'challonge.js'));

const HARVESTED_FILE = path.join(__dirname, 'harvested_tournaments.txt');

// Per seed_organizers.sql — the seven Challonge usernames whose tournament
// pages we scrape for new slugs. Note the double-underscore prefix on the EU
// organizers (Challonge requires that exact spelling).
const ORGANIZERS = [
  'wise_',
  'rickythe3rd',
  'shean96',
  'rigz_',
  '__chepestoopid',
  '__auradiance',
  'devlinhartfgc',
];

function readExistingHarvested() {
  if (!fs.existsSync(HARVESTED_FILE)) return { lines: [], slugs: new Set() };
  const raw = fs.readFileSync(HARVESTED_FILE, 'utf8');
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  // Pull the slug out of each URL using the same parser tournaments.js uses.
  const slugs = new Set();
  for (const url of lines) {
    const slug = challonge.extractSlugFromUrl(url);
    if (slug) slugs.add(slug.toLowerCase());
  }
  return { lines, slugs };
}

async function readDbSlugs(pool) {
  const { rows } = await pool.query(
    `SELECT challonge_id FROM tournaments WHERE challonge_id IS NOT NULL`
  );
  const set = new Set();
  for (const r of rows) {
    if (r.challonge_id) set.add(String(r.challonge_id).toLowerCase());
  }
  return set;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — check backend/.env');
    process.exit(1);
  }
  if (!process.env.CHALLONGE_V1_KEY) {
    console.warn('CHALLONGE_V1_KEY not set — validation calls will fall back to OAuth.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('📥 Reading existing harvested_tournaments.txt…');
  const { lines: existingLines, slugs: harvestedSlugs } = readExistingHarvested();
  console.log(`   ${existingLines.length} URLs in file, ${harvestedSlugs.size} unique slugs parsed.`);

  console.log('📥 Reading challonge_id values from DB…');
  const dbSlugs = await readDbSlugs(pool);
  console.log(`   ${dbSlugs.size} Challonge tournaments already imported.`);

  const seen = new Set([...harvestedSlugs, ...dbSlugs]);
  const newEntries = []; // { organizer, slug, url }
  const perOrganizer = {};

  for (const username of ORGANIZERS) {
    console.log(`\n🔎 Discovering tournaments for ${username}…`);
    let slugs;
    try {
      slugs = await challonge.discoverUserTournaments(username);
    } catch (err) {
      console.warn(`   ⚠️  ${username} failed: ${err.message}`);
      perOrganizer[username] = { discovered: 0, new: 0, error: err.message };
      continue;
    }

    let newForThisOrg = 0;
    for (const slug of slugs) {
      const key = String(slug).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const url = `https://challonge.com/${slug}`;
      newEntries.push({ organizer: username, slug, url });
      newForThisOrg++;
    }
    perOrganizer[username] = { discovered: slugs.length, new: newForThisOrg };
    console.log(`   ${slugs.length} validated slugs returned, ${newForThisOrg} new.`);
  }

  console.log('\n📊 Summary by organizer:');
  for (const [user, info] of Object.entries(perOrganizer)) {
    if (info.error) {
      console.log(`   ${user.padEnd(18)} ERROR: ${info.error}`);
    } else {
      console.log(`   ${user.padEnd(18)} discovered ${String(info.discovered).padStart(3)}  new ${String(info.new).padStart(3)}`);
    }
  }

  if (newEntries.length === 0) {
    console.log('\n✅ No new tournaments to add. harvested_tournaments.txt is up to date.');
    await pool.end();
    return;
  }

  // Append. Preserve trailing-newline convention of the existing file.
  const needsLeadingNewline = existingLines.length > 0;
  const block = newEntries.map(e => e.url).join('\n');
  const toAppend = (needsLeadingNewline ? '\n' : '') + block + '\n';

  fs.appendFileSync(HARVESTED_FILE, toAppend, 'utf8');

  const finalCount = existingLines.length + newEntries.length;
  console.log(`\n✅ Appended ${newEntries.length} new URL(s) to harvested_tournaments.txt`);
  console.log(`   File now has ${finalCount} URLs (was ${existingLines.length}).`);
  console.log('\n   New entries:');
  for (const e of newEntries) {
    console.log(`     [${e.organizer}] ${e.url}`);
  }

  console.log('\n👉 Next step: run `node pull_new.js` to import the new tournaments.');
  await pool.end();
}

main().catch(err => {
  console.error('\n❌ harvest_new.js failed:', err);
  process.exit(1);
});
