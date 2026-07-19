#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — Flag ncpokken1 as an offline local (mirror of ncpokken2)
// Run from the neos-city directory AFTER the console import has brought
// https://challonge.com/ncpokken1 into the DB:
//   node flag_ncpokken1_offline.js            (dry-run — prints, writes nothing)
//   node flag_ncpokken1_offline.js --apply    (performs the UPDATE)
//
// ncpokken1 = "Norcal 2023 local 1 (Euphnet)", Jul 22 2023, 4 players,
// TapuCocoa 1st / Pitaguy 2nd. Its sibling ncpokken2 (DB id 1375) is already
// flagged is_offline=TRUE, location 'NorCal, CA' — this script copies that
// row's offline flags (is_offline / location / series tier) onto ncpokken1 so
// the pair renders identically on the Offline tab.
// ===========================================================================

require('dotenv').config({ path: './backend/.env' });

const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const TARGET_SLUG    = 'ncpokken1';
const REFERENCE_SLUG = 'ncpokken2'; // DB id 1375
const FALLBACK_LOCATION = 'NorCal, CA';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set in backend/.env');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const one = async (slug) => (await pool.query(
      `SELECT id, challonge_id, name, started_at, is_offline, location, series, participants_count
         FROM tournaments WHERE LOWER(challonge_id) = LOWER($1)`, [slug])).rows[0];

    const target = await one(TARGET_SLUG);
    if (!target) {
      console.error(`❌ ${TARGET_SLUG} is not in the DB yet — run the console import first`);
      console.error('   (node prep_console.js challonge_import_console.js → paste on challonge.com).');
      process.exit(1);
    }

    const ref = await one(REFERENCE_SLUG);
    if (ref) {
      console.log(`Reference ${REFERENCE_SLUG} (id ${ref.id}): is_offline=${ref.is_offline}, ` +
                  `location=${JSON.stringify(ref.location)}, series=${JSON.stringify(ref.series)}`);
    } else {
      console.warn(`⚠️  ${REFERENCE_SLUG} not found — falling back to hardcoded values.`);
    }

    const location = (ref && ref.location) || FALLBACK_LOCATION;
    const series   = ref ? ref.series : target.series; // offline tier; ncpokken2's value

    console.log(`\nTarget ${TARGET_SLUG} (id ${target.id}) "${target.name}":`);
    console.log(`  current:  is_offline=${target.is_offline}, location=${JSON.stringify(target.location)}, series=${JSON.stringify(target.series)}`);
    console.log(`  proposed: is_offline=true, location=${JSON.stringify(location)}, series=${JSON.stringify(series)}`);

    if (target.is_offline && target.location === location && target.series === series) {
      console.log('\nAlready flagged — nothing to do.');
      return;
    }
    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to perform the UPDATE.');
      return;
    }

    await pool.query(
      `UPDATE tournaments SET is_offline = TRUE, location = $2, series = $3 WHERE id = $1`,
      [target.id, location, series]
    );
    console.log(`\n✅ ${TARGET_SLUG} (id ${target.id}) flagged offline.`);
    console.log('Reminder: run node recalculate_elo.js afterwards so stats reflect the change.');
  } finally {
    await pool.end();
  }
})().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
